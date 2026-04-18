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
  signSnapshot,
  utf8ToBytes,
} from "@blockurna/crypto";
import { BU_PVP_1_TRANSITIONS, nextPhaseFor, type ElectoralEventType } from "@blockurna/shared";
import { z } from "zod";

import { getEnv, getEnvResult } from "../../../lib/env";
import { LiveRefresh } from "../../components/LiveRefresh";
import { ActionNotice, construirRutaConAviso } from "../../components/ActionNotice";
import { PendingSubmitButton } from "../../components/PendingSubmitButton";
import { ElectionHeader } from "../../components/election/ElectionHeader";
import { ElectionCatalog } from "../../components/election/ElectionCatalog";
import { ElectionOrchestration } from "../../components/election/ElectionOrchestration";
import { ElectionEvidence } from "../../components/election/ElectionEvidence";
import { ElectionAdminLog } from "../../components/election/ElectionAdminLog";
import {
  ensureSchema,
  getCurrentElectionManifest,
  getPool,
  insertAdminLogEntry,
  listAdminLogEntries,
  listCandidates,
  updateCandidateFields,
  updateCandidateStatus,
  upsertCandidate,
  upsertElectionManifest,
  upsertIncidentLog,
  type CandidateStatus,
} from "../../../lib/db";
import { EVENT_TO_FUNCTION, getRegistry, phaseLabelFromNumber, validateTransitionOrThrow } from "../../../lib/registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ElectionPhasesResponse = {
  ok: boolean;
  chainId: string;
  contractAddress: string;
  election: {
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
  };
};

type PhaseChangesResponse = {
  ok: boolean;
  electionId: string;
  phaseChanges: Array<{
    txHash: string;
    logIndex: number;
    blockNumber: string;
    blockTimestamp: string | null;
    previousPhase: number;
    newPhase: number;
    previousPhaseLabel: string;
    newPhaseLabel: string;
  }>;
};

type AnchorsResponse = {
  ok: boolean;
  anchors: Array<{
    kind: number;
    snapshotHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

type ActsResponse = {
  ok: boolean;
  acts: Array<{
    actId: string;
    actType: string;
    anchorTxHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    contentHash: string | null;
    createdAt: string | null;
    verificationStatus?: string | null;
  }>;
};

type ConsistencyResponse = {
  ok: boolean;
  consistency:
    | null
    | {
        runId: string;
        dataVersion: string;
        computedAt: string;
        ok: boolean;
        report: any;
      };
};

type IncidentsResponse = {
  ok: boolean;
  incidents: Array<{
    fingerprint: string;
    code: string;
    severity: string;
    message: string;
    active?: boolean;
    resolvedAt?: string | null;
    lastSeenAt: string;
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

function severityBadgeClass(severity: string | undefined | null): string {
  const value = String(severity ?? "INFO").toUpperCase();
  if (value === "CRITICAL") return "badge badge-critical";
  if (value === "WARNING") return "badge badge-warning";
  if (value === "INFO") return "badge badge-info";
  return "badge badge-info";
}

function verificationBadgeClass(status: string | undefined | null): string {
  const value = String(status ?? "").toUpperCase();
  if (value === "VERIFIED" || value === "VALID") return "badge badge-valid";
  if (value === "PENDING" || value === "UNKNOWN") return "badge badge-info";
  if (value === "MISSING") return "badge badge-warning";
  if (value.length > 0) return "badge badge-critical";
  return "badge badge-info";
}

function etiquetaTipoActa(kind: string): string {
  const labels: Record<string, string> = {
    ACTA_APERTURA: "Acta de apertura",
    ACTA_CIERRE: "Acta de cierre",
    ACTA_ESCRUTINIO: "Acta de escrutinio",
    ACTA_RESULTADOS: "Acta de resultados",
  };
  return labels[kind] ?? kind;
}

const CandidateStatusSchema = z.enum(["ACTIVE", "INACTIVE", "WITHDRAWN"]);

const CandidateCatalogInputSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    candidateCode: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    displayName: z.string().trim().min(1).max(160),
    shortName: z.string().trim().min(1).max(80),
    partyName: z.string().trim().min(1).max(160),
    ballotOrder: z.coerce.number().int().min(1).max(9999),
    status: CandidateStatusSchema,
    colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    metadataJson: z.string().optional(),
  })
  .strict();

const CandidateStatusUpdateSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    status: CandidateStatusSchema,
  })
  .strict();

