#!/usr/bin/env node

import fs from "node:fs/promises";

import { Command } from "commander";
import { ethers } from "ethers";
import { Pool } from "pg";

import {
  generateRegistryCredential,
  issueSignupPermit,
  verifyActaAnchoredOnChain,
  verifyActaFile,
  verifySignupPermit,
} from "@blockurna/sdk";

import { RegistryCredentialSchema, SignupPermitSchema } from "@blockurna/shared";

const program = new Command();

function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

function normalizeApiBase(url: string): string {
  return url.replace(/\/$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function insertReaSignupPermit(params: {
  databaseUrl: string;
  permit: {
    chainId: string;
    contractAddress: string;
    electionId: string;
    registryNullifier: string;
    credentialId: string;
    issuerAddress: string;
    permitSig: string;
    issuedAt: string;
  };
}): Promise<{ ok: boolean; error?: string; pgCode?: string }> {
  const pool = new Pool({ connectionString: params.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO rea_signup_permits(
        chain_id, contract_address, election_id,
        registry_nullifier, credential_id,
        issuer_address, permit_sig,
        issued_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        params.permit.chainId,
        params.permit.contractAddress,
        params.permit.electionId,
        params.permit.registryNullifier,
        params.permit.credentialId,
        params.permit.issuerAddress,
        params.permit.permitSig,
        params.permit.issuedAt,
      ],
    );
    return { ok: true };
  } catch (err: any) {
    const pgCode = typeof err?.code === "string" ? err.code : undefined;
    return { ok: false, error: (err as Error).message, pgCode };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function upsertIncidentLog(params: {
  databaseUrl: string;
  chainId: string;
  contractAddress: string;
  electionId: string;
  incident: {
    fingerprint: string;
    code: string;
    severity: string;
    message: string;
    details: unknown;
    relatedTxHash?: string | null;
    relatedBlockNumber?: number | null;
    relatedBlockTimestampIso?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    evidencePointers?: unknown[];
    active?: boolean;
    resolvedAtIso?: string | null;
  };
}): Promise<{ ok: boolean; error?: string; pgCode?: string }> {
  const pool = new Pool({ connectionString: params.databaseUrl });
  try {
    const active = params.incident.active ?? true;
    const resolvedAtIso = active ? null : (params.incident.resolvedAtIso ?? new Date().toISOString());

    await pool.query(
      `INSERT INTO incident_logs(
        chain_id, contract_address, election_id,
        fingerprint, code, severity, message, details,
        related_tx_hash, related_block_number, related_block_timestamp,
        related_entity_type, related_entity_id, evidence_pointers,
        active, resolved_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET
        last_seen_at=NOW(),
        occurrences=incident_logs.occurrences + 1,
        code=EXCLUDED.code,
        severity=EXCLUDED.severity,
        message=EXCLUDED.message,
        details=EXCLUDED.details,
        related_tx_hash=COALESCE(EXCLUDED.related_tx_hash, incident_logs.related_tx_hash),
        related_block_number=COALESCE(EXCLUDED.related_block_number, incident_logs.related_block_number),
        related_block_timestamp=COALESCE(EXCLUDED.related_block_timestamp, incident_logs.related_block_timestamp),
        related_entity_type=COALESCE(EXCLUDED.related_entity_type, incident_logs.related_entity_type),
        related_entity_id=COALESCE(EXCLUDED.related_entity_id, incident_logs.related_entity_id),
        evidence_pointers=EXCLUDED.evidence_pointers,
        active=EXCLUDED.active,
        resolved_at=EXCLUDED.resolved_at`,
      [
        params.chainId,
        params.contractAddress,
        params.electionId,
        params.incident.fingerprint,
        params.incident.code,
        params.incident.severity,
        params.incident.message,
        JSON.stringify(params.incident.details ?? {}),
        params.incident.relatedTxHash ?? null,
        params.incident.relatedBlockNumber ?? null,
        params.incident.relatedBlockTimestampIso ?? null,
        params.incident.relatedEntityType ?? null,
        params.incident.relatedEntityId ?? null,
        JSON.stringify(params.incident.evidencePointers ?? []),
        active,
        resolvedAtIso,
      ],
    );
    return { ok: true };
  } catch (err: any) {
    const pgCode = typeof err?.code === "string" ? err.code : undefined;
    return { ok: false, error: (err as Error).message, pgCode };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function tamperHexByte(hex: string): string {
  const bytes = ethers.getBytes(hex);
  if (bytes.length === 0) throw new Error("Empty hex bytes");
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
  return ethers.hexlify(bytes);
}

program
  .name("blockurna-audit")
  .description("Audit CLI (BU-PVP-1): verificación de actas digitales y anclajes on-chain")
  .version("0.0.0");

program
  .command("verify-acta")
  .requiredOption("--file <path>", "Ruta al JSON del acta firmada (SignedSnapshot)")
  .option("--rpc <url>", "RPC URL para verificar anclaje on-chain")
  .option(
    "--contract <address>",
    "Dirección del BU_PVP_1_ElectionRegistry (TPE)",
  )
  .option("--election <id>", "ElectionId (uint256)")
  .action(async (opts) => {
    const raw = await fs.readFile(opts.file, "utf8");
    const json = JSON.parse(raw) as unknown;

    const local = await verifyActaFile(json);
    if (!local.ok) {
      console.error(JSON.stringify({ ok: false, step: "local", error: local.error }, null, 2));
      process.exitCode = 1;
      return;
    }

    const out: Record<string, unknown> = {
      ok: true,
      local: { ok: true, snapshotHashHex: local.snapshotHashHex },
    };

    if (opts.rpc && opts.contract && typeof opts.election === "string") {
      const provider = new ethers.JsonRpcProvider(opts.rpc);
      const electionId = Number(opts.election);
      const anchored = await verifyActaAnchoredOnChain({
        signedSnapshotJson: json,
        provider,
        electionRegistryAddress: opts.contract,
        electionId,
      });
      out.chain = anchored;
    }

    console.log(JSON.stringify(out, null, 2));
  });

program
  .command("verify-acta-api")
  .description("Verifica una acta servida por evidence-api (firma + hash + anchor + consistencyStatus)")
  .requiredOption("--api <url>", "Base URL de evidence-api (ej: http://127.0.0.1:3020)")
  .requiredOption("--election <id>", "ElectionId (uint256)")
  .requiredOption("--act <actId>", "ActId (snapshotHashHex)")
  .action(async (opts) => {
    const apiBase = normalizeApiBase(opts.api);
    const electionId = String(opts.election);
    const actId = String(opts.act);
    const actIdLower = actId.toLowerCase();

    type ActMetaResponse = {
      ok: boolean;
      electionId: string;
      actId: string;
      act: any;
    };

    type ActContentResponse = {
      ok: boolean;
      electionId: string;
      actId: string;
      signedJson: unknown;
    };

    type IncidentsResponse = {
      ok: boolean;
      incidents: Array<{ fingerprint: string; severity: string; active?: boolean }>;
    };

    const meta = await fetchJson<ActMetaResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actIdLower)}`,
    );

    const content = await (async () => {
      try {
        return await fetchJson<ActContentResponse>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actIdLower)}/content`,
        );
      } catch {
        return null;
      }
    })();

    const anchorFoundOnChain = Boolean(meta.act?.anchorTxHash);

    const local = content ? await verifyActaFile(content.signedJson) : { ok: false, error: "missing_content" };
    const signatureValid = Boolean(local.ok);
    const hashMatchesAnchor = Boolean(
      local.ok && local.snapshotHashHex && local.snapshotHashHex.toLowerCase() === actIdLower,
    );

    const incidents = await fetchJson<IncidentsResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/incidents`,
    );
    const actIncidentSeverities = new Set(
      (incidents.incidents ?? [])
        .filter((i) => i.active !== false)
        .filter((i) => typeof i.fingerprint === "string" && i.fingerprint.endsWith(`:${actIdLower}`))
        .map((i) => i.severity),
    );

    const consistencyStatus = Array.from(actIncidentSeverities.values()).some(isCriticalSeverity)
      ? "CRITICAL"
      : Array.from(actIncidentSeverities.values()).some(isWarningSeverity)
        ? "WARNING"
        : "OK";

    const out = {
      ok: true,
      api: apiBase,
      electionId,
      actId: actIdLower,
      signatureValid,
      hashMatchesAnchor,
      anchorFoundOnChain,
      consistencyStatus,
      local: local.ok ? { ok: true, snapshotHashHex: local.snapshotHashHex } : { ok: false, error: local.error },
    };

    console.log(JSON.stringify(out, null, 2));
  });

program
  .command("export-audit-bundle")
  .description("Exporta un audit bundle desde evidence-api (incluye actas completas)")
  .requiredOption("--api <url>", "Base URL de evidence-api (ej: http://127.0.0.1:3020)")
  .requiredOption("--election <id>", "ElectionId (uint256)")
  .requiredOption("--out <path>", "Ruta de salida del bundle (JSON)")
  .action(async (opts) => {
    const apiBase = normalizeApiBase(opts.api);
    const electionId = String(opts.election);

    type ActsListResponse = {
      ok: boolean;
      electionId: string;
      acts: Array<{ actId: string }>;
    };

    type ActMetaResponse = {
      ok: boolean;
      electionId: string;
      actId: string;
      act: any;
    };

    type ActContentResponse = {
      ok: boolean;
      electionId: string;
      actId: string;
      signedJson: unknown;
    };

    type ActVerifyResponse = {
      ok: boolean;
      electionId: string;
      actId: string;
      signatureValid: boolean;
      hashMatchesAnchor: boolean;
      anchorFoundOnChain: boolean;
      consistencyStatus: string;
    };

    const actsList = await fetchJson<ActsListResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts`,
    );

    const acts = Array.isArray(actsList.acts) ? actsList.acts : [];

    const bundleActs = [] as Array<{
      actId: string;
      metadata: any;
      signedJson: unknown | null;
      verify: any;
    }>;

    for (const a of acts) {
      const actId = String(a.actId).toLowerCase();
      const [meta, verify] = await Promise.all([
        fetchJson<ActMetaResponse>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}`,
        ),
        fetchJson<ActVerifyResponse>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/verify`,
        ),
      ]);

      const content = await (async () => {
        try {
          return await fetchJson<ActContentResponse>(
            `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/content`,
          );
        } catch {
          return null;
        }
      })();

      bundleActs.push({
        actId,
        metadata: meta.act,
        signedJson: content?.signedJson ?? null,
        verify: {
          signatureValid: verify.signatureValid,
          hashMatchesAnchor: verify.hashMatchesAnchor,
          anchorFoundOnChain: verify.anchorFoundOnChain,
          consistencyStatus: verify.consistencyStatus,
        },
      });
    }

    const bundle = {
      ok: true,
      generatedAt: new Date().toISOString(),
      api: apiBase,
      electionId,
      acts: bundleActs,
      results: [] as any[],
      batches: [] as any[],
      tallyJobs: [] as any[],
      auditWindow: null as any,
    };

    // Fetch additional data for complete bundle
    try {
      const resultsData = await fetchJson<{ ok: boolean; results: any[] }>(
        `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/results`,
      );
      bundle.results = resultsData.results ?? [];
    } catch { /* optional */ }

    try {
      const batchesData = await fetchJson<{ ok: boolean; batches: any[] }>(
        `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/processing/batches`,
      );
      bundle.batches = batchesData.batches ?? [];
    } catch { /* optional */ }

    try {
      const jobsData = await fetchJson<{ ok: boolean; jobs: any[] }>(
        `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/tally/jobs`,
      );
      bundle.tallyJobs = jobsData.jobs ?? [];
    } catch { /* optional */ }

    try {
      const auditData = await fetchJson<{ ok: boolean; auditWindow: any }>(
        `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/audit-window`,
      );
      bundle.auditWindow = auditData.auditWindow ?? null;
    } catch { /* optional */ }

    await fs.writeFile(opts.out, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ ok: true, out: opts.out, acts: bundleActs.length, results: bundle.results.length, batches: bundle.batches.length, tallyJobs: bundle.tallyJobs.length }, null, 2));
  });

