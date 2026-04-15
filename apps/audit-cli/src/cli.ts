#!/usr/bin/env node

import fs from "node:fs/promises";

import { Command } from "commander";
import { ethers } from "ethers";
import { Pool } from "pg";

import {
  generateExperimentalRegistryCredential,
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
      act: {
        actId: string;
        electionId: string;
        actType: string;
        canonicalJson: any | null;
        signature: string | null;
        signerKeyId: string | null;
        signerPublicKey: string | null;
        contentHash: string | null;
        anchorTxHash: string | null;
        blockNumber: string | null;
        blockTimestamp: string | null;
        createdAt: string | null;
      };
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
    };

    await fs.writeFile(opts.out, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ ok: true, out: opts.out, acts: bundleActs.length }, null, 2));
  });

program
  .command("rea-credential")
  .description("Genera una credencial experimental REA (incluye secretHex)")
  .option("--registry-authority <address>", "Address del REA (opcional)")
  .option("--subject <label>", "Etiqueta del sujeto (opcional)")
  .option("--out <path>", "Ruta de salida (JSON)")
  .action(async (opts) => {
    const credential = generateExperimentalRegistryCredential({
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
    const voter = new ethers.Wallet(String(opts.voterKey), provider);

    const votingPubKey =
      typeof opts.votingPubKey === "string" && String(opts.votingPubKey).length > 0
        ? String(opts.votingPubKey)
        : ethers.hexlify(ethers.randomBytes(32));

    const abi = [
      "function signup(uint256 electionId, bytes32 registryNullifier, bytes votingPubKey, bytes permitSig)",
    ];
    const registry = new ethers.Contract(contractAddress, abi, voter) as any;

    const attemptOnce = async () => {
      const tx = await registry.signup(
        BigInt(permit.electionId),
        permit.registryNullifier,
        votingPubKey,
        permit.permitSig,
      );
      const receipt = await tx.wait();
      return { txHash: tx.hash, blockNumber: receipt?.blockNumber ?? null };
    };

    try {
      const first = await attemptOnce();
      const out: any = { ok: true, first, electionId: permit.electionId, contractAddress, votingPubKey };

      if (opts.attemptTwice) {
        try {
          await attemptOnce();
          out.second = { ok: true, unexpected: true };
        } catch (err: unknown) {
          out.second = { ok: false, error: (err as Error).message };
        }
      }

      console.log(JSON.stringify(out, null, 2));
    } catch (err: unknown) {
      console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