function isCatalogMutablePhase(phaseLabel: string): boolean {
  const p = String(phaseLabel ?? "").toUpperCase();
  return p === "SETUP" || p === "REGISTRY_OPEN" || p === "REGISTRY_CLOSED";
}

function safeParseMetadataJson(raw: string | undefined): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (text.length === 0) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadataJson debe ser un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

async function refreshManifestFromCatalog(params: {
  env: ReturnType<typeof getEnv>;
  electionId: number;
  actorAddress: string;
}): Promise<{ manifestHashHex: string; manifestFilePath: string; candidatesCount: number }> {
  const { env, electionId, actorAddress } = params;
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const candidates = await listCandidates({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
  });

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const election = await (contract as any).getElection(electionId);

  const currentManifest = await getCurrentElectionManifest({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
  });

  const currentManifestBody =
    currentManifest && typeof currentManifest.manifestJson === "object" && currentManifest.manifestJson !== null
      ? ((currentManifest.manifestJson as any).manifest ?? null)
      : null;

  const manifestBody = {
    manifestVersion: "1",
    protocolVersion: "BU-PVP-1",
    generatedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    title:
      typeof currentManifestBody?.title === "string" && currentManifestBody.title.trim().length > 0
        ? currentManifestBody.title
        : `Elección ${electionId}`,
    authority: { address: actorAddress },
    registryAuthority: { address: String(election.registryAuthority).toLowerCase() },
    coordinatorPubKey: String(election.coordinatorPubKey),
    notes:
      typeof currentManifestBody?.notes === "string" && currentManifestBody.notes.trim().length > 0
        ? currentManifestBody.notes
        : undefined,
    catalogSource: "DB_PROJECTED",
    candidates: candidates.map((c) => ({
      id: c.id,
      candidateCode: c.candidateCode,
      displayName: c.displayName,
      shortName: c.shortName,
      partyName: c.partyName,
      ballotOrder: c.ballotOrder,
      status: c.status,
      colorHex: c.colorHex,
      metadata: c.metadataJson ?? {},
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
  };

  const manifestsDir = path.join(env.ACTA_OUTPUT_DIR, "manifests");
  await fs.mkdir(manifestsDir, { recursive: true });
  const manifestFilePath = path.join(manifestsDir, `manifest_${manifestHashHex}.signed.json`);
  await fs.writeFile(manifestFilePath, JSON.stringify(signedManifest, null, 2) + "\n", "utf8");

  await upsertElectionManifest({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    manifestHash: manifestHashHex,
    manifestJson: signedManifest,
    source: "DB_PROJECTED",
  });

  return {
    manifestHashHex,
    manifestFilePath,
    candidatesCount: candidates.length,
  };
}

const EventSchema = z.enum([
  "OPEN_REGISTRY",
  "CLOSE_REGISTRY",
  "OPEN_VOTING",
  "CLOSE_VOTING",
  "START_PROCESSING",
  "FINALIZE_PROCESSING",
  "PUBLISH_RESULTS",
  "OPEN_AUDIT_WINDOW",
  "ARCHIVE_ELECTION",
]);

const TransitionInputSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    event: EventSchema,
  })
  .strict();

async function transitionPhaseAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = TransitionInputSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    event: String(formData.get("event") ?? "").trim(),
  });

  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const event = parsed.data.event as ElectoralEventType;

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const election = await (contract as any).getElection(electionId);
  const currentPhase = phaseLabelFromNumber(Number(election.phase));

  validateTransitionOrThrow({ currentPhase, event });

  const nextPhase = nextPhaseFor(currentPhase, event);

  const fn = EVENT_TO_FUNCTION[event];
  if (!fn) throw new Error(`No contract function mapping for event ${event}`);

  let receipt: ethers.TransactionReceipt | null = null;
  try {
    const tx = await (contract as any)[fn](electionId);
    receipt = await tx.wait();
  } catch {
    redirect(construirRutaConAviso(`/elections/${electionId}`, "fase-rechazada", "error"));
  }
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: event,
    message: `Phase transition executed: ${currentPhase} -> ${nextPhase}`,
    details: {
      electionId,
      currentPhase,
      event,
      txHash: receipt?.hash ?? null,
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

  revalidatePath("/");
  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "fase-actualizada"));
}

const PublishActaInputSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    kind: z.enum(["ACTA_APERTURA", "ACTA_CIERRE", "ACTA_ESCRUTINIO", "ACTA_RESULTADOS"]),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const ACTA_KIND_TO_ID: Record<string, number> = {
  ACTA_APERTURA: 0,
  ACTA_CIERRE: 1,
  ACTA_ESCRUTINIO: 2,
  ACTA_RESULTADOS: 3,
};

async function publishActaAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = PublishActaInputSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    kind: String(formData.get("kind") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const kindLabel = parsed.data.kind;
  const kindId = ACTA_KIND_TO_ID[kindLabel];
  if (kindId === undefined) throw new Error("Invalid acta kind");

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();
  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);

  const election = await (contract as any).getElection(electionId);
  const manifestHash = String(election.manifestHash);

  const chain = await provider.getNetwork();
  const toBlock = await provider.getBlockNumber();
  const signups = await (contract as any).signupCount(electionId);
  const ballots = await (contract as any).ballotCount(electionId);

  const snapshotBody = {
    snapshotVersion: "1",
    protocolVersion: "BU-PVP-1",
    electionId: String(electionId),
    kind: kindLabel,
    generatedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    blockRange: { fromBlock: Number(election.createdAtBlock), toBlock },
    commitments: {
      manifestHash,
    },
    counts: {
      signups: Number(signups),
      ballots: Number(ballots),
    },
    notes: parsed.data.notes,
  } as const;

  const signed = await signSnapshot(snapshotBody as any, env.AEA_ED25519_PRIVATE_KEY_HEX);

  // Write to ACTA_OUTPUT_DIR (root) so evidence-indexer can ingest.
  await fs.mkdir(env.ACTA_OUTPUT_DIR, { recursive: true });
  const fileName = `election_${electionId}_${kindLabel.toLowerCase()}_${signed.signature.snapshotHashHex}.signed.json`;
  const actaFilePath = path.join(env.ACTA_OUTPUT_DIR, fileName);
  await fs.writeFile(actaFilePath, JSON.stringify(signed, null, 2) + "\n", "utf8");

  let receipt: ethers.TransactionReceipt | null = null;
  try {
    const tx = await (contract as any).publishActa(
      electionId,
      kindId,
      signed.signature.snapshotHashHex,
    );
    receipt = await tx.wait();
  } catch {
    redirect(construirRutaConAviso(`/elections/${electionId}`, "acta-rechazada", "error"));
  }
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: "PUBLISH_ACTA",
    message: `Acta published (anchored): ${kindLabel}`,
    details: {
      electionId,
      kind: kindLabel,
      kindId,
      snapshotHashHex: signed.signature.snapshotHashHex,
      actaFilePath,
      networkChainId: chain.chainId.toString(),
    },
    evidencePointers: receipt
      ? [
          {
            type: "acta",
            electionId,
            kind: kindLabel,
            snapshotHashHex: signed.signature.snapshotHashHex,
          },
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

  revalidatePath("/");
  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "acta-publicada"));
}

const OperationalIncidentSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    code: z.string().min(3).max(80),
    message: z.string().min(3).max(400),
  })
  .strict();

async function registerOperationalIncidentAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = OperationalIncidentSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    severity: String(formData.get("severity") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    message: String(formData.get("message") ?? "").trim(),
  });

  if (!parsed.success) throw new Error(parsed.error.message);
  const electionId = Number(parsed.data.electionId);

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: `OP_INCIDENT:${parsed.data.code.toUpperCase()}`,
    severity: parsed.data.severity,
    message: parsed.data.message,
    details: {
      electionId,
      reporter: authorityAddress,
      reportedAt: new Date().toISOString(),
    },
    evidencePointers: [],
    actorAddress: authorityAddress,
  });

  revalidatePath("/");
  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "incidente-registrado"));
}

