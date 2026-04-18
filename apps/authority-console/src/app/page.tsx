import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ethers } from "ethers";
import {
  canonicalizeJson,
  deriveCoordinatorPublicKey,
  getPublicKeyHex,
  isValidZkFriendlyCoordinatorPublicKey,
  sha256Hex,
  signEd25519Hex,
  utf8ToBytes,
} from "@blockurna/crypto";
import { z } from "zod";

import { getEnv, getEnvResult } from "../lib/env";
import { ensureSchema, getPool, insertAdminLogEntry, upsertCandidate, upsertElectionManifest } from "../lib/db";
import { getRegistry, parseElectionCreatedFromReceipt } from "../lib/registry";
import { LiveRefresh } from "./components/LiveRefresh";
import { ActionNotice, construirRutaConAviso } from "./components/ActionNotice";
import { CreateElectionForm } from "./CreateElectionForm";
import { DashboardStats } from "./components/DashboardStats";
import { ElectionList } from "./components/ElectionList";
import { SystemStatus } from "./components/SystemStatus";

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

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return null;
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
const DEFAULT_LOCAL_COORDINATOR_PRIVATE_KEY =
  "0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa";

function resolveDefaultRegistryAuthority(aeaPrivateKey: string): string {
  const fromEnv = String(process.env.DEFAULT_REGISTRY_AUTHORITY ?? "").trim();
  if (fromEnv.length > 0) {
    try {
      return ethers.getAddress(fromEnv);
    } catch {
      // Ignore invalid override and keep the AEA address as the effective default.
    }
  }

  return new ethers.Wallet(aeaPrivateKey).address;
}

async function resolveDefaultCoordinatorPubKey(): Promise<string> {
  const fromEnv = String(process.env.DEFAULT_COORDINATOR_PUBKEY ?? "").trim();
  if (HEX32_REGEX.test(fromEnv) && (await isValidZkFriendlyCoordinatorPublicKey(fromEnv))) {
    return fromEnv;
  }

  const coordinatorPrivateKey =
    String(process.env.COORDINATOR_PRIVATE_KEY ?? "").trim() || DEFAULT_LOCAL_COORDINATOR_PRIVATE_KEY;
  if (HEX32_REGEX.test(coordinatorPrivateKey)) {
    try {
      return await deriveCoordinatorPublicKey(coordinatorPrivateKey);
    } catch {
      // Ignore invalid derivation and require explicit operator input.
    }
  }
  return "";
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
  const coordinatorPubKey = parsed.data.coordinatorPubKey.toLowerCase();
  const validCoordinatorPubKey = await isValidZkFriendlyCoordinatorPublicKey(coordinatorPubKey);
  if (!validCoordinatorPubKey) {
    throw new Error(
      "coordinatorPubKey invalida para cifrado ZK. Debe ser una clave BabyJub comprimida de 32 bytes derivada desde COORDINATOR_PRIVATE_KEY.",
    );
  }
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
    redirect(construirRutaConAviso("/", "eleccion-creada"));
  }

  revalidatePath("/");
  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "eleccion-creada"));
}

export default async function Page(props: {
  searchParams?: Promise<{ aviso?: string; tipo?: string }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <div className="space-y-6">
        <header className="admin-card p-6 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="admin-page-title m-0">Configuración Incompleta</h1>
            <span className="admin-badge admin-badge-error">Faltan Variables</span>
          </div>
          <p className="admin-page-subtitle">
            Completa las variables de entorno para habilitar operaciones on-chain.
          </p>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            {envRes.missingKeys.length > 0 && (
              <div className="mb-4">
                <div className="text-sm font-bold text-slate-800 mb-2">Variables faltantes:</div>
                <ul className="list-disc pl-5 text-sm text-slate-600 font-mono">
                  {envRes.missingKeys.map(k => <li key={k}>{k}</li>)}
                </ul>
              </div>
            )}
            {envRes.problems.length > 0 && (
              <div>
                <div className="text-sm font-bold text-slate-800 mb-2">Problemas detectados:</div>
                <ul className="list-disc pl-5 text-sm text-slate-600">
                  {envRes.problems.map((p, idx) => <li key={`${p.key}:${idx}`}>{p.key}: {p.message}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-200">
              <div className="text-xs text-slate-600 mb-2">Comando rápido:</div>
              <code className="admin-hash block p-3 bg-white">cp apps/authority-console/.env.example apps/authority-console/.env.local</code>
            </div>
          </div>
        </header>
      </div>
    );
  }

  const env = envRes.env;
  const defaultFormValues = {
    title: `Elección Local Reproducible ${new Date().getFullYear()}`,
    notes: "Configuración local reproducible para pruebas de inscripción, votación y auditoría.",
    registryAuthority: resolveDefaultRegistryAuthority(env.AEA_PRIVATE_KEY),
    coordinatorPubKey: await resolveDefaultCoordinatorPubKey(),
  };

  const electionsRes = await fetchJsonOrNull<ElectionsApiResponse>(`${env.EVIDENCE_API_URL}/v1/elections`);
  const elections = electionsRes?.elections ?? [];
  const totalSignups = elections.reduce((acc, e) => acc + Number(e.counts?.signups ?? 0), 0);
  const totalBallots = elections.reduce((acc, e) => acc + Number(e.counts?.ballots ?? 0), 0);
  const electionsWithActivity = elections.filter(
    (e) => Number(e.counts?.signups ?? 0) > 0 || Number(e.counts?.ballots ?? 0) > 0,
  ).length;
  const latestElection = elections.length > 0 ? elections[elections.length - 1] : null;
  const mostRecentThree = elections.slice().sort((a, b) => Number(b.electionId) - Number(a.electionId)).slice(0, 3);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="admin-page-title">Panel de Control</h1>
          <p className="admin-page-subtitle mb-0">Vista general operativa de elecciones activas e indexación.</p>
        </div>
        <LiveRefresh label="Consola en vivo" intervalMs={15000} />
      </div>

      <ActionNotice codigo={searchParams?.aviso} tipo={searchParams?.tipo} />

      {/* Metrics Row */}
      <DashboardStats
        electionsTotal={elections.length}
        electionsActive={electionsWithActivity}
        totalSignups={totalSignups}
        totalBallots={totalBallots}
      />

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Left Column */}
        <div className="space-y-8">
          <div className="admin-card">
            <div className="admin-card-header">
              <h2 className="admin-section-title mb-0">Crear Nueva Elección</h2>
            </div>
            <div className="admin-card-body">
              <CreateElectionForm createElectionAction={createElectionAction} defaults={defaultFormValues} />
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          <ElectionList elections={mostRecentThree} phaseLabelEs={phaseLabelEs} />
          <SystemStatus chainId={env.CHAIN_ID} contractAddress={env.CONTRACT_ADDRESS} />
        </div>
      </div>
    </div>
  );
}
