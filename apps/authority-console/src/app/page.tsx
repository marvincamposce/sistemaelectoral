import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";
import { revalidatePath } from "next/cache";
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
import { ensureSchema, getPool, insertAdminLogEntry, upsertCandidate, upsertElectionManifest } from "../lib/db";
import { getRegistry, parseElectionCreatedFromReceipt } from "../lib/registry";
import { CreateElectionForm } from "./CreateElectionForm";

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

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function phaseBadgeClass(label: string | undefined): string {
  const value = String(label ?? "").toUpperCase();
  if (value.includes("RESULTS") || value.includes("AUDIT") || value.includes("ARCHIVE")) {
    return "badge badge-valid";
  }
  if (value.includes("VOTING") || value.includes("REGISTRY") || value.includes("PROCESSING") || value.includes("TALLY")) {
    return "badge badge-warning";
  }
  return "badge badge-info";
}

const PHASE_LABELS_ES: Record<string, string> = {
  SETUP: "Preparación",
  REGISTRY_OPEN: "Registro abierto",
  REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votación abierta",
  VOTING_CLOSED: "Votación cerrada",
  PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio",
  RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW_OPEN: "Auditoría abierta",
  ARCHIVED: "Archivada",
};

function phaseLabelEs(label: string | undefined, phase: number): string {
  const key = String(label ?? "").toUpperCase();
  return PHASE_LABELS_ES[key] ?? `Fase ${phase}`;
}

const HEX32_REGEX = /^0x[0-9a-fA-F]{64}$/;

function resolveDefaultRegistryAuthority(aeaPrivateKey: string): string {
  const fromEnv = String(process.env.DEFAULT_REGISTRY_AUTHORITY ?? "").trim();
  if (fromEnv.length > 0) {
    try {
      return ethers.getAddress(fromEnv);
    } catch {
      // Ignore invalid override and fallback to the AEA address.
    }
  }

  return new ethers.Wallet(aeaPrivateKey).address;
}

function resolveDefaultCoordinatorPubKey(): string {
  const fromEnv = String(process.env.DEFAULT_COORDINATOR_PUBKEY ?? "").trim();
  if (HEX32_REGEX.test(fromEnv)) return fromEnv;
  return "0x1111111111111111111111111111111111111111111111111111111111111111";
}

const CreateElectionInputSchema = z
  .object({
    title: z.string().min(1).max(140),
    notes: z.string().max(1000).optional(),
    registryAuthority: z.string().min(1),
    coordinatorPubKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte hex"),
    candidatesJson: z.string().optional(),
  })
  .strict();