program
  .command("rea-credential")
  .description("Genera una credencial REA (incluye secretHex)")
  .option("--registry-authority <address>", "Address del REA (opcional)")
  .option("--subject <label>", "Etiqueta del sujeto (opcional)")
  .option("--out <path>", "Ruta de salida (JSON)")
  .action(async (opts) => {
    const credential = generateRegistryCredential({
      registryAuthority: opts.registryAuthority,
      subjectLabel: opts.subject,
    });

    if (opts.out) {
      await fs.writeFile(opts.out, JSON.stringify(credential, null, 2) + "\n", "utf8");
    }

    console.log(JSON.stringify({ ok: true, credential, out: opts.out ?? null }, null, 2));
  });

program
  .command("rea-issue-permit")
  .description("Emite un SignupPermit (REA) para una elección y lo firma (EIP-191)")
  .requiredOption("--credential <path>", "Ruta al JSON de la credencial REA")
  .requiredOption("--chain <id>", "ChainId (ej: 31337)")
  .requiredOption("--contract <address>", "Dirección del BU_PVP_1_ElectionRegistry")
  .requiredOption("--election <id>", "ElectionId (uint256)")
  .requiredOption("--rea-key <hex>", "Private key del REA (0x...)")
  .option("--db <url>", "DATABASE_URL Postgres para registrar la bitácora (opcional)")
  .option("--out <path>", "Ruta de salida (JSON)")
  .action(async (opts) => {
    const raw = await fs.readFile(opts.credential, "utf8");
    const json = JSON.parse(raw) as unknown;
    const credential = RegistryCredentialSchema.parse(json);

    const permit = await issueSignupPermit({
      chainId: String(opts.chain),
      contractAddress: String(opts.contract),
      electionId: String(opts.election),
      credential,
      reaPrivateKey: String(opts.reaKey),
    });

    const db = typeof opts.db === "string" ? String(opts.db) : null;
    const dbWrite = db
      ? await insertReaSignupPermit({
          databaseUrl: db,
          permit: {
            chainId: permit.chainId,
            contractAddress: permit.contractAddress,
            electionId: permit.electionId,
            registryNullifier: permit.registryNullifier,
            credentialId: permit.credentialId,
            issuerAddress: permit.issuerAddress,
            permitSig: permit.permitSig,
            issuedAt: permit.issuedAt,
          },
        })
      : null;

    if (opts.out) {
      await fs.writeFile(opts.out, JSON.stringify(permit, null, 2) + "\n", "utf8");
    }

    const reused = dbWrite && !dbWrite.ok && dbWrite.pgCode === "23505";
    if (reused) {
      console.error(JSON.stringify({ ok: false, error: "permit_already_issued", pgCode: dbWrite.pgCode }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({ ok: true, permit, out: opts.out ?? null, dbWrite }, null, 2));
  });

program
  .command("rea-validate-permit")
  .description("Verifica un SignupPermit (firma y emisor)")
  .requiredOption("--permit <path>", "Ruta al JSON del permit")
  .option("--issuer <address>", "Issuer esperado (opcional)")
  .action(async (opts) => {
    const raw = await fs.readFile(opts.permit, "utf8");
    const json = JSON.parse(raw) as unknown;
    const permit = SignupPermitSchema.parse(json);

    const verified = verifySignupPermit({
      permit,
      expectedIssuerAddress: opts.issuer,
    });

    console.log(JSON.stringify({ ok: true, verified }, null, 2));
  });

program
  .command("rea-signup")
  .description("Ejecuta signup() on-chain usando un SignupPermit y muestra el resultado")
  .requiredOption("--permit <path>", "Ruta al JSON del permit")
  .requiredOption("--rpc <url>", "RPC URL (ej: http://127.0.0.1:8545)")
  .requiredOption("--contract <address>", "Dirección del BU_PVP_1_ElectionRegistry")
  .requiredOption("--voter-key <hex>", "Private key del votante (0x...)")
  .option("--voting-pub-key <hex>", "Voting public key (bytes). Si no se provee, se genera aleatoria")
  .option("--attempt-twice", "Intenta registrar 2 veces (debería revertir por nullifier reuse)")
  .option("--tamper-permit", "Cambia 1 byte del permitSig antes de enviar (debe fallar)")
  .option("--force-send", "Envía tx aún si se espera revert (by-pass estimateGas)")
  .option("--gas-limit <n>", "Gas limit para force-send", "500000")
  .option("--db <url>", "DATABASE_URL Postgres para registrar incidentes (opcional)")
  .action(async (opts) => {
    const raw = await fs.readFile(opts.permit, "utf8");
    const json = JSON.parse(raw) as unknown;
    const permit = SignupPermitSchema.parse(json);

    const contractAddress = ethers.getAddress(String(opts.contract)).toLowerCase();
    if (permit.contractAddress.toLowerCase() !== contractAddress) {
      console.error(
        JSON.stringify(
          { ok: false, error: "permit_contract_mismatch", permitContract: permit.contractAddress, contractAddress },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    const provider = new ethers.JsonRpcProvider(String(opts.rpc));
    const voterWallet = new ethers.Wallet(String(opts.voterKey), provider);
    const voter = new ethers.NonceManager(voterWallet);

    const votingPubKey =
      typeof opts.votingPubKey === "string" && String(opts.votingPubKey).length > 0
        ? String(opts.votingPubKey)
        : ethers.hexlify(ethers.randomBytes(32));

    const abi = [
      "function signup(uint256 electionId, bytes32 registryNullifier, bytes votingPubKey, bytes permitSig)",
      "function registryNullifierUsed(uint256 electionId, bytes32 registryNullifier) view returns (bool)",
      "event SignupRecorded(uint256 indexed electionId, bytes32 indexed registryNullifier, bytes votingPubKey)",
    ];
    const registry = new ethers.Contract(contractAddress, abi, voter) as any;

    const dbUrl = typeof opts.db === "string" ? String(opts.db) : null;
    const chainId = String(permit.chainId);
    const electionId = String(permit.electionId);

    const gasLimit = (() => {
      const n = Number(opts.gasLimit);
      if (!Number.isFinite(n) || n <= 0) return 500000;
      return Math.floor(n);
    })();

    const iface = new ethers.Interface(abi);

    const trySendSignupTx = async (params: {
      permitSig: string;
      mode: "safe" | "force";
    }): Promise<{ ok: boolean; txHash?: string; blockNumber?: number | null; status?: number | null; signupLogIndex?: number | null; error?: string }> => {
      try {
        if (params.mode === "force") {
          const data = iface.encodeFunctionData("signup", [
            BigInt(permit.electionId),
            permit.registryNullifier,
            votingPubKey,
            params.permitSig,
          ]);
          let txHash: string | null = null;
          try {
            const tx = await voter.sendTransaction({ to: contractAddress, data, gasLimit });
            txHash = tx.hash;
          } catch (err: any) {
            const maybe =
              (typeof err?.info?.error?.data?.txHash === "string" && err.info.error.data.txHash) ||
              (typeof err?.error?.data?.txHash === "string" && err.error.data.txHash) ||
              (typeof err?.data?.txHash === "string" && err.data.txHash) ||
              (typeof err?.txHash === "string" && err.txHash) ||
              null;

            if (maybe && /^0x[0-9a-fA-F]{64}$/.test(maybe)) {
              txHash = maybe;
            } else {
              throw err;
            }
          }

          const receipt = txHash ? await provider.waitForTransaction(txHash) : null;
          if (!receipt) {
            return { ok: false, txHash: txHash ?? undefined, blockNumber: null, status: null, signupLogIndex: null, error: "tx_not_mined" };
          }

          const signupLog = receipt.logs.find((l) => {
            try {
              const parsed = iface.parseLog(l);
              return parsed?.name === "SignupRecorded";
            } catch {
              return false;
            }
          });

          const signupLogIndex = signupLog
            ? (typeof (signupLog as any).logIndex === "number"
                ? (signupLog as any).logIndex
                : typeof (signupLog as any).index === "number"
                  ? (signupLog as any).index
                  : null)
            : null;

          return {
            ok: receipt.status === 1,
            txHash: txHash ?? undefined,
            blockNumber: receipt.blockNumber ?? null,
            status: receipt.status ?? null,
            signupLogIndex,
            error: receipt.status === 1 ? undefined : "execution_reverted",
          };
        }

        const tx = await registry.signup(
          BigInt(permit.electionId),
          permit.registryNullifier,
          votingPubKey,
          params.permitSig,
        );
        const receipt = await tx.wait();

        const signupLog = receipt?.logs?.find((l: any) => {
          try {
            const parsed = iface.parseLog(l);
            return parsed?.name === "SignupRecorded";
          } catch {
            return false;
          }
        });

        return {
          ok: Boolean(receipt?.status === 1),
          txHash: tx.hash,
          blockNumber: receipt?.blockNumber ?? null,
          status: receipt?.status ?? null,
          signupLogIndex: signupLog
            ? (typeof (signupLog as any).logIndex === "number"
                ? (signupLog as any).logIndex
                : typeof (signupLog as any).index === "number"
                  ? (signupLog as any).index
                  : null)
            : null,
        };
      } catch (err: unknown) {
        return { ok: false, error: (err as Error).message };
      }
    };

    const recordIncident = async (incident: {
      code: string;
      severity: string;
      message: string;
      details: unknown;
      txHash?: string | null;
      blockNumber?: number | null;
      blockTimestampIso?: string | null;
    }) => {
      if (!dbUrl) return null;
      const txHashLower = incident.txHash ? String(incident.txHash).toLowerCase() : null;
      const fingerprint = txHashLower
        ? `${incident.code}:${txHashLower}`
        : `${incident.code}:no_tx:${new Date().toISOString()}`;

      return await upsertIncidentLog({
        databaseUrl: dbUrl,
        chainId,
        contractAddress,
        electionId,
        incident: {
          fingerprint,
          code: incident.code,
          severity: incident.severity,
          message: incident.message,
          details: incident.details,
          relatedTxHash: txHashLower,
          relatedBlockNumber: incident.blockNumber ?? null,
          relatedBlockTimestampIso: incident.blockTimestampIso ?? null,
          relatedEntityType: "SIGNUP_ATTEMPT",
          relatedEntityId: txHashLower,
          evidencePointers: txHashLower
            ? [
                {
                  type: "tx",
                  txHash: txHashLower,
                  blockNumber: incident.blockNumber ?? null,
                  blockTimestamp: incident.blockTimestampIso ?? null,
                },
              ]
            : [],
          active: true,
        },
      });
    };

    const permitSigOriginal = String(permit.permitSig);
    const permitSigTampered = opts.tamperPermit ? tamperHexByte(permitSigOriginal) : permitSigOriginal;

    const nullifierUsedBefore = await registry.registryNullifierUsed(
      BigInt(permit.electionId),
      permit.registryNullifier,
    );

    const firstMode: "safe" | "force" = opts.forceSend || opts.tamperPermit ? "force" : "safe";
    const secondMode: "safe" | "force" = opts.forceSend || opts.attemptTwice ? "force" : "safe";

    try {
      const first = await trySendSignupTx({ permitSig: permitSigTampered, mode: firstMode });

      if (!first.ok) {
        let blockTimestampIso: string | null = null;
        if (first.blockNumber != null && first.blockNumber !== null) {
          const block = await provider.getBlock(first.blockNumber);
          blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;
        }

        const code = opts.tamperPermit
          ? "SIGNUP_INVALID_PERMIT"
          : nullifierUsedBefore === true
            ? "SIGNUP_DUP_NULLIFIER"
            : "SIGNUP_TX_REVERTED";
        await recordIncident({
          code,
          severity: "WARNING",
          message: opts.tamperPermit
            ? "Signup attempt reverted due to invalid/tampered REA permit"
            : nullifierUsedBefore === true
              ? "Signup attempt reverted due to registry nullifier reuse"
              : "Signup attempt failed/reverted",
          details: {
            attempt: "first",
            mode: firstMode,
            electionId,
            registryNullifier: permit.registryNullifier,
            nullifierUsedBefore,
            tampered: Boolean(opts.tamperPermit),
            status: first.status ?? null,
            error: first.error ?? null,
          },
          txHash: first.txHash ?? null,
          blockNumber: first.blockNumber ?? null,
          blockTimestampIso,
        });

        console.error(JSON.stringify({ ok: false, error: first.error ?? "signup_failed", first }, null, 2));
        process.exitCode = 1;
        return;
      }

      const out: any = {
        ok: true,
        first,
        electionId,
        chainId,
        contractAddress,
        votingPubKey,
        tampered: Boolean(opts.tamperPermit),
      };

      if (opts.attemptTwice) {
        const second = await trySendSignupTx({ permitSig: permitSigOriginal, mode: secondMode });

        if (second.ok) {
          out.second = { ...second, unexpected: true };
        } else {
          let blockTimestampIso: string | null = null;
          if (second.blockNumber != null && second.blockNumber !== null) {
            const block = await provider.getBlock(second.blockNumber);
            blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;
          }

          await recordIncident({
            code: "SIGNUP_DUP_NULLIFIER",
            severity: "WARNING",
            message: "Second signup attempt reverted (expected nullifier reuse protection)",
            details: {
              attempt: "second",
              mode: secondMode,
              electionId,
              registryNullifier: permit.registryNullifier,
              status: second.status ?? null,
              error: second.error ?? null,
            },
            txHash: second.txHash ?? null,
            blockNumber: second.blockNumber ?? null,
            blockTimestampIso,
          });

          out.second = second;
        }
      }

      console.log(JSON.stringify(out, null, 2));
    } catch (err: unknown) {
      console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
      process.exitCode = 1;
    }
  });

program
  .command("verify-audit-bundle")
  .description("Descarga y verifica el audit bundle completo de una elección")
  .requiredOption("--api <url>", "Base URL de evidence-api (ej: http://127.0.0.1:3020)")
  .requiredOption("--election <id>", "ElectionId (uint256)")
  .action(async (opts) => {
    try {
      const apiBase = normalizeApiBase(opts.api);
      const electionId = String(opts.election);

      // 1. Fetch the full audit bundle
      const bundle = await fetchJson<any>(`${apiBase}/v1/elections/${encodeURIComponent(electionId)}/audit-bundle`);

      const [candidatesRes, manifestRes, resultsRes] = await Promise.all([
        fetchJson<{ ok: boolean; candidates?: Array<any> }>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/candidates`,
        ).catch(() => ({ ok: false, candidates: [] })),
        fetchJson<{ ok: boolean; source?: string; manifest?: any }>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/manifest`,
        ).catch(() => ({ ok: false, source: "unavailable", manifest: null })),
        fetchJson<{ ok: boolean; results?: Array<any> }>(
          `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/results`,
        ).catch(() => ({ ok: false, results: [] })),
      ]);

      if (!bundle.ok) {
        console.log(JSON.stringify({ ok: false, error: bundle.error ?? "Bundle fetch failed" }, null, 2));
        process.exitCode = 1;
        return;
      }

      // 2. Verify each acta
      const actaVerifications = [] as any[];
      for (const acta of (bundle.actas ?? [])) {
        try {
          const verify = await fetchJson<any>(
            `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(acta.actId)}/verify`,
          );
          actaVerifications.push({
            actId: acta.actId,
            actType: acta.actType,
            signatureValid: verify.signatureValid,
            hashMatchesAnchor: verify.hashMatchesAnchor,
            anchorFoundOnChain: verify.anchorFoundOnChain,
            consistencyStatus: verify.consistencyStatus,
          });
        } catch (err: any) {
          actaVerifications.push({
            actId: acta.actId,
            actType: acta.actType,
            error: err.message,
          });
        }
      }

      // 3. Check for both required acta types
      const actaTypes = (bundle.actas ?? []).map((a: any) => a.actType);
      const hasEscrutinio = actaTypes.includes("ACTA_ESCRUTINIO");
      const hasResultados = actaTypes.includes("ACTA_RESULTADOS");

      // 4. Summary
      const result = bundle.resultPayloads?.[0] ?? null;
      const detailedResult = resultsRes.results?.[0] ?? null;

      const candidates = Array.isArray(candidatesRes.candidates) ? candidatesRes.candidates : [];
      const candidateIdSet = new Set(candidates.map((c: any) => String(c.id ?? "").toLowerCase()).filter(Boolean));
      const candidateCodeSet = new Set(candidates.map((c: any) => String(c.candidateCode ?? "").toLowerCase()).filter(Boolean));

      const summaryItems = Array.isArray(detailedResult?.summaryItems) ? detailedResult.summaryItems : [];
      const unresolvedSummaryItems = summaryItems.filter((item: any) => {
        const id = String(item?.candidateId ?? "").toLowerCase();
        const code = String(item?.candidateCode ?? "").toLowerCase();
        return !candidateIdSet.has(id) && !candidateCodeSet.has(code);
      });

      const manifestCandidates = Array.isArray(manifestRes.manifest?.manifestJson?.candidates)
        ? manifestRes.manifest.manifestJson.candidates
        : [];
      const manifestCandidateIdSet = new Set(
        manifestCandidates.map((c: any) => String(c.id ?? c.candidateId ?? "").toLowerCase()).filter(Boolean),
      );
      const dbCatalogMatchesManifest =
        manifestCandidates.length === candidates.length &&
        candidates.every((candidate: any) => manifestCandidateIdSet.has(String(candidate.id ?? "").toLowerCase()));

      console.log(JSON.stringify({
        ok: true,
        electionId,
        bundleHash: bundle.bundleHash,
        exportStatus: bundle.exportStatus,
        election: bundle.election,
        counts: {
          ballots: bundle.ballotsSummary?.total ?? 0,
          processingBatches: (bundle.processingBatches ?? []).length,
          tallyJobs: (bundle.tallyJobs ?? []).length,
          resultPayloads: (bundle.resultPayloads ?? []).length,
          actas: (bundle.actas ?? []).length,
          anchors: (bundle.anchors ?? []).length,
          incidents: (bundle.incidents ?? []).length,
        },
        actaPresence: {
          ACTA_ESCRUTINIO: hasEscrutinio,
          ACTA_RESULTADOS: hasResultados,
          complete: hasEscrutinio && hasResultados,
        },
        actaVerifications,
        resultPayload: result ? {
          resultMode: result.resultMode,
          proofState: result.proofState,
          payloadHash: result.payloadHash,
          isSimulated: false,
        } : null,
        candidateCatalog: {
          count: candidates.length,
          activeCount: candidates.filter((candidate: any) => String(candidate.status ?? "").toUpperCase() === "ACTIVE").length,
          manifestSource: manifestRes.source ?? null,
          manifestHash: manifestRes.manifest?.manifestHash ?? null,
          manifestCandidateCount: manifestCandidates.length,
          dbCatalogMatchesManifest,
        },
        resultSummaryValidation: detailedResult
          ? {
              resultId: detailedResult.id,
              summaryItemsCount: summaryItems.length,
              hasUnresolvedCandidateLabels: Boolean(detailedResult.hasUnresolvedCandidateLabels),
              unresolvedByCatalogCount: unresolvedSummaryItems.length,
              unresolvedByCatalog: unresolvedSummaryItems.map((item: any) => ({
                candidateId: item?.candidateId ?? null,
                candidateCode: item?.candidateCode ?? null,
                displayName: item?.displayName ?? null,
                votes: item?.votes ?? null,
              })),
            }
          : null,
        auditWindow: bundle.auditWindow ? {
          status: bundle.auditWindow.status,
          openedAt: bundle.auditWindow.openedAt,
        } : null,
        honesty: bundle.honesty,
        warnings: [
          ...([]),
          ...(candidates.length === 0 ? ["No hay catálogo de candidatos publicado en Evidence API"] : []),
          ...(!dbCatalogMatchesManifest ? ["El catálogo DB no coincide con el manifiesto vigente"] : []),
          ...(Boolean(detailedResult?.hasUnresolvedCandidateLabels) ? ["El resultado reporta etiquetas de candidato no resueltas"] : []),
          ...(unresolvedSummaryItems.length > 0
            ? ["Hay summaryItems que no corresponden al catálogo oficial de candidatos"]
            : []),
          ...(!hasEscrutinio ? ["Falta ACTA_ESCRUTINIO"] : []),
          ...(!hasResultados ? ["Falta ACTA_RESULTADOS"] : []),
          ...(bundle.exportStatus !== "MATERIALIZED" ? ["Bundle no materializado"] : []),
        ],
      }, null, 2));

    } catch (err: unknown) {
      console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
