import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ethers } from "ethers";
import {
  canonicalizeJson,
  getPublicKeyHex,
  sha256Hex,
  signEd25519Hex,
  utf8ToBytes,
} from "@blockurna/crypto";
import { z } from "zod";

import { getEnv, getEnvResult } from "../lib/env";
import { ensureSchema, getPool, insertAdminLogEntry } from "../lib/db";
import { getRegistry, parseElectionCreatedFromReceipt } from "../lib/registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ElectionsApiResponse = {
  ok: boolean;
  chainId: string;
  contractAddress: string;
  elections: Array<{
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel?: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
    counts: { signups: number; ballots: number };
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

const CreateElectionInputSchema = z
  .object({
    title: z.string().min(1).max(140),
    notes: z.string().max(1000).optional(),
    registryAuthority: z.string().min(1),
    coordinatorPubKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte hex"),
  })
  .strict();

async function createElectionAction(formData: FormData) {
  "use server";
  const env = getEnv();

  const parsed = CreateElectionInputSchema.safeParse({
    title: String(formData.get("title") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    registryAuthority: String(formData.get("registryAuthority") ?? "").trim(),
    coordinatorPubKey: String(formData.get("coordinatorPubKey") ?? "").trim(),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const registryAuthority = ethers.getAddress(parsed.data.registryAuthority);
  const coordinatorPubKey = parsed.data.coordinatorPubKey;

  const manifestBody = {
    manifestVersion: "1",
    protocolVersion: "BU-PVP-1",
    generatedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    title: parsed.data.title,
    authority: { address: authorityAddress },
    registryAuthority: { address: registryAuthority },
    coordinatorPubKey,
    notes: parsed.data.notes,
  } as const;

  const manifestCanonical = canonicalizeJson(manifestBody);
  const manifestHashHex = sha256Hex(manifestCanonical).toLowerCase();

  const publicKeyHex = await getPublicKeyHex(env.AEA_ED25519_PRIVATE_KEY_HEX);
  const signatureHex = await signEd25519Hex(
    utf8ToBytes(manifestHashHex),
    env.AEA_ED25519_PRIVATE_KEY_HEX,
  );

  const signedManifest = {
    manifest: manifestBody,
    signature: {
      algorithm: "ed25519-sha256-jcs",
      publicKeyHex,
      signatureHex,
      manifestHashHex,
    },
  } as const;

  const manifestsDir = path.join(env.ACTA_OUTPUT_DIR, "manifests");
  await fs.mkdir(manifestsDir, { recursive: true });
  const manifestFilePath = path.join(manifestsDir, `manifest_${manifestHashHex}.signed.json`);
  await fs.writeFile(manifestFilePath, JSON.stringify(signedManifest, null, 2) + "\n", "utf8");

  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const tx = await (contract as any).createElection(
    manifestHashHex,
    registryAuthority,
    coordinatorPubKey,
  );
  const receipt = await tx.wait();

  const electionId = receipt
    ? parseElectionCreatedFromReceipt({ receipt, contractAddress: env.CONTRACT_ADDRESS })
    : null;

  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: "CREATE_ELECTION",
    message: "ElectionCreated executed by AEA",
    details: {
      electionId,
      manifestHashHex,
      manifestFilePath,
      registryAuthority,
      coordinatorPubKey,
    },
    evidencePointers: receipt
      ? [
          {
            type: "tx",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            blockTimestamp: blockTimestampIso,
          },
        ]
      : [],
    actorAddress: authorityAddress,
    relatedTxHash: receipt?.hash ?? null,
    relatedBlockNumber: receipt?.blockNumber ?? null,
    relatedBlockTimestampIso: blockTimestampIso,
  });

  if (electionId === null) {
    redirect("/");
  }

  redirect(`/elections/${electionId}`);
}

export default async function Page() {
  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <main className="min-h-screen bg-white text-neutral-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold">Consola AEA (BU‑PVP‑1)</h1>
            <p className="text-sm text-neutral-700">
              Herramienta operativa para una instancia experimental. No apta para elecciones públicas vinculantes reales.
            </p>
          </header>

          <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
            <div className="text-sm font-medium">Configuración requerida</div>
            <div className="text-sm text-neutral-700">
              Faltan variables de entorno para iniciar la consola en modo operativo.
            </div>

            {envRes.missingKeys.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-neutral-700 font-semibold">Variables faltantes</div>
                <ul className="text-xs text-neutral-700 font-mono list-disc pl-5">
                  {envRes.missingKeys.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {envRes.problems.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-neutral-700 font-semibold">Problemas detectados</div>
                <ul className="text-xs text-neutral-700 font-mono list-disc pl-5">
                  {envRes.problems.map((p, idx) => (
                    <li key={`${p.key}:${idx}`}>{p.key}: {p.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="text-xs text-neutral-700">Crear archivo de configuración local:</div>
            <pre className="rounded-md bg-neutral-50 border border-neutral-200 p-3 text-xs overflow-x-auto">cp apps/authority-console/.env.example apps/authority-console/.env.local</pre>
            <div className="text-xs text-neutral-600">
              Luego completa <span className="font-mono">ELECTION_REGISTRY_ADDRESS</span> y las claves de AEA.
            </div>
          </section>
        </div>
      </main>
    );
  }

  const env = envRes.env;

  const electionsRes = await safeFetchJson<ElectionsApiResponse | null>(
    `${env.EVIDENCE_API_URL}/v1/elections`,
    null,
  );
  const elections = electionsRes?.elections ?? [];

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Consola AEA (BU‑PVP‑1)</h1>
          <p className="text-sm text-neutral-700">
            Herramienta operativa para una instancia experimental. No apta para elecciones públicas vinculantes reales.
          </p>
          <div className="text-xs text-neutral-500 break-all">
            chainId={env.CHAIN_ID} · contract={env.CONTRACT_ADDRESS} · API={env.EVIDENCE_API_URL}
          </div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Elecciones (lectura desde Evidence API)</div>
          {electionsRes === null ? (
            <div className="text-sm text-neutral-600">(Evidence API no disponible)</div>
          ) : elections.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin elecciones indexadas todavía)</div>
          ) : (
            <div className="space-y-2">
              {elections.map((e) => (
                <div key={e.electionId} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">Elección #{e.electionId}</div>
                      <div className="text-xs text-neutral-700 break-all">manifestHash: {e.manifestHash}</div>
                      <div className="text-xs text-neutral-700">
                        fase: {e.phaseLabel ?? String(e.phase)} · signups: {e.counts?.signups ?? 0} · ballots:{" "}
                        {e.counts?.ballots ?? 0}
                      </div>
                    </div>
                    <Link className="text-xs underline" href={`/elections/${encodeURIComponent(e.electionId)}`}>
                      abrir
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Crear elección</div>
          <form action={createElectionAction} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="title">
                Título del manifiesto
              </label>
              <input
                id="title"
                name="title"
                required
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Elección experimental BU‑PVP‑1"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="registryAuthority">
                REA (registryAuthority) — address
              </label>
              <input
                id="registryAuthority"
                name="registryAuthority"
                required
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono"
                placeholder="0x..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="coordinatorPubKey">
                coordinatorPubKey (32 bytes)
              </label>
              <input
                id="coordinatorPubKey"
                name="coordinatorPubKey"
                required
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono"
                placeholder="0x22..(64 hex)"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="notes">
                Notas (opcional)
              </label>
              <textarea
                id="notes"
                name="notes"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                rows={3}
                placeholder="Notas de contexto para auditoría post-electoral"
              />
            </div>

            <button
              type="submit"
              className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-semibold"
            >
              Crear (on-chain)
            </button>
          </form>
          <div className="text-xs text-neutral-600">
            La consola genera un manifiesto firmado (ed25519) y usa su hash como <span className="font-mono">manifestHash</span>.
          </div>
        </section>
      </div>
    </main>
  );
}
