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

  const tx = await (contract as any)[fn](electionId);
  const receipt = await tx.wait();
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
  redirect(`/elections/${electionId}`);
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

  const tx = await (contract as any).publishActa(
    electionId,
    kindId,
    signed.signature.snapshotHashHex,
  );
  const receipt = await tx.wait();
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
  redirect(`/elections/${electionId}`);
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
  redirect(`/elections/${electionId}`);
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
    redirect(`/elections/${electionId}`);
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
  redirect(`/elections/${electionId}`);
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
    redirect(`/elections/${electionId}`);
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
  redirect(`/elections/${electionId}`);
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
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  const electionIdStr = String(resolved.id);
  const electionId = Number(electionIdStr);

  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <main className="min-h-screen text-slate-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Elección #{electionIdStr}</h1>
              <Link className="text-xs underline" href="/">
                volver
              </Link>
            </div>
            <div className="text-sm text-slate-700">
              Consola operativa para investigación (instancia experimental). No apta para elecciones públicas vinculantes reales.
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
    safeFetchJson<ElectionPhasesResponse | null>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phases`,
      null,
    ),
    safeFetchJson<PhaseChangesResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phase-changes`,
      { ok: true, electionId: electionIdStr, phaseChanges: [] },
    ),
    safeFetchJson<AnchorsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/anchors`,
      { ok: true, anchors: [] },
    ),
    safeFetchJson<ActsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/acts`,
      { ok: true, acts: [] },
    ),
    safeFetchJson<ConsistencyResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/consistency`,
      { ok: true, consistency: null },
    ),
    safeFetchJson<IncidentsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/incidents`,
      { ok: true, incidents: [] },
    ),
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

  const activeIncidents = (incidentsRes.incidents ?? []).filter((i) => i.active !== false);
  const criticalActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "CRITICAL").length;
  const warningActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "WARNING").length;
  const infoActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "INFO").length;
  const consistencyOk = consistencyRes.consistency?.ok === true;
  const latestTransition = phaseChangesRes.phaseChanges[0] ?? null;
  const latestAct = actsRes.acts[0] ?? null;

  return (
    <main className="min-h-screen text-slate-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="card p-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">Elección #{electionIdStr}</h1>
              <div className="text-xs text-slate-500 break-all">
                chainId={env.CHAIN_ID} · contract={env.CONTRACT_ADDRESS} · API={env.EVIDENCE_API_URL}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={phasesRes?.ok ? phaseBadgeClass(phasesRes.election.phaseLabel) : "badge badge-critical"}>
                {phasesRes?.ok ? phasesRes.election.phaseLabel : "PHASE N/A"}
              </span>
              <Link
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                href="/"
              >
                volver
              </Link>
            </div>
          </div>
          <div className="text-sm text-slate-700">
            Consola operativa para investigación (instancia experimental). No apta para elecciones públicas vinculantes reales.
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Transiciones</span>
            <span className="text-2xl font-semibold text-slate-900">{phaseChangesRes.phaseChanges.length}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Anchors</span>
            <span className="text-2xl font-semibold text-slate-900">{anchorsRes.anchors.length}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Actas</span>
            <span className="text-2xl font-semibold text-slate-900">{actsRes.acts.length}</span>
          </article>
          <article className="stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Incidentes activos</span>
            <span className="text-2xl font-semibold text-slate-900">{activeIncidents.length}</span>
          </article>
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Estado</div>
          {phasesRes?.ok ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-700">manifestHash</div>
                  <div className="hash-display" title={phasesRes.election.manifestHash}>{shortHash(phasesRes.election.manifestHash)}</div>
                </div>
                <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-700">coordinatorPubKey</div>
                  <div className="hash-display" title={phasesRes.election.coordinatorPubKey}>{shortHash(phasesRes.election.coordinatorPubKey)}</div>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="text-xs text-slate-700 break-all">authority (AEA): {phasesRes.election.authority}</div>
                <div className="text-xs text-slate-700 break-all">registryAuthority (REA): {phasesRes.election.registryAuthority}</div>
                <div className="text-xs text-slate-700">fase actual: {phasesRes.election.phaseLabel}</div>
                <div className="text-xs text-slate-700">creada: {formatTimestamp(phasesRes.election.createdAtTimestamp)}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">
              (No se pudo cargar metadata desde Evidence API; verifica que indexer+api apunten al mismo contrato)
            </div>
          )}
        </section>

        <section className="card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="section-title">Catálogo oficial de candidaturas</div>
            <span className={catalogMutable ? "badge badge-valid" : "badge badge-warning"}>
              {catalogMutable ? "editable" : "bloqueado por fase"}
            </span>
          </div>

          <div className="text-xs text-slate-700">
            Fuente de verdad: DB proyectada a manifiesto. Cambios en catálogo regeneran manifiesto materializado mientras la fase sea SETUP/REGISTRY_OPEN/REGISTRY_CLOSED.
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Candidatos</span>
              <span className="text-2xl font-semibold text-slate-900">{candidates.length}</span>
            </article>
            <article className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Activos</span>
              <span className="text-2xl font-semibold text-slate-900">
                {candidates.filter((c) => c.status === "ACTIVE").length}
              </span>
            </article>
            <article className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Manifiesto actual</span>
              <span className="text-sm font-mono text-slate-900 break-all">
                {shortHash(currentManifest?.manifestHash ?? null)}
              </span>
            </article>
            <article className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Ballot order</span>
              <span className="text-sm font-semibold text-slate-900">
                {hasBallotOrderCollisions ? "duplicado detectado" : "consistente"}
              </span>
            </article>
          </div>

          <form action={createOrUpdateCandidateAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="electionId" value={electionIdStr} />
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-id">candidateId</label>
              <input id="cand-id" name="id" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="cand-4" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-code">candidateCode</label>
              <input id="cand-code" name="candidateCode" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="CAND_4" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-display">displayName</label>
              <input id="cand-display" name="displayName" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Nombre completo" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-short">shortName</label>
              <input id="cand-short" name="shortName" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="N. Corta" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-party">partyName</label>
              <input id="cand-party" name="partyName" required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Partido" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-order">ballotOrder</label>
              <input id="cand-order" name="ballotOrder" type="number" min={1} required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" defaultValue={Math.max(1, candidates.length + 1)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-status">status</label>
              <select id="cand-status" name="status" defaultValue="ACTIVE" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs">
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
                <option value="WITHDRAWN">WITHDRAWN</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="cand-color">colorHex</label>
              <input id="cand-color" name="colorHex" className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="#1D4ED8" />
            </div>
            <div className="space-y-1 md:col-span-2 lg:col-span-4">
              <label className="text-xs text-slate-700" htmlFor="cand-meta">metadataJson (opcional)</label>
              <textarea id="cand-meta" name="metadataJson" rows={2} className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-mono" placeholder='{"coalitionName":"Frente","region":"Norte"}' />
            </div>
            <div className="md:col-span-2 lg:col-span-4">
              <button type="submit" disabled={!catalogMutable} className="rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 px-4 py-2 text-sm font-semibold">
                Guardar candidatura y regenerar manifiesto
              </button>
            </div>
          </form>

          {candidates.length === 0 ? (
            <div className="text-sm text-slate-600">(Sin candidaturas registradas)</div>
          ) : (
            <div className="space-y-3">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-md border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">
                      {candidate.displayName} <span className="text-xs text-slate-500">({candidate.candidateCode})</span>
                    </div>
                    <span className={candidate.status === "ACTIVE" ? "badge badge-valid" : "badge badge-warning"}>{candidate.status}</span>
                  </div>
                  <div className="text-xs text-slate-700">{candidate.partyName} · Orden {candidate.ballotOrder}</div>

                  <form action={createOrUpdateCandidateAction} className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                    <input type="hidden" name="electionId" value={electionIdStr} />
                    <input type="hidden" name="id" value={candidate.id} />
                    <input type="hidden" name="candidateCode" value={candidate.candidateCode} />
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">displayName</label>
                      <input name="displayName" defaultValue={candidate.displayName} required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">shortName</label>
                      <input name="shortName" defaultValue={candidate.shortName} required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">partyName</label>
                      <input name="partyName" defaultValue={candidate.partyName} required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">ballotOrder</label>
                      <input name="ballotOrder" type="number" min={1} defaultValue={candidate.ballotOrder} required className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">status</label>
                      <select name="status" defaultValue={candidate.status} className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs">
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                        <option value="WITHDRAWN">WITHDRAWN</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-600">colorHex</label>
                      <input name="colorHex" defaultValue={candidate.colorHex ?? ""} className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div className="space-y-1 md:col-span-2 lg:col-span-2">
                      <label className="text-[11px] text-slate-600">metadataJson</label>
                      <input
                        name="metadataJson"
                        defaultValue={JSON.stringify(candidate.metadataJson ?? {})}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                    <div className="md:col-span-2 lg:col-span-4 flex items-center gap-2">
                      <button type="submit" disabled={!catalogMutable} className="rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 px-3 py-1.5 text-xs font-semibold">
                        Guardar cambios
                      </button>
                    </div>
                  </form>

                  <form action={updateCandidateStatusAction} className="flex items-center gap-2">
                    <input type="hidden" name="electionId" value={electionIdStr} />
                    <input type="hidden" name="id" value={candidate.id} />
                    <select name="status" defaultValue={candidate.status} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                      <option value="WITHDRAWN">WITHDRAWN</option>
                    </select>
                    <button type="submit" disabled={!catalogMutable} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:text-slate-400">
                      Actualizar estado
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          {currentManifest ? (
            <div className="text-xs text-slate-600 break-all">
              manifiesto materializado actual: {currentManifest.manifestHash} · actualizado: {formatTimestamp(currentManifest.updatedAt)}
            </div>
          ) : (
            <div className="text-xs text-slate-600">No hay manifiesto materializado aún para esta elección.</div>
          )}
        </section>

        <section className="card p-6 space-y-4 border-indigo-100 shadow-md">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Orquestación de Fases (Smart Contract)</h3>
          </div>
          {availableEvents.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 text-center">
              <p className="text-sm font-medium text-slate-600">Ningún cambio de estado disponible desde <span className="font-bold text-indigo-700">{currentPhaseLabel}</span>.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {availableEvents.map((event) => (
                <form key={event} action={transitionPhaseAction} className="w-full">
                  <input type="hidden" name="electionId" value={electionIdStr} />
                  <input type="hidden" name="event" value={event} />
                  <button
                    type="submit"
                    className="w-full flex items-center justify-between rounded-xl bg-slate-900 text-white hover:bg-black transition-all px-5 py-4 text-sm font-extrabold tracking-wide shadow-md hover:shadow-lg focus:ring-4 focus:ring-indigo-100 group"
                  >
                    <span className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-indigo-400 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      EJECUTAR: {eventLabel(event)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">ON-CHAIN TX</span>
                  </button>
                </form>
              ))}
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-3">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              <strong>Atención:</strong> La máquina de estados oficial de BlockUrna (BU-PVP-1) se encuentra inyectada y auditada a nivel Smart Contract. Cualquier transición ilícita revertirá la transacción perdiendo los gas fees.
            </p>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Publicar acta digital (firma + anchor)</div>
          <form action={publishActaAction} className="space-y-3">
            <input type="hidden" name="electionId" value={electionIdStr} />
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="kind">
                Tipo
              </label>
              <select id="kind" name="kind" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="ACTA_APERTURA">ACTA_APERTURA</option>
                <option value="ACTA_CIERRE">ACTA_CIERRE</option>
                <option value="ACTA_ESCRUTINIO">ACTA_ESCRUTINIO</option>
                <option value="ACTA_RESULTADOS">ACTA_RESULTADOS</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="notes">
                Notas (opcional)
              </label>
              <textarea
                id="notes"
                name="notes"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={3}
                placeholder="Contexto de la publicación del acta"
              />
            </div>
            <button type="submit" className="rounded-md bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 text-sm font-semibold">
              Firmar (ed25519) + anclar on-chain
            </button>
          </form>
          <div className="text-xs text-slate-600">
            El JSON firmado se escribe en <span className="font-mono">ACTA_OUTPUT_DIR</span> para que el evidence-indexer lo materialice en Postgres.
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Consistencia e incidentes (lectura Evidence API)</div>
          <div className="flex flex-wrap gap-2">
            <span className="badge badge-critical">CRITICAL: {criticalActive}</span>
            <span className="badge badge-warning">WARNING: {warningActive}</span>
            <span className="badge badge-info">INFO: {infoActive}</span>
            <span className={consistencyOk ? "badge badge-valid" : "badge badge-warning"}>
              consistencia: {consistencyOk ? "ok" : "pendiente/revisión"}
            </span>
          </div>
          <div className="text-xs text-slate-700">
            Última corrida: {formatTimestamp(consistencyRes.consistency?.computedAt)}
          </div>
          <div className="text-xs text-slate-600 break-all">
            JSON: {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/consistency · {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/incidents
          </div>
          {activeIncidents.length > 0 ? (
            <div className="space-y-2">
              {activeIncidents.slice(0, 5).map((incident) => (
                <div key={incident.fingerprint} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900">{incident.code}</div>
                    <span className={severityBadgeClass(incident.severity)}>{incident.severity}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-700">{incident.message}</div>
                  <div className="mt-1 text-xs text-slate-500">último evento: {formatTimestamp(incident.lastSeenAt)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">(Sin incidentes activos)</div>
          )}
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Anchors y actas</div>
          <div className="text-xs text-slate-700">Anchors: {anchorsRes.anchors.length} · Actas (referencias): {actsRes.acts.length}</div>
          {latestAct ? (
            <div className="text-xs text-slate-700">
              Última acta: {latestAct.actType} · {formatTimestamp(latestAct.blockTimestamp ?? latestAct.createdAt)}
            </div>
          ) : null}
          <div className="text-xs text-slate-600 break-all">
            JSON: {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/anchors · {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/acts
          </div>
          {actsRes.acts.length > 0 ? (
            <div className="space-y-2">
              {actsRes.acts.slice(0, 10).map((a) => (
                <div key={a.actId} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900">{a.actType}</div>
                    <span className={verificationBadgeClass(a.verificationStatus)}>
                      {a.verificationStatus ?? "SIN_VERIFICAR"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-700">actId: {a.actId}</div>
                  <div className="hash-display mt-1" title={a.anchorTxHash}>anchorTx: {shortHash(a.anchorTxHash)}</div>
                  {a.contentHash ? (
                    <div className="hash-display mt-1" title={a.contentHash}>contentHash: {shortHash(a.contentHash)}</div>
                  ) : null}
                  <div className="mt-1 text-xs text-slate-700">createdAt: {formatTimestamp(a.createdAt)}</div>
                  <div className="text-xs">
                    <a
                      className="underline"
                      href={`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/acts/${encodeURIComponent(
                        a.actId,
                      )}/content`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      descargar contenido firmado
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="card p-6 space-y-3 bg-slate-950 border-slate-900 shadow-inner">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <h3 className="text-sm font-bold text-slate-100 font-mono tracking-widest">/var/log/aea/admin.log</h3>
            </div>
            <div className="text-[10px] text-slate-500 font-mono flex gap-3">
              <a className="hover:text-amber-400 transition-colors" href={`/api/elections/${encodeURIComponent(electionIdStr)}/admin-log`}>[EXPORT JSON]</a>
              <a className="hover:text-amber-400 transition-colors" href={`/api/elections/${encodeURIComponent(electionIdStr)}/manifest`}>[MANIFEST]</a>
            </div>
          </div>
          {adminLog.length === 0 ? (
            <div className="text-xs text-slate-600 font-mono py-4">{'>> EOF - No hay entradas aún'}</div>
          ) : (
            <div className="space-y-1 font-mono text-[11px] h-64 overflow-y-auto pr-2 custom-scrollbar">
              {adminLog.map((e) => (
                <div key={e.entryId} className="border-l-2 border-slate-800 pl-3 py-1 hover:bg-slate-900 transition-colors group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">[{formatTimestamp(e.createdAt)}]</span>
                        {e.severity === 'CRITICAL' ? (
                          <span className="text-rose-500 font-bold">[{e.severity}]</span>
                        ) : e.severity === 'WARNING' ? (
                          <span className="text-amber-400 font-bold">[{e.severity}]</span>
                        ) : (
                          <span className="text-sky-400 font-bold">[{e.severity || 'INFO'}]</span>
                        )}
                        <span className="text-indigo-300 font-semibold">{e.code}</span>
                      </div>
                      <div className="text-slate-300 group-hover:text-white transition-colors">{'>'} {e.message}</div>
                      {e.relatedTxHash ? (
                        <div className="text-slate-500 flex items-center gap-1 mt-1">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                          TX: <span className="text-slate-400">{e.relatedTxHash}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="text-[9px] text-slate-700">IDX:{e.entryId}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Registrar incidente operativo (bitácora)</div>
          <form action={registerOperationalIncidentAction} className="space-y-3">
            <input type="hidden" name="electionId" value={electionIdStr} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-700" htmlFor="severity">
                  Severidad
                </label>
                <select
                  id="severity"
                  name="severity"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="INFO">INFO</option>
                  <option value="WARNING">WARNING</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-700" htmlFor="code">
                  Código
                </label>
                <input
                  id="code"
                  name="code"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="ej: OPERATOR_NOTE"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-700" htmlFor="message">
                Mensaje
              </label>
              <input
                id="message"
                name="message"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Descripción del incidente operativo"
                required
              />
            </div>
            <button type="submit" className="rounded-md bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 text-sm font-semibold">
              Registrar
            </button>
          </form>
          <div className="text-xs text-slate-600">
            Registro off-chain en Postgres (bitácora). No se interpreta como evidencia on-chain.
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="section-title">Timeline de transiciones</div>
          {latestTransition ? (
            <div className="text-xs text-slate-700">
              Última transición: {latestTransition.previousPhaseLabel} → {latestTransition.newPhaseLabel} · {formatTimestamp(latestTransition.blockTimestamp)}
            </div>
          ) : null}
          {phaseChangesRes.phaseChanges.length === 0 ? (
            <div className="text-sm text-slate-600">(Sin phase-changes indexados)</div>
          ) : (
            <div className="space-y-2">
              {phaseChangesRes.phaseChanges.map((p) => (
                <div key={`${p.txHash}:${p.logIndex}`} className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">{formatTimestamp(p.blockTimestamp)}</div>
                  <div className="text-xs text-slate-700">
                    {p.previousPhaseLabel} → {p.newPhaseLabel}
                  </div>
                  <div className="hash-display mt-1" title={p.txHash}>txHash: {shortHash(p.txHash)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
