#!/usr/bin/env node

import fs from "node:fs/promises";

import { Command } from "commander";
import { ethers } from "ethers";

import { verifyActaAnchoredOnChain, verifyActaFile } from "@blockurna/sdk";

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