const CandidateCatalogSchema = z
  .object({
    id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    candidateCode: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    displayName: z.string().trim().min(1).max(160),
    shortName: z.string().trim().min(1).max(80),
    partyName: z.string().trim().min(1).max(160),
    ballotOrder: z.coerce.number().int().min(1).max(9999),
    status: z.enum(["ACTIVE", "INACTIVE", "WITHDRAWN"]).default("ACTIVE"),
    colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type CandidateCatalogItem = z.infer<typeof CandidateCatalogSchema>;

function parseCandidatesCatalog(raw: string): CandidateCatalogItem[] {
  if (raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("candidatesJson debe ser JSON válido (array de candidatos)");
  }

  const arr = z.array(CandidateCatalogSchema).safeParse(parsed);
  if (!arr.success) {
    throw new Error(arr.error.message);
  }

  const byId = new Set<string>();
  const byCode = new Set<string>();
  const byOrder = new Set<number>();

  for (const c of arr.data) {
    const id = c.id.toLowerCase();
    const code = c.candidateCode.toLowerCase();
    if (byId.has(id)) throw new Error(`candidate id duplicado: ${c.id}`);
    if (byCode.has(code)) throw new Error(`candidateCode duplicado: ${c.candidateCode}`);
    if (byOrder.has(c.ballotOrder)) throw new Error(`ballotOrder duplicado: ${c.ballotOrder}`);
    byId.add(id);
    byCode.add(code);
    byOrder.add(c.ballotOrder);
  }

  return arr.data
    .slice()
    .sort((a, b) => a.ballotOrder - b.ballotOrder)
    .map((c) => ({
      ...c,
      id: c.id.trim(),
      candidateCode: c.candidateCode.trim(),
      displayName: c.displayName.trim(),
      shortName: c.shortName.trim(),
      partyName: c.partyName.trim(),
      colorHex: c.colorHex ?? undefined,
      metadata: c.metadata ?? {},
    }));
}

async function createElectionAction(formData: FormData) {
  "use server";
  const env = getEnv();

  const parsed = CreateElectionInputSchema.safeParse({
    title: String(formData.get("title") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    registryAuthority: String(formData.get("registryAuthority") ?? "").trim(),
    coordinatorPubKey: String(formData.get("coordinatorPubKey") ?? "").trim(),
    candidatesJson: String(formData.get("candidatesJson") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const contractCode = await provider.getCode(env.CONTRACT_ADDRESS);
  if (!contractCode || contractCode === "0x") {
    throw new Error(
      `No hay bytecode en ELECTION_REGISTRY_ADDRESS (${env.CONTRACT_ADDRESS}). Ejecuta ./start-dev.sh para redeploy y sincronizar direcciones.`,
    );
  }

  const registryAuthority = ethers.getAddress(parsed.data.registryAuthority);
  const coordinatorPubKey = parsed.data.coordinatorPubKey;
  const candidatesCatalog = parseCandidatesCatalog(parsed.data.candidatesJson ?? "");

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
    catalogSource: "DB_PROJECTED",
    candidates: candidatesCatalog.map((c) => ({
      id: c.id,
      candidateCode: c.candidateCode,
      displayName: c.displayName,
      shortName: c.shortName,
      partyName: c.partyName,
      ballotOrder: c.ballotOrder,
      status: c.status,
      colorHex: c.colorHex ?? null,
      metadata: c.metadata ?? {},
    })),
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

  if (electionId !== null) {
    for (const candidate of candidatesCatalog) {
      await upsertCandidate({
        pool,
        chainId: env.CHAIN_ID,
        contractAddress: env.CONTRACT_ADDRESS,
        electionId,
        id: candidate.id,
        candidateCode: candidate.candidateCode,
        displayName: candidate.displayName,
        shortName: candidate.shortName,
        partyName: candidate.partyName,
        ballotOrder: candidate.ballotOrder,
        status: candidate.status,
        colorHex: candidate.colorHex ?? null,
        metadataJson: candidate.metadata ?? {},
      });
    }

    await upsertElectionManifest({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      electionId,
      manifestHash: manifestHashHex,
      manifestJson: signedManifest,
      source: "DB_PROJECTED",
    });
  }

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
      candidatesCount: candidatesCatalog.length,
      candidateIds: candidatesCatalog.map((c) => c.id),
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
    revalidatePath("/");
    redirect("/");
  }

  revalidatePath("/");
  revalidatePath(`/elections/${electionId}`);
  redirect(`/elections/${electionId}`);
}

export default async function Page() {
  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <main className="min-h-screen text-slate-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="card p-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-3xl font-semibold">Consola AEA (BU‑PVP‑1)</h1>
              <span className="badge badge-critical">Configuración incompleta</span>
            </div>
            <p className="text-sm text-slate-700">
              Herramienta operativa para entorno local reproducible. Completa variables de entorno para habilitar operaciones on-chain.
            </p>
          </header>

          <section className="card p-4 space-y-3">
            <div className="text-sm font-medium">Configuración requerida</div>
            <div className="text-sm text-slate-700">
              Faltan variables de entorno para iniciar la consola en modo operativo.
            </div>

            {envRes.missingKeys.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-slate-700 font-semibold">Variables faltantes</div>
                <ul className="text-xs text-slate-700 font-mono list-disc pl-5">
                  {envRes.missingKeys.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {envRes.problems.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-slate-700 font-semibold">Problemas detectados</div>
                <ul className="text-xs text-slate-700 font-mono list-disc pl-5">
                  {envRes.problems.map((p, idx) => (
                    <li key={`${p.key}:${idx}`}>{p.key}: {p.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="text-xs text-slate-700">Crear archivo de configuración local:</div>
            <pre className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs overflow-x-auto">cp apps/authority-console/.env.example apps/authority-console/.env.local</pre>
            <div className="text-xs text-slate-600">
              Luego completa <span className="font-mono">ELECTION_REGISTRY_ADDRESS</span> y las claves de AEA.
            </div>
          </section>
        </div>
      </main>
    );
  }

  const env = envRes.env;
  const defaultFormValues = {
    title: `Elección Experimental ${new Date().getFullYear()}`,
    notes: "Configuración local reproducible para pruebas de inscripción, votación y auditoría.",
    registryAuthority: resolveDefaultRegistryAuthority(env.AEA_PRIVATE_KEY),
    coordinatorPubKey: resolveDefaultCoordinatorPubKey(),
  };

  const electionsRes = await safeFetchJson<ElectionsApiResponse | null>(
    `${env.EVIDENCE_API_URL}/v1/elections`,
    null,
  );
  const elections = electionsRes?.elections ?? [];
  const totalSignups = elections.reduce((acc, e) => acc + Number(e.counts?.signups ?? 0), 0);
  const totalBallots = elections.reduce((acc, e) => acc + Number(e.counts?.ballots ?? 0), 0);
  const electionsWithActivity = elections.filter(
    (e) => Number(e.counts?.signups ?? 0) > 0 || Number(e.counts?.ballots ?? 0) > 0,
  ).length;
  const latestElection = elections.length > 0 ? elections[elections.length - 1] : null;

  return (
    <main className="min-h-screen text-slate-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="card p-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold">Consola AEA (BU‑PVP‑1)</h1>
            <span className="badge badge-info">Operación AEA</span>
          </div>
          <p className="text-sm text-slate-700">
            Gestión de elecciones, transición de fases y publicación de actas con evidencia materializada.
          </p>
          <div className="text-xs text-slate-500 break-all">
            chainId={env.CHAIN_ID} · contract={env.CONTRACT_ADDRESS} · API={env.EVIDENCE_API_URL}
          </div>
          {latestElection ? (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              Última elección indexada: #{latestElection.electionId} · fase {phaseLabelEs(latestElection.phaseLabel, latestElection.phase)} · {formatTimestamp(latestElection.createdAtTimestamp)}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Elecciones</span>
            <span className="text-2xl font-semibold text-slate-900">{elections.length}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Con actividad</span>
            <span className="text-2xl font-semibold text-slate-900">{electionsWithActivity}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Inscripciones</span>
            <span className="text-2xl font-semibold text-slate-900">{totalSignups}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Boletas</span>
            <span className="text-2xl font-semibold text-slate-900">{totalBallots}</span>
          </article>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="section-title">Scope Honduras</div>
              <div className="text-sm text-slate-600">
                Censo mínimo para el proyecto: consulta de DNI, habilitación y vínculo con wallets.
              </div>
            </div>
            <Link
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              href="/honduras"
            >
              Abrir módulo
            </Link>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Elecciones</div>
          {electionsRes === null ? (
            <div className="text-sm text-slate-600">(API de evidencias no disponible)</div>
          ) : elections.length === 0 ? (
            <div className="text-sm text-slate-600">(Sin elecciones indexadas todavía)</div>
          ) : (
            <div className="space-y-2">
              {elections.map((e) => (
                <div key={e.electionId} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">Elección #{e.electionId}</div>
                        <span className={phaseBadgeClass(e.phaseLabel)}>{phaseLabelEs(e.phaseLabel, e.phase)}</span>
                      </div>
                      <div className="hash-display break-all" title={e.manifestHash}>huella de manifiesto (hash): {shortHash(e.manifestHash)}</div>
                      <div className="text-xs text-slate-700">
                        inscripciones={e.counts?.signups ?? 0} · boletas={e.counts?.ballots ?? 0}
                      </div>
                      <div className="text-xs text-slate-500">creada: {formatTimestamp(e.createdAtTimestamp)}</div>
                      <div className="hash-display break-all" title={e.createdTxHash}>tx: {shortHash(e.createdTxHash)}</div>
                    </div>
                    <Link
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      href={`/elections/${encodeURIComponent(e.electionId)}`}
                    >
                      Ver detalle
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Crear nueva elección asistida</div>
          <CreateElectionForm createElectionAction={createElectionAction} defaults={defaultFormValues} />
        </section>
      </div>
    </main>
  );
}