async function createOrUpdateCandidateAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = CandidateCatalogInputSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    id: String(formData.get("id") ?? "").trim(),
    candidateCode: String(formData.get("candidateCode") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    shortName: String(formData.get("shortName") ?? "").trim(),
    partyName: String(formData.get("partyName") ?? "").trim(),
    ballotOrder: Number(String(formData.get("ballotOrder") ?? "")),
    status: String(formData.get("status") ?? "").trim(),
    colorHex: String(formData.get("colorHex") ?? "").trim() || undefined,
    metadataJson: String(formData.get("metadataJson") ?? "").trim() || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();
  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const election = await (contract as any).getElection(electionId);
  const currentPhase = phaseLabelFromNumber(Number(election.phase));

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  if (!isCatalogMutablePhase(currentPhase)) {
    await upsertIncidentLog({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      electionId,
      fingerprint: `CANDIDATE_EDIT_OUT_OF_PHASE:${electionId}:${parsed.data.id}`,
      code: "CANDIDATE_EDIT_OUT_OF_PHASE",
      severity: "WARNING",
      message: `Intento de modificar catálogo en fase ${currentPhase}`,
      details: {
        attemptedAction: "UPSERT_CANDIDATE",
        currentPhase,
      },
      relatedEntityType: "CANDIDATE",
      relatedEntityId: parsed.data.id,
      evidencePointers: [{ type: "phase", phase: currentPhase }],
    });

    await insertAdminLogEntry({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      electionId,
      code: "CATALOG_LOCKED",
      severity: "WARNING",
      message: `Catálogo bloqueado en fase ${currentPhase}`,
      details: {
        attemptedAction: "UPSERT_CANDIDATE",
        candidateId: parsed.data.id,
      },
      actorAddress: authorityAddress,
    });

    revalidatePath(`/elections/${electionId}`);
    redirect(construirRutaConAviso(`/elections/${electionId}`, "catalogo-bloqueado", "aviso"));
  }

  const metadata = safeParseMetadataJson(parsed.data.metadataJson);

  await upsertCandidate({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    id: parsed.data.id,
    candidateCode: parsed.data.candidateCode,
    displayName: parsed.data.displayName,
    shortName: parsed.data.shortName,
    partyName: parsed.data.partyName,
    ballotOrder: parsed.data.ballotOrder,
    status: parsed.data.status,
    colorHex: parsed.data.colorHex ?? null,
    metadataJson: metadata,
  });

  const duplicatedOrderRes = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM candidates
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND ballot_order=$4`,
    [env.CHAIN_ID, env.CONTRACT_ADDRESS, electionId, parsed.data.ballotOrder],
  );

  if ((duplicatedOrderRes.rows[0]?.n ?? 0) > 1) {
    await upsertIncidentLog({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      electionId,
      fingerprint: `CANDIDATE_BALLOT_ORDER_DUPLICATE:${electionId}:${parsed.data.ballotOrder}`,
      code: "CANDIDATE_BALLOT_ORDER_DUPLICATE",
      severity: "CRITICAL",
      message: `ballotOrder repetido (${parsed.data.ballotOrder}) en catálogo`,
      details: {
        ballotOrder: parsed.data.ballotOrder,
      },
      relatedEntityType: "CANDIDATE",
      relatedEntityId: parsed.data.id,
      evidencePointers: [{ type: "candidate", id: parsed.data.id }],
    });
  }

  const manifestInfo = await refreshManifestFromCatalog({
    env,
    electionId,
    actorAddress: authorityAddress,
  });

  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: "UPSERT_CANDIDATE",
    message: `Candidato guardado: ${parsed.data.displayName}`,
    details: {
      candidateId: parsed.data.id,
      candidateCode: parsed.data.candidateCode,
      ballotOrder: parsed.data.ballotOrder,
      status: parsed.data.status,
      manifestHashHex: manifestInfo.manifestHashHex,
      manifestFilePath: manifestInfo.manifestFilePath,
      candidatesCount: manifestInfo.candidatesCount,
      phase: currentPhase,
    },
    actorAddress: authorityAddress,
  });

  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "candidatura-guardada"));
}

async function updateCandidateStatusAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = CandidateStatusUpdateSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    id: String(formData.get("id") ?? "").trim(),
    status: String(formData.get("status") ?? "").trim(),
  });
  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();
  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const election = await (contract as any).getElection(electionId);
  const currentPhase = phaseLabelFromNumber(Number(election.phase));

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  if (!isCatalogMutablePhase(currentPhase)) {
    await upsertIncidentLog({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      electionId,
      fingerprint: `CANDIDATE_EDIT_OUT_OF_PHASE:${electionId}:${parsed.data.id}:status`,
      code: "CANDIDATE_EDIT_OUT_OF_PHASE",
      severity: "WARNING",
      message: `Intento de cambiar status fuera de fase (${currentPhase})`,
      details: {
        attemptedAction: "UPDATE_CANDIDATE_STATUS",
        currentPhase,
      },
      relatedEntityType: "CANDIDATE",
      relatedEntityId: parsed.data.id,
      evidencePointers: [{ type: "phase", phase: currentPhase }],
    });
    revalidatePath(`/elections/${electionId}`);
    redirect(construirRutaConAviso(`/elections/${electionId}`, "catalogo-bloqueado", "aviso"));
  }

  const updated = await updateCandidateStatus({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    id: parsed.data.id,
    status: parsed.data.status,
  });

  if (updated === 0) throw new Error("candidate_not_found");

  const manifestInfo = await refreshManifestFromCatalog({
    env,
    electionId,
    actorAddress: authorityAddress,
  });

  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: "UPDATE_CANDIDATE_STATUS",
    message: `Estado de candidato actualizado (${parsed.data.id} -> ${parsed.data.status})`,
    details: {
      candidateId: parsed.data.id,
      status: parsed.data.status,
      manifestHashHex: manifestInfo.manifestHashHex,
      manifestFilePath: manifestInfo.manifestFilePath,
      phase: currentPhase,
    },
    actorAddress: authorityAddress,
  });

  revalidatePath(`/elections/${electionId}`);
  redirect(construirRutaConAviso(`/elections/${electionId}`, "candidatura-estado-actualizado"));
}

function eventLabel(e: ElectoralEventType): string {
  const map: Record<ElectoralEventType, string> = {
    OPEN_REGISTRY: "Abrir registro (REA)",
    CLOSE_REGISTRY: "Cerrar registro",
    OPEN_VOTING: "Abrir votación",
    CLOSE_VOTING: "Cerrar votación",
    START_PROCESSING: "Iniciar processing",
    FINALIZE_PROCESSING: "Finalizar processing",
    PUBLISH_RESULTS: "Publicar resultados",
    OPEN_AUDIT_WINDOW: "Abrir ventana de auditoría",
    ARCHIVE_ELECTION: "Archivar elección",
  };
  return map[e] ?? e;
}

export default async function ElectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ aviso?: string; tipo?: string }>;
}) {
  const resolved = await params;
  const query = searchParams ? await searchParams : undefined;
  const electionIdStr = String(resolved.id);
  const electionId = Number(electionIdStr);

  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <main className="min-h-screen text-slate-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <ActionNotice codigo={query?.aviso} tipo={query?.tipo} />
        <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Elección #{electionIdStr}</h1>
              <Link className="text-xs underline" href="/">
                volver
              </Link>
            </div>
            <div className="text-sm text-slate-700">
              Consola operativa de la elección con evidencia materializada, control administrativo y trazabilidad.
            </div>
          </header>

          <section className="card p-4 space-y-3">
            <div className="text-sm font-medium">Configuración requerida</div>
            <div className="text-sm text-slate-700">
              Faltan variables de entorno para operar la consola AEA.
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
          </section>
        </div>
      </main>
    );
  }

  const env = envRes.env;

  const [phasesRes, phaseChangesRes, anchorsRes, actsRes, consistencyRes, incidentsRes] = await Promise.all([
    fetchJsonOrNull<ElectionPhasesResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phases`),
    fetchJsonOrNull<PhaseChangesResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phase-changes`),
    fetchJsonOrNull<AnchorsResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/anchors`),
    fetchJsonOrNull<ActsResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/acts`),
    fetchJsonOrNull<ConsistencyResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/consistency`),
    fetchJsonOrNull<IncidentsResponse>(`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/incidents`),
  ]);

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  const adminLog = await listAdminLogEntries({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    limit: 50,
  });

  const candidates = await listCandidates({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
  });

  const currentManifest = await getCurrentElectionManifest({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
  });

  const currentPhaseLabel = phasesRes?.ok ? phasesRes.election.phaseLabel : "UNKNOWN";
  const catalogMutable = isCatalogMutablePhase(currentPhaseLabel);

  const ballotOrderCollisionMap = candidates.reduce<Record<number, number>>((acc, c) => {
    acc[c.ballotOrder] = (acc[c.ballotOrder] ?? 0) + 1;
    return acc;
  }, {});
  const hasBallotOrderCollisions = Object.values(ballotOrderCollisionMap).some((count) => count > 1);

  const availableEvents = BU_PVP_1_TRANSITIONS.filter((t) => t.from === currentPhaseLabel).map(
    (t) => t.event as ElectoralEventType,
  );

  const activeIncidents = (incidentsRes?.incidents ?? []).filter((i) => i.active !== false);
  const criticalActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "CRITICAL").length;
  const warningActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "WARNING").length;
  const infoActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "INFO").length;
  const consistencyOk = consistencyRes?.consistency?.ok === true;
  const latestTransition = phaseChangesRes?.phaseChanges?.[0] ?? null;
  const latestAct = actsRes?.acts?.[0] ?? null;
  const evidenceApiUnavailable =
    !phasesRes || !phaseChangesRes || !anchorsRes || !actsRes || !consistencyRes || !incidentsRes;

  return (
    <div>
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <ActionNotice codigo={query?.aviso} tipo={query?.tipo} />
          <LiveRefresh label="Estado de elección en vivo" intervalMs={15000} />
        </div>

        <ElectionHeader
          electionIdStr={electionIdStr}
          chainId={env.CHAIN_ID}
          contractAddress={env.CONTRACT_ADDRESS}
          apiUrl={env.EVIDENCE_API_URL}
          phasesRes={phasesRes}
          phaseChangesRes={phaseChangesRes}
          anchorsRes={anchorsRes}
          actsRes={actsRes}
          activeIncidents={activeIncidents}
          evidenceApiUnavailable={evidenceApiUnavailable}
        />

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="admin-card p-5 space-y-4">
            <div>
              <div className="admin-section-title m-0">Qué puedes hacer aquí</div>
              <div className="text-sm text-slate-600 mt-1">
                Esta vista concentra cuatro frentes: estado on-chain, catálogo oficial, transición de fases y evidencia administrativa.
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["Revisar estado", "Confirma manifest, coordinator key, autoridades y fase actual antes de tocar nada."],
                ["Editar catálogo", "Solo mientras la fase lo permita. Cada cambio regenera el manifiesto materializado."],
                ["Mover fases", "Dispara transiciones on-chain solo cuando el proceso operativo ya esté listo."],
                ["Anclar evidencia", "Publica actas e incidentes con contexto trazable para observer e indexación."],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="mt-2 text-xs text-slate-600">{copy}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card p-5 space-y-4">
            <div>
              <div className="admin-section-title m-0">Lectura rápida</div>
              <div className="text-sm text-slate-600 mt-1">Resumen corto para operadores antes de entrar a la parte técnica.</div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Fase actual</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{currentPhaseLabel}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Catálogo</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{catalogMutable ? "Editable" : "Bloqueado por fase"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incidentes</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{activeIncidents.length} activo(s)</div>
              </div>
            </div>
          </section>
        </section>


      </div>
    </div>
  );
}
