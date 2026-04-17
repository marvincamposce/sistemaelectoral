"use server";

import { ethers } from "ethers";
import { getEnv } from "@/lib/env";
import {
  BU_PVP_1_ELECTION_REGISTRY_ABI,
  BU_PVP_1_TALLY_VERIFIER_ABI,
} from "@blockurna/sdk";
import {
  buildPoseidonMerkleBundleFromBallotHashes,
  decodeBallotCiphertextEnvelope,
  decryptBallotPayload,
  deriveBallotMerkleRoot,
  deriveZkFriendlySelectionWitnessData,
  parseThresholdSharePayload,
  reconstructCoordinatorKeyFromShares,
  signActaECDSA,
  splitCoordinatorKey2of3,
} from "@blockurna/crypto";

import { pool } from "@/lib/db";
import crypto from "crypto";
import {
  buildDecryptionWitness,
  buildWitnessFromTranscript,
  checkArtifactsForCircuit,
  proveDecryption,
  proveTally,
  verifyDecryptionProof,
  verifyTallyProof,
  checkArtifacts as checkZkArtifacts,
  CIRCUIT_ID as ZK_CIRCUIT_ID,
  DECRYPTION_CIRCUIT_ID as ZK_DECRYPTION_CIRCUIT_ID,
  PROOF_SYSTEM as ZK_PROOF_SYSTEM,
  NUM_CANDIDATES as ZK_NUM_CANDIDATES,
} from "@blockurna/zk-tally";

function getContract() {
  const env = getEnv();
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AE_PRIVATE_KEY, provider);
  return new ethers.Contract(env.ELECTION_REGISTRY_ADDRESS, BU_PVP_1_ELECTION_REGISTRY_ABI, wallet);
}

function getTallyVerifierContract() {
  const env = getEnv();
  if (!env.TALLY_VERIFIER_ADDRESS) {
    throw new Error("Missing TALLY_VERIFIER_ADDRESS in environment");
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AE_PRIVATE_KEY, provider);
  return new ethers.Contract(env.TALLY_VERIFIER_ADDRESS, BU_PVP_1_TALLY_VERIFIER_ABI, wallet);
}

function mapProofStateToResultMode(proofState: string): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "TALLY_VERIFIED_ONCHAIN") return "PENDING_ZK_DECRYPTION";
  if (state === "TRANSCRIPT_COMMITTED") return "PENDING";
  if (state === "NOT_IMPLEMENTED" || state.length === 0) return "PENDING";
  return state;
}

type ZkPublicationGateState = {
  ready: boolean;
  proofState: "VERIFIED" | "TALLY_VERIFIED_ONCHAIN" | "TRANSCRIPT_COMMITTED" | "NOT_IMPLEMENTED";
  tallyProof: {
    jobId: string | null;
    status: string | null;
    verifiedOffchain: boolean;
    verifiedOnchain: boolean;
  };
  decryptionProof: {
    required: boolean;
    jobId: string | null;
    status: string | null;
    verifiedOffchain: boolean;
    verifiedOnchain: boolean;
  };
  blockers: string[];
};

type CandidateCatalogRow = {
  id: string;
  candidateCode: string;
  displayName: string;
  partyName: string;
  status: string;
  ballotOrder: number;
};

type ResultSummaryItem = {
  candidateId: string;
  candidateCode: string;
  displayName: string;
  partyName: string;
  votes: number;
  unresolved: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function coerceVotes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function extractSummaryMap(payloadJson: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!isRecord(payloadJson)) {
    return map;
  }

  const payload = payloadJson;

  if (isRecord(payload.summary)) {
    for (const [key, votesRaw] of Object.entries(payload.summary)) {
      const cleanedKey = String(key ?? "").trim();
      if (!cleanedKey) continue;
      const votes = coerceVotes(votesRaw);
      if (votes < 0) continue;
      map.set(cleanedKey, votes);
    }
    return map;
  }

  if (Array.isArray(payload.summaryItems)) {
    for (const item of payload.summaryItems) {
      if (!isRecord(item)) continue;
      const key = String(item.candidateId ?? item.candidateCode ?? item.displayName ?? "").trim();
      if (!key) continue;
      const votes = coerceVotes(item.votes);
      if (votes < 0) continue;
      map.set(key, votes);
    }
  }

  return map;
}

function buildResultSummaryItems(params: {
  summary: Map<string, number>;
  candidates: CandidateCatalogRow[];
}) {
  const { summary, candidates } = params;
  const byId = new Map(candidates.map((candidate) => [candidate.id.toLowerCase(), candidate]));
  const byCode = new Map(candidates.map((candidate) => [candidate.candidateCode.toLowerCase(), candidate]));

  const unresolvedLabels: string[] = [];
  const items: ResultSummaryItem[] = [];

  for (const [rawKey, votes] of summary.entries()) {
    const key = rawKey.trim();
    if (!key || votes < 0) continue;

    const resolved = byId.get(key.toLowerCase()) ?? byCode.get(key.toLowerCase());
    if (!resolved) {
      unresolvedLabels.push(key);
      items.push({
        candidateId: key,
        candidateCode: key,
        displayName: key,
        partyName: "SIN_CATALOGO",
        votes,
        unresolved: true,
      });
      continue;
    }

    items.push({
      candidateId: resolved.id,
      candidateCode: resolved.candidateCode,
      displayName: resolved.displayName,
      partyName: resolved.partyName,
      votes,
      unresolved: false,
    });
  }

  items.sort((a, b) => b.votes - a.votes || a.displayName.localeCompare(b.displayName));

  return { items, unresolvedLabels };
}

type DecryptionCeremonyState = {
  ceremonyId: string;
  status: string;
  thresholdRequired: number;
  trusteeCount: number;
  shareCount: number;
  trustees: Array<{ trusteeId: string; submittedAt: string }>;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

type ShareSubmissionChannel = "MANUAL" | "API_SIGNED";

function sanitizeTrusteeId(input: string): string {
  const trusteeId = String(input ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,64}$/.test(trusteeId)) {
    throw new Error("trusteeId inválido (usa A-Z, 0-9, _ o -, 3-64 chars)");
  }
  return trusteeId;
}

function sanitizeSubmissionChannel(input: string | undefined): ShareSubmissionChannel {
  const channel = String(input ?? "MANUAL").trim().toUpperCase();
  if (channel !== "MANUAL" && channel !== "API_SIGNED") {
    throw new Error("submissionChannel inválido. Usa MANUAL o API_SIGNED");
  }
  return channel;
}

function sanitizeSignerAddress(input: string): string {
  try {
    return ethers.getAddress(String(input).trim()).toLowerCase();
  } catch {
    throw new Error("signerAddress inválido");
  }
}

function sanitizeSignatureHex(input: string): string {
  const sig = String(input ?? "").trim();
  if (!/^0x[0-9a-fA-F]{128}([0-9a-fA-F]{2})?$/.test(sig)) {
    throw new Error("signature inválida (esperado hex ECDSA 64/65 bytes)");
  }
  return sig;
}

function buildShareSubmissionSigningMessage(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
  ceremonyId: string;
  trusteeId: string;
  normalizedSharePayload: string;
}): string {
  const payload = {
    domain: "BU-PVP-1_DECRYPTION_SHARE_SUBMISSION_V1",
    chainId: String(params.chainId),
    contractAddress: String(params.contractAddress).toLowerCase(),
    electionId: String(params.electionId),
    ceremonyId: String(params.ceremonyId),
    trusteeId: sanitizeTrusteeId(params.trusteeId),
    sharePayload: String(params.normalizedSharePayload),
  };
  return JSON.stringify(payload);
}

function resolveAllowedTrusteeSignerAddress(trusteeId: string): string {
  const env = getEnv();
  const normalizedTrusteeId = sanitizeTrusteeId(trusteeId);
  const allowed = env.REMOTE_TRUSTEE_ALLOWLIST[normalizedTrusteeId];
  if (!allowed) {
    throw new Error(
      `No existe una dirección autorizada para ${normalizedTrusteeId}. Configura REMOTE_TRUSTEE_ALLOWLIST.`,
    );
  }
  return allowed;
}

async function resolveRuntimeContext() {
  const chainId = getEnv().CHAIN_ID;
  const contract = getContract();
  const contractAddress = (await contract.getAddress()).toLowerCase();
  return { chainId, contractAddress, contract };
}

async function loadZkPublicationGateState(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
  tallyJobId?: string | null;
}): Promise<ZkPublicationGateState> {
  const tallyJobClause = params.tallyJobId ? "AND tally_job_id=$4" : "";
  const tallyQueryParams = params.tallyJobId
    ? [params.chainId, params.contractAddress, params.electionId, params.tallyJobId]
    : [params.chainId, params.contractAddress, params.electionId];

  const tallyProofRes = await pool.query<{
    jobId: string;
    status: string;
    verifiedOffchain: boolean | null;
    verifiedOnchain: boolean | null;
    tallyJobId: string | null;
  }>(
    `SELECT
       job_id AS "jobId",
       status,
       verified_offchain AS "verifiedOffchain",
       verified_onchain AS "verifiedOnchain",
       tally_job_id AS "tallyJobId"
     FROM zk_proof_jobs
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3${tallyJobClause} AND circuit_id=$${params.tallyJobId ? 5 : 4}
     ORDER BY created_at DESC
     LIMIT 1`,
    [...tallyQueryParams, ZK_CIRCUIT_ID],
  );

  const tallyProofRow = tallyProofRes.rows[0] ?? null;
  const effectiveTallyJobId = params.tallyJobId ?? tallyProofRow?.tallyJobId ?? null;
  const decryptionQueryParams = effectiveTallyJobId
    ? [params.chainId, params.contractAddress, params.electionId, effectiveTallyJobId, ZK_DECRYPTION_CIRCUIT_ID]
    : [params.chainId, params.contractAddress, params.electionId, ZK_DECRYPTION_CIRCUIT_ID];
  const decryptionWhereClause = effectiveTallyJobId ? "AND tally_job_id=$4 AND circuit_id=$5" : "AND circuit_id=$4";

  const decryptionProofRes = await pool.query<{
    jobId: string;
    status: string;
    verifiedOffchain: boolean | null;
    verifiedOnchain: boolean | null;
  }>(
    `SELECT
       job_id AS "jobId",
       status,
       verified_offchain AS "verifiedOffchain",
       verified_onchain AS "verifiedOnchain"
     FROM zk_proof_jobs
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ${decryptionWhereClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    decryptionQueryParams,
  );

  const decryptionProofRow = decryptionProofRes.rows[0] ?? null;
  const blockers: string[] = [];
  const tallyVerifiedOnchain = Boolean(tallyProofRow?.verifiedOnchain) || tallyProofRow?.status === "VERIFIED_ONCHAIN";
  const decryptionRequired = decryptionProofRow !== null;
  const decryptionVerified =
    !decryptionRequired ||
    Boolean(decryptionProofRow?.verifiedOnchain) ||
    Boolean(decryptionProofRow?.verifiedOffchain) ||
    decryptionProofRow?.status === "VERIFIED_ONCHAIN" ||
    decryptionProofRow?.status === "VERIFIED_OFFCHAIN";

  if (!tallyProofRow) {
    blockers.push("No existe un job de prueba ZK de tally para esta eleccion.");
  } else if (!tallyVerifiedOnchain) {
    blockers.push(
      `La prueba ZK de tally aún no ha sido verificada en cadena (status=${tallyProofRow.status}).`,
    );
  }

  if (decryptionRequired && !decryptionVerified) {
    blockers.push(
      `La prueba ZK de descifrado aún no está verificada fuera de cadena (status=${decryptionProofRow?.status ?? "UNKNOWN"}).`,
    );
  }

  const ready = blockers.length === 0;
  const proofState: ZkPublicationGateState["proofState"] = ready
    ? "VERIFIED"
    : tallyVerifiedOnchain
      ? "TALLY_VERIFIED_ONCHAIN"
      : tallyProofRow
        ? "TRANSCRIPT_COMMITTED"
        : "NOT_IMPLEMENTED";

  return {
    ready,
    proofState,
    tallyProof: {
      jobId: tallyProofRow?.jobId ?? null,
      status: tallyProofRow?.status ?? null,
      verifiedOffchain: Boolean(tallyProofRow?.verifiedOffchain),
      verifiedOnchain: tallyVerifiedOnchain,
    },
    decryptionProof: {
      required: decryptionRequired,
      jobId: decryptionProofRow?.jobId ?? null,
      status: decryptionProofRow?.status ?? null,
      verifiedOffchain: Boolean(decryptionProofRow?.verifiedOffchain),
      verifiedOnchain: Boolean(decryptionProofRow?.verifiedOnchain),
    },
    blockers,
  };
}

export async function getZkPublicationGateAction(
  electionId: string,
  options?: { tallyJobId?: string | null },
) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const gate = await loadZkPublicationGateState({
      chainId,
      contractAddress,
      electionId,
      tallyJobId: options?.tallyJobId ?? null,
    });
    return { ok: true, ...gate };
  } catch (err: unknown) {
    return {
      ok: false,
      error: getErrorMessage(err),
      ready: false,
      proofState: "NOT_IMPLEMENTED" as const,
      tallyProof: { jobId: null, status: null, verifiedOffchain: false, verifiedOnchain: false },
      decryptionProof: { required: false, jobId: null, status: null, verifiedOffchain: false, verifiedOnchain: false },
      blockers: [getErrorMessage(err)],
    };
  }
}

async function loadElectionCandidates(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
}): Promise<CandidateCatalogRow[]> {
  const res = await pool.query<CandidateCatalogRow>(
    `SELECT
      id AS "id",
      candidate_code AS "candidateCode",
      display_name AS "displayName",
      party_name AS "partyName",
      status,
      ballot_order::int AS "ballotOrder"
    FROM candidates
    WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
    ORDER BY ballot_order ASC, created_at ASC`,
    [params.chainId, params.contractAddress, params.electionId],
  );

  return res.rows;
}

async function loadLatestCeremonyState(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
  openOnly?: boolean;
  ceremonyId?: string;
}): Promise<DecryptionCeremonyState | null> {
  const statusClause = params.openOnly ? "AND status IN ('OPEN','READY')" : "";
  const ceremonyClause = params.ceremonyId ? "AND ceremony_id=$4" : "";
  const ceremonyRes = await pool.query<{
    ceremonyId: string;
    status: string;
    thresholdRequired: number;
    trusteeCount: number;
    openedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
  }>(
    `SELECT
      ceremony_id AS "ceremonyId",
      status,
      threshold_required AS "thresholdRequired",
      trustee_count AS "trusteeCount",
      opened_at AS "openedAt",
      closed_at AS "closedAt",
      created_at AS "createdAt"
     FROM decryption_ceremonies
       WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ${statusClause} ${ceremonyClause}
     ORDER BY created_at DESC
     LIMIT 1`,
      params.ceremonyId
        ? [params.chainId, params.contractAddress, params.electionId, params.ceremonyId]
        : [params.chainId, params.contractAddress, params.electionId],
  );

  const ceremony = ceremonyRes.rows[0] ?? null;
  if (!ceremony) return null;

  const sharesRes = await pool.query<{ trusteeId: string; submittedAt: Date }>(
    `SELECT trustee_id AS "trusteeId", submitted_at AS "submittedAt"
     FROM decryption_shares
     WHERE ceremony_id=$1
     ORDER BY submitted_at ASC`,
    [ceremony.ceremonyId],
  );

  return {
    ceremonyId: ceremony.ceremonyId,
    status: ceremony.status,
    thresholdRequired: ceremony.thresholdRequired,
    trusteeCount: ceremony.trusteeCount,
    shareCount: sharesRes.rows.length,
    trustees: sharesRes.rows.map((r) => ({
      trusteeId: r.trusteeId,
      submittedAt: r.submittedAt.toISOString(),
    })),
    openedAt: ceremony.openedAt?.toISOString() ?? null,
    closedAt: ceremony.closedAt?.toISOString() ?? null,
    createdAt: ceremony.createdAt.toISOString(),
  };
}

async function resolveCoordinatorPrivateKeyForTally(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
}): Promise<
  | {
      ok: true;
      keyHex: string;
      keySource: "THRESHOLD_2_OF_3";
      ceremonyId: string | null;
      shareCount: number;
    }
  | { ok: false; error: string }
> {
  const ceremony = await loadLatestCeremonyState({
    chainId: params.chainId,
    contractAddress: params.contractAddress,
    electionId: params.electionId,
    openOnly: false,
  });

  if (ceremony) {
    const sharesRes = await pool.query<{ sharePayload: string }>(
      `SELECT share_payload AS "sharePayload"
       FROM decryption_shares
       WHERE ceremony_id=$1
       ORDER BY trustee_id ASC`,
      [ceremony.ceremonyId],
    );

    const sharePayloads = sharesRes.rows.map((r) => String(r.sharePayload));
    if (sharePayloads.length < ceremony.thresholdRequired) {
      return {
        ok: false,
        error: `Ceremonia ${ceremony.ceremonyId} requiere ${ceremony.thresholdRequired} shares y solo hay ${sharePayloads.length}`,
      };
    }

    try {
      const keyHex = reconstructCoordinatorKeyFromShares(sharePayloads);
      return {
        ok: true,
        keyHex,
        keySource: "THRESHOLD_2_OF_3",
        ceremonyId: ceremony.ceremonyId,
        shareCount: sharePayloads.length,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Shares inválidas en ceremonia ${ceremony.ceremonyId}: ${(err as Error).message}`,
      };
    }
  }

  return {
    ok: false,
    error: "No hay ceremonia 2-de-3 cerrada con suficientes shares válidas para descifrar el escrutinio.",
  };
}

export async function getDecryptionCeremonyStateAction(
  input: string | { electionId: string; ceremonyId?: string },
) {
  try {
    const electionId = typeof input === "string" ? input : input.electionId;
    const ceremonyId = typeof input === "string" ? undefined : input.ceremonyId;
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const ceremony = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId,
      openOnly: false,
      ceremonyId,
    });
    return { ok: true, ceremony };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), ceremony: null };
  }
}

export async function createDecryptionCeremonyAction(electionId: string) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const env = getEnv();
    const allowlistCount = Object.keys(env.REMOTE_TRUSTEE_ALLOWLIST).length;

    // Bug 7.1 fix: Verify the election is in a valid phase for decryption.
    // A ceremony should only be created after voting has closed (phase >= 4).
    const electionPhaseRes = await pool.query<{ phase: number }>(
      `SELECT phase FROM elections
       WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
      [chainId, contractAddress, electionId],
    );
    const electionPhase = electionPhaseRes.rows[0]?.phase;
    if (electionPhase === undefined || electionPhase === null) {
      return { ok: false, error: "Elección no encontrada en la base de datos", ceremony: null };
    }
    if (electionPhase < 4) {
      return {
        ok: false,
        error: `No se puede iniciar una ceremonia de descifrado en fase ${electionPhase}. Se requiere fase >= 4 (VOTING_CLOSED o posterior).`,
        ceremony: null,
      };
    }

    const existing = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId,
      openOnly: true,
    });

    if (existing) {
      return { ok: true, created: false, ceremony: existing };
    }

    const ceremonyId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO decryption_ceremonies(
        ceremony_id, chain_id, contract_address, election_id,
        threshold_required, trustee_count, status, opened_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [ceremonyId, chainId, contractAddress, electionId, 2, allowlistCount > 0 ? allowlistCount : 3, "OPEN"],
    );

    const ceremony = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId,
      openOnly: true,
    });

    return { ok: true, created: true, ceremony };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), ceremony: null };
  }
}

export async function closeDecryptionCeremonyAction(params: {
  electionId: string;
  ceremonyId?: string;
}) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const ceremony = params.ceremonyId
      ? await loadLatestCeremonyState({
          chainId,
          contractAddress,
          electionId: params.electionId,
          openOnly: false,
          ceremonyId: params.ceremonyId,
        })
      : await loadLatestCeremonyState({
          chainId,
          contractAddress,
          electionId: params.electionId,
          openOnly: true,
        });

    if (!ceremony) {
      return { ok: false, error: "No existe una ceremonia para cerrar", ceremony: null };
    }

    if (ceremony.status === "CLOSED") {
      return { ok: true, closed: false, ceremony };
    }

    if (ceremony.shareCount < ceremony.thresholdRequired) {
      return {
        ok: false,
        error: `No se puede cerrar: hay ${ceremony.shareCount}/${ceremony.thresholdRequired} shares`,
        ceremony,
      };
    }

    await pool.query(
      `UPDATE decryption_ceremonies
       SET status='CLOSED', closed_at=COALESCE(closed_at, NOW())
       WHERE ceremony_id=$1`,
      [ceremony.ceremonyId],
    );

    const finalState = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId: params.electionId,
      openOnly: false,
      ceremonyId: ceremony.ceremonyId,
    });

    return { ok: true, closed: true, ceremony: finalState };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), ceremony: null };
  }
}

export async function getDecryptionShareSigningMessageAction(params: {
  electionId: string;
  ceremonyId: string;
  trusteeId: string;
  sharePayload: string;
}) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const trusteeId = sanitizeTrusteeId(params.trusteeId);
    const parsedShare = parseThresholdSharePayload(params.sharePayload);
    const normalizedSharePayload = `${"BU-PVP-1_THRESHOLD_2_OF_3_V1"}:${parsedShare.x}:${parsedShare.yHex}`;

    const ceremony = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId: params.electionId,
      openOnly: false,
      ceremonyId: params.ceremonyId,
    });

    if (!ceremony) {
      return {
        ok: false,
        error: "Ceremonia inexistente para generar mensaje de firma",
        signingMessage: null,
      };
    }

    if (ceremony.status === "CLOSED") {
      return {
        ok: false,
        error: "La ceremonia ya está cerrada; no admite nuevas firmas de share",
        signingMessage: null,
      };
    }

    const signingMessage = buildShareSubmissionSigningMessage({
      chainId,
      contractAddress,
      electionId: params.electionId,
      ceremonyId: ceremony.ceremonyId,
      trusteeId,
      normalizedSharePayload,
    });

    return {
      ok: true,
      signingMessage,
      ceremonyId: ceremony.ceremonyId,
      trusteeId,
      normalizedSharePayload,
      chainId,
      contractAddress,
    };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), signingMessage: null };
  }
}

export async function submitDecryptionShareAction(params: {
  electionId: string;
  trusteeId: string;
  sharePayload: string;
  ceremonyId?: string;
  submissionChannel?: "MANUAL" | "API_SIGNED";
  signerAddress?: string | null;
  signature?: string | null;
}) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const submissionChannel = sanitizeSubmissionChannel(params.submissionChannel);
    const trusteeId = sanitizeTrusteeId(params.trusteeId);
    const parsedShare = parseThresholdSharePayload(params.sharePayload);
    const normalizedSharePayload = `${"BU-PVP-1_THRESHOLD_2_OF_3_V1"}:${parsedShare.x}:${parsedShare.yHex}`;

    if (submissionChannel === "API_SIGNED" && !params.ceremonyId) {
      throw new Error("API_SIGNED requiere ceremonyId explícito");
    }

    let ceremony = params.ceremonyId
      ? await loadLatestCeremonyState({
          chainId,
          contractAddress,
          electionId: params.electionId,
          openOnly: false,
          ceremonyId: params.ceremonyId,
        })
      : await loadLatestCeremonyState({
          chainId,
          contractAddress,
          electionId: params.electionId,
          openOnly: true,
        });

    if (!ceremony) {
      if (submissionChannel === "API_SIGNED") {
        throw new Error("Ceremonia no encontrada para API_SIGNED");
      }
      const created = await createDecryptionCeremonyAction(params.electionId);
      if (!created.ok || !created.ceremony) {
        throw new Error(created.error ?? "No se pudo crear ceremonia");
      }
      ceremony = created.ceremony;
    }

    if (ceremony.status === "CLOSED") {
      throw new Error("La ceremonia está cerrada y no acepta nuevas shares");
    }

    let signerAddress: string | null = null;
    let signature: string | null = null;
    const metadata: Record<string, unknown> = {
      shareX: parsedShare.x,
      submissionChannel,
    };

    if (submissionChannel === "API_SIGNED") {
      if (!params.signerAddress || !params.signature) {
        throw new Error("API_SIGNED requiere signerAddress y signature");
      }

      signerAddress = sanitizeSignerAddress(params.signerAddress);
      signature = sanitizeSignatureHex(params.signature);
      const allowedSignerAddress = resolveAllowedTrusteeSignerAddress(trusteeId);

      const signingMessage = buildShareSubmissionSigningMessage({
        chainId,
        contractAddress,
        electionId: params.electionId,
        ceremonyId: ceremony.ceremonyId,
        trusteeId,
        normalizedSharePayload,
      });

      let recoveredAddress: string;
      try {
        recoveredAddress = ethers.verifyMessage(signingMessage, signature).toLowerCase();
      } catch {
        throw new Error("Signature ECDSA inválida para API_SIGNED");
      }

      if (recoveredAddress !== signerAddress) {
        throw new Error("La firma no corresponde al signerAddress provisto");
      }
      if (recoveredAddress !== allowedSignerAddress) {
        throw new Error(
          `La firma corresponde a ${recoveredAddress}, pero ${trusteeId} está asignado a ${allowedSignerAddress}`,
        );
      }

      metadata.signingMessage = signingMessage;
      metadata.allowedSignerAddress = allowedSignerAddress;
      metadata.recoveredSignerAddress = recoveredAddress;
      metadata.signatureVerifiedAt = new Date().toISOString();
    }

    const upsertRes = await pool.query(
      `WITH open_ceremony AS (
        SELECT ceremony_id
        FROM decryption_ceremonies
        WHERE ceremony_id=$1 AND status <> 'CLOSED'
      )
      INSERT INTO decryption_shares(
        ceremony_id, chain_id, contract_address, election_id, trustee_id,
        share_payload, submission_channel, signer_address, signature, metadata
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      FROM open_ceremony
      ON CONFLICT (ceremony_id, trustee_id) DO UPDATE SET
        share_payload=EXCLUDED.share_payload,
        submission_channel=EXCLUDED.submission_channel,
        signer_address=EXCLUDED.signer_address,
        signature=EXCLUDED.signature,
        metadata=EXCLUDED.metadata,
        submitted_at=NOW()`,
      [
        ceremony.ceremonyId,
        chainId,
        contractAddress,
        params.electionId,
        trusteeId,
        normalizedSharePayload,
        submissionChannel,
        signerAddress,
        signature,
        JSON.stringify(metadata),
      ],
    );

    if (upsertRes.rowCount === 0) {
      throw new Error("La ceremonia está cerrada y no acepta nuevas shares");
    }

    const updated = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId: params.electionId,
      openOnly: false,
      ceremonyId: ceremony.ceremonyId,
    });
    if (!updated) {
      throw new Error("No se pudo recargar estado de ceremonia");
    }

    const nextStatus = updated.shareCount >= updated.thresholdRequired ? "READY" : "OPEN";
    if (updated.status !== nextStatus) {
      await pool.query(
        `UPDATE decryption_ceremonies SET status=$2 WHERE ceremony_id=$1`,
        [updated.ceremonyId, nextStatus],
      );
    }

    const finalState = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId: params.electionId,
      openOnly: false,
      ceremonyId: ceremony.ceremonyId,
    });

    return {
      ok: true,
      ceremony: finalState,
      ready: Boolean(finalState && finalState.shareCount >= finalState.thresholdRequired),
    };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), ceremony: null, ready: false };
  }
}

export async function generateCoordinatorSharesAction() {
  try {
    const env = getEnv();
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.COORDINATOR_PRIVATE_KEY)) {
      return {
        ok: false,
        error: "COORDINATOR_PRIVATE_KEY ausente o inválida para generar shares",
        shares: [] as string[],
      };
    }

    const shares = splitCoordinatorKey2of3(env.COORDINATOR_PRIVATE_KEY);
    return { ok: true, shares };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err), shares: [] as string[] };
  }
}

export async function computeRealTallyAction(electionId: string) {
  try {
    const runtime = await resolveRuntimeContext();
    const candidates = await loadElectionCandidates({
      chainId: runtime.chainId,
      contractAddress: runtime.contractAddress,
      electionId,
    });
    const activeCandidateIds = new Set(
      candidates
        .filter((candidate) => String(candidate.status).toUpperCase() === "ACTIVE")
        .map((candidate) => candidate.id.trim().toLowerCase()),
    );

    if (activeCandidateIds.size === 0) {
      return { ok: false, error: "No active candidates found for this election." };
    }

    // Fetch ciphertexts directly from the canonical ballot_records table on the server side
    // to keep tally execution aligned with ZK proof generation.
    const ballotsRes = await pool.query<{ ciphertext: string }>(
      "SELECT ciphertext FROM ballot_records WHERE chain_id = $1 AND contract_address = $2 AND election_id = $3 ORDER BY ballot_index ASC",
      [runtime.chainId, runtime.contractAddress, BigInt(electionId)],
    );
    const ciphertexts = ballotsRes.rows.map((r) => r.ciphertext);

    if (ciphertexts.length === 0) {
      return { ok: false, error: "No ballots found in database for this election." };
    }
    const keyResolution = await resolveCoordinatorPrivateKeyForTally({
      chainId: runtime.chainId,
      contractAddress: runtime.contractAddress,
      electionId,
    });

    if (!keyResolution.ok) {
      return { ok: false, error: keyResolution.error };
    }

    const summary: Record<string, number> = {};
    const transcriptEntries: Array<{
      ballotIndex: number;
      ballotHash: string;
      selection: string;
      format: "BABYJUB_POSEIDON_V2";
    }> = [];
    const errors: Array<{ ballotIndex: number; error: string }> = [];

    for (let i = 0; i < ciphertexts.length; i += 1) {
      const ciphertext = String(ciphertexts[i]);
      const ballotHash = ethers.keccak256(ciphertext);

      try {
        let decrypted: unknown;
        const format: "BABYJUB_POSEIDON_V2" = "BABYJUB_POSEIDON_V2";
        try {
          decrypted = await decryptBallotPayload(ciphertext, keyResolution.keyHex);
        } catch {
          throw new Error("decryption_failed");
        }

        const selectionRaw =
          typeof decrypted === "object" && decrypted !== null && "selection" in decrypted
            ? (decrypted as { selection?: unknown }).selection
            : null;

        if (typeof selectionRaw !== "string" || selectionRaw.trim().length === 0) {
          throw new Error("selection_missing_or_invalid");
        }

        const selection = selectionRaw.trim();
        if (!activeCandidateIds.has(selection.toLowerCase())) {
          throw new Error("selection_outside_active_catalog");
        }
        // Bug 1.3 fix: Normalize selection to lowercase to match how buildResultSummaryItems
        // resolves candidates (byId.get(key.toLowerCase())). Without this, mixed-case selections
        // would create orphan keys in the summary that don't associate with any catalog candidate.
        const normalizedSelection = selection.toLowerCase();
        summary[normalizedSelection] = (summary[normalizedSelection] ?? 0) + 1;
        transcriptEntries.push({
          ballotIndex: i,
          ballotHash,
          // Bug R2-5: Use the normalized (lowercase) selection so it matches
          // the candidateOrder keys used by the ZK witness builder.
          selection: normalizedSelection,
          format,
        });
      } catch (err: unknown) {
        errors.push({ ballotIndex: i, error: getErrorMessage(err) });
      }
    }

    const allBallotHashes = ciphertexts.map((ciphertext) => ethers.keccak256(String(ciphertext)));
    const merkleRoot = deriveBallotMerkleRoot(ciphertexts);
    const poseidonMerkle = await buildPoseidonMerkleBundleFromBallotHashes(allBallotHashes);

    const transcript = {
      protocolVersion: "BU-PVP-1",
      transcriptVersion: "TALLY_TRANSCRIPT_V1",
      electionId: String(electionId),
      computedAt: new Date().toISOString(),
      ballotsCount: ciphertexts.length,
      decryptedValidCount: transcriptEntries.length,
      invalidCount: errors.length,
      merkleRoot,
      merkleRootPoseidon: poseidonMerkle.merkleRoot,
      allBallotHashes,
      summary,
      ballots: transcriptEntries,
      errors,
      keySource: keyResolution.keySource,
      ceremonyId: keyResolution.ceremonyId,
      shareCount: keyResolution.shareCount,
    };

    const transcriptHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(transcript)));

    return {
      ok: true,
      summary,
      validCount: transcriptEntries.length,
      invalidCount: errors.length,
      ballotsCount: ciphertexts.length,
      merkleRoot,
      merkleRootPoseidon: poseidonMerkle.merkleRoot,
      transcript,
      transcriptHash,
      keySource: keyResolution.keySource,
      ceremonyId: keyResolution.ceremonyId,
      shareCount: keyResolution.shareCount,
    };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function publishTranscriptCommitmentAction(electionId: string, commitmentPayload: string) {
  try {
    const contract = getContract();
    const tx = await contract.publishTallyTranscriptCommitment(BigInt(electionId), commitmentPayload);
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt.hash };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

/**
 * Publishes an acta on-chain AND persists its full content in acta_contents.
 * @param kind - Solidity enum ActaKind: 0=APERTURA, 1=CIERRE, 2=ESCRUTINIO, 3=RESULTADOS
 */
export async function publishActaWithContentAction(
  electionId: string,
  actaJson: Record<string, unknown>,
  kind: number,
) {
  try {
    const env = getEnv();

    const actType = kind === 2 ? "ACTA_ESCRUTINIO" : kind === 3 ? "ACTA_RESULTADOS" : `KIND_${kind}`;
    const signingKey = actType === "ACTA_ESCRUTINIO" ? env.JED_PRIVATE_KEY : env.AE_PRIVATE_KEY;

    if (!signingKey) {
      await logIncidentAction(
        electionId,
        "MISSING_ACTA_SIGNER_KEY",
        "MISSING_ACTA_SIGNER_KEY",
        `Falta la private key para firmar el acta ${actType}`,
        "CRITICAL",
      );
      throw new Error(`Missing PRIVATE_KEY to sign ${actType}`);
    }

    const signedActa = await signActaECDSA(actaJson, signingKey);
    const finalSnapshotHash = String(signedActa.signingPayloadJson.contentHash).toLowerCase();
    const actId = finalSnapshotHash;

    const contract = getContract();
    const tx = await contract.publishActa(BigInt(electionId), kind, finalSnapshotHash);
    const receipt = await tx.wait();

    // Persist full content to acta_contents so evidence-api can serve it
    const chainId = getEnv().CHAIN_ID;
    const contractAddress = (await contract.getAddress()).toLowerCase();

    const expectedSignerAddress = new ethers.Wallet(signingKey).address.toLowerCase();

    await pool.query(
      `INSERT INTO acta_contents (
        chain_id, contract_address, election_id, act_id, act_type,
        canonical_json, signed_json, signature, content_hash, verification_status,
        signature_scheme, signer_address, signing_digest, signer_role, expected_signer_address, signing_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (chain_id, contract_address, election_id, act_id) DO UPDATE SET
        canonical_json = EXCLUDED.canonical_json,
        signed_json = EXCLUDED.signed_json,
        signature = EXCLUDED.signature,
        verification_status = EXCLUDED.verification_status,
        signature_scheme = EXCLUDED.signature_scheme,
        signer_address = EXCLUDED.signer_address,
        signing_digest = EXCLUDED.signing_digest,
        signer_role = EXCLUDED.signer_role,
        expected_signer_address = EXCLUDED.expected_signer_address,
        signing_payload = EXCLUDED.signing_payload`,
      [
        chainId, contractAddress, electionId, actId, actType,
        JSON.stringify(signedActa.canonicalJson), // canonical_json
        JSON.stringify(signedActa),               // signed_json
        signedActa.signature.signatureHex,        // signature
        finalSnapshotHash,                        // content_hash
        "VALID",                                  // verification_status
        signedActa.signature.signatureScheme,
        signedActa.signature.signerAddress,
        signedActa.signature.signingDigest,
        signedActa.signature.signerRole,
        expectedSignerAddress,
        JSON.stringify(signedActa.signingPayloadJson)
      ]
    );

    return { ok: true, txHash: receipt.hash, snapshotHash: finalSnapshotHash, actId };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function advanceToResultsPublishedAction(electionId: string) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const gate = await loadZkPublicationGateState({
      chainId,
      contractAddress,
      electionId,
    });
    if (!gate.ready) {
      return {
        ok: false,
        error: `No se puede publicar la fase final de resultados: ${gate.blockers.join(" ")}`,
      };
    }

    const contract = getContract();
    const tx = await contract.publishResults(BigInt(electionId));
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt.hash };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function createProcessingBatchAction(electionId: string, inputCount: number, relatedRoot: string) {
  try {
    const batchId = crypto.randomUUID();
    // Default to a 31337 chain ID and localhost contract for now, or match indexer logically
    // To match indexer, we need the contract address and chain ID
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    // get max batch index
    const res = await pool.query(
      `SELECT COALESCE(MAX(batch_index), -1) AS max_idx FROM processing_batches WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
      [chainId, contractAddress, electionId]
    );
    const nextIdx = Number(res.rows[0].max_idx) + 1;

    await pool.query(
      `INSERT INTO processing_batches (
        batch_id, chain_id, contract_address, election_id, batch_index, input_count, status, related_root
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [batchId, chainId, contractAddress, electionId, nextIdx, inputCount, "PENDING", relatedRoot]
    );
    return { ok: true, batchId };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function updateProcessingBatchStatusAction(batchId: string, status: string) {
  try {
    let query = `UPDATE processing_batches SET status=$1`;
    if (status === "RUNNING") query += `, started_at=NOW()`;
    if (status === "COMPLETED" || status === "FAILED") query += `, completed_at=NOW()`;
    query += ` WHERE batch_id=$2`;

    await pool.query(query, [status, batchId]);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function createTallyJobAction(electionId: string, basedOnBatchSet: string) {
  try {
    const jobId = crypto.randomUUID();
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    await pool.query(
      `INSERT INTO tally_jobs (
        tally_job_id, chain_id, contract_address, election_id, based_on_batch_set, status, proof_state
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, chainId, contractAddress, electionId, basedOnBatchSet, "RUNNING", "NOT_IMPLEMENTED"]
    );
    return { ok: true, jobId };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function updateTallyJobStatusAction(
  jobId: string,
  status: string,
  proofState: string,
  commitment: string,
  resultSummary?: unknown,
) {
  try {
    if (resultSummary !== undefined) {
      await pool.query(
        `UPDATE tally_jobs
         SET status=$1, proof_state=$2, tally_commitment=$3, result_summary=$5, completed_at=NOW()
         WHERE tally_job_id=$4`,
        [status, proofState, commitment, jobId, JSON.stringify(resultSummary)],
      );
    } else {
      await pool.query(
        `UPDATE tally_jobs SET status=$1, proof_state=$2, tally_commitment=$3, completed_at=NOW() WHERE tally_job_id=$4`,
        [status, proofState, commitment, jobId],
      );
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}
export async function logIncidentAction(
  electionId: string,
  fingerprint: string,
  code: string,
  message: string,
  severity: string = "CRITICAL",
  evidencePointers: unknown[] = [],
) {
  try {
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    await pool.query(
      `INSERT INTO incident_logs (
        chain_id, contract_address, election_id, fingerprint, code, severity, message, details, evidence_pointers
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE 
      SET occurrences = incident_logs.occurrences + 1, last_seen_at = NOW()`,
      [chainId, contractAddress, electionId, fingerprint, code, severity, message, JSON.stringify({}), JSON.stringify(evidencePointers)]
    );
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function createResultPayloadAction(
  electionId: string,
  tallyJobId: string,
  payloadJson: unknown,
  options?: { proofState?: string; resultKind?: string; publicationStatus?: string },
) {
  try {
    const payloadId = crypto.randomUUID();
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();
    const proofState = options?.proofState ?? "TRANSCRIPT_COMMITTED";
    const normalizedProofState = String(proofState).toUpperCase();
    if (!["VERIFIED", "TALLY_VERIFIED_ONCHAIN", "TRANSCRIPT_COMMITTED", "NOT_IMPLEMENTED"].includes(normalizedProofState)) {
      return { ok: false, error: `Unsupported proofState for result payloads: ${proofState}` };
    }
    if (normalizedProofState === "VERIFIED") {
      const gate = await loadZkPublicationGateState({
        chainId,
        contractAddress,
        electionId,
        tallyJobId,
      });
      if (!gate.ready) {
        return {
          ok: false,
          error: `No se puede publicar payload VERIFIED sin gate ZK completo: ${gate.blockers.join(" ")}`,
        };
      }
    }
    const resultKind = options?.resultKind ?? "LOCAL_REPRODUCIBLE";
    const publicationStatus = options?.publicationStatus ?? "PUBLISHED";

    const candidates = await loadElectionCandidates({
      chainId,
      contractAddress,
      electionId,
    });

    const summaryMap = extractSummaryMap(payloadJson);
    const { items: summaryItems, unresolvedLabels } = buildResultSummaryItems({
      summary: summaryMap,
      candidates,
    });

    if (unresolvedLabels.length > 0) {
      return {
        ok: false,
        error: `Result summary contains labels outside the election catalog: ${unresolvedLabels.join(", ")}`,
      };
    }

    const finalPayloadJson = {
      ...(isRecord(payloadJson) ? payloadJson : {}),
      summaryItems: summaryItems.map((item) => ({
        candidateId: item.candidateId,
        candidateCode: item.candidateCode,
        displayName: item.displayName,
        partyName: item.partyName,
        votes: item.votes,
      })),
      summaryCatalog: {
        source: "DB_PROJECTED",
        totalCandidates: candidates.length,
        unresolvedLabels,
      },
    };

    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(finalPayloadJson)));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO result_payloads (
          id, chain_id, contract_address, election_id, tally_job_id, result_kind, payload_json, payload_hash, publication_status, proof_state, published_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          payloadId,
          chainId,
          contractAddress,
          electionId,
          tallyJobId,
          resultKind,
          JSON.stringify(finalPayloadJson),
          payloadHash,
          publicationStatus,
          proofState,
        ],
      );

      for (const item of summaryItems) {
        await client.query(
          `INSERT INTO result_summary_items (
            id, chain_id, contract_address, election_id, result_payload_id,
            candidate_id, candidate_code, display_name, party_name, votes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (chain_id, contract_address, election_id, result_payload_id, candidate_id)
          DO UPDATE SET
            candidate_code=EXCLUDED.candidate_code,
            display_name=EXCLUDED.display_name,
            party_name=EXCLUDED.party_name,
            votes=EXCLUDED.votes`,
          [
            crypto.randomUUID(),
            chainId,
            contractAddress,
            electionId,
            payloadId,
            item.candidateId,
            item.candidateCode,
            item.displayName,
            item.partyName || "SIN_PARTIDO",
            item.votes,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return {
      ok: true,
      payloadId,
      payloadHash,
      proofState,
      resultMode: mapProofStateToResultMode(proofState),
      summaryItemsCount: summaryItems.length,
      unresolvedLabels,
    };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function openAuditWindowAction(electionId: string) {
  try {
    const auditId = crypto.randomUUID();
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    // Smart contract call
    const tx = await contract.openAuditWindow(BigInt(electionId));
    await tx.wait();

    await pool.query(
      `INSERT INTO audit_windows (
        id, chain_id, contract_address, election_id, status, opened_at, opened_by
      ) VALUES ($1,$2,$3,$4,$5,NOW(),$6)
      ON CONFLICT (chain_id, contract_address, election_id) DO UPDATE SET status=$5, opened_at=NOW()`,
      [auditId, chainId, contractAddress, electionId, "OPEN", "SYSTEM"]
    );

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

/**
 * Materializes the audit bundle by collecting all evidence artifacts
 * and persisting a manifest + hash in audit_bundle_exports.
 */
export async function persistAuditBundleAction(electionId: string) {
  try {
    const bundleId = crypto.randomUUID();
    const chainId = getEnv().CHAIN_ID;
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    // Collect counts for manifest
    const [ballotsR, batchesR, jobsR, resultsR, actsR, anchorsR, incidentsR, latestResultR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM processing_batches WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM tally_jobs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM result_payloads WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM acta_contents WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM incident_logs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT proof_state AS "proofState" FROM result_payloads WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC LIMIT 1`, [chainId, contractAddress, electionId]),
    ]);

    const latestProofState = String(latestResultR.rows[0]?.proofState ?? "NOT_IMPLEMENTED");
    const derivedResultMode = mapProofStateToResultMode(latestProofState);

    const manifest = {
      electionId,
      chainId,
      contractAddress,
      generatedAt: new Date().toISOString(),
      contents: {
        ballots: ballotsR.rows[0]?.c ?? 0,
        processingBatches: batchesR.rows[0]?.c ?? 0,
        tallyJobs: jobsR.rows[0]?.c ?? 0,
        resultPayloads: resultsR.rows[0]?.c ?? 0,
        actas: actsR.rows[0]?.c ?? 0,
        anchors: anchorsR.rows[0]?.c ?? 0,
        incidents: incidentsR.rows[0]?.c ?? 0,
      },
      honesty: {
        resultMode: derivedResultMode,
        proofState: latestProofState,
        note:
          latestProofState === "VERIFIED"
            ? "Resultado y prueba verificados."
            : latestProofState === "TALLY_VERIFIED_ONCHAIN"
              ? "La prueba de tally ya fue verificada en cadena, pero falta cerrar la verificación ZK complementaria requerida para publicar resultados finales."
              : latestProofState === "TRANSCRIPT_COMMITTED"
                ? "Existe compromiso de transcript en cadena, pero la publicación final está bloqueada hasta completar la verificación ZK."
                : "Resultado aún no verificado.",
      },
    };

    const bundleHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(manifest)));

    await pool.query(
      `INSERT INTO audit_bundle_exports (
        id, chain_id, contract_address, election_id, bundle_hash, bundle_manifest_json, export_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING`,
      [bundleId, chainId, contractAddress, electionId, bundleHash, JSON.stringify(manifest), "MATERIALIZED"]
    );

    return { ok: true, bundleId, bundleHash };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

/**
 * Phase 9B — Generate and verify a Groth16 ZK proof for a tally transcript.
 *
 * PROVES:
 *   - The published vote counts are the correct aggregation of ballot selections.
 *   - Every processed ballot hash is included in the Poseidon Merkle root.
 *
 * DOES NOT PROVE (yet):
 *   - Correct decryption (requires decryption circuit)
 *   - On-chain verification (Phase 9C)
 */
export async function generateZkProofAction(
  electionId: string,
  transcript: {
    summary: Record<string, number>;
    ballots: Array<{ selection: string }>;
    ballotsCount: number;
    decryptedValidCount: number;
    invalidCount: number;
    merkleRoot?: string;
    merkleRootPoseidon?: string;
    allBallotHashes?: string[];
  },
  tallyJobId: string,
) {
  const jobId = crypto.randomUUID();
  const decryptionJobId = crypto.randomUUID();

  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();

    // Check ZK artifacts exist
    const artifactCheck = checkZkArtifacts();
    if (!artifactCheck.ok) {
      return {
        ok: false,
        error: `ZK artifacts missing: ${artifactCheck.missing.join(", ")}. Run setup.sh in packages/zk-tally.`,
      };
    }

    // Determine candidate ordering (must be deterministic and match what the observer sees)
    const candidateKeys = Object.keys(transcript.summary).sort();
    if (candidateKeys.length > ZK_NUM_CANDIDATES) {
      return {
        ok: false,
        error: `Circuit supports max ${ZK_NUM_CANDIDATES} candidates, election has ${candidateKeys.length}`,
      };
    }

    // Pad candidate keys to NUM_CANDIDATES with placeholders
    while (candidateKeys.length < ZK_NUM_CANDIDATES) {
      candidateKeys.push(`__UNUSED_${candidateKeys.length}`);
    }

    const allBallotHashes = Array.isArray(transcript.allBallotHashes)
      ? transcript.allBallotHashes.map((hashHex) => String(hashHex))
      : [];

    if (allBallotHashes.length !== transcript.ballotsCount) {
      return {
        ok: false,
        error:
          "Transcript missing allBallotHashes for witness generation or length mismatch with ballotsCount.",
      };
    }

    const merkleBundle = await buildPoseidonMerkleBundleFromBallotHashes(allBallotHashes);

    if (
      typeof transcript.merkleRootPoseidon === "string" &&
      transcript.merkleRootPoseidon.length > 0 &&
      transcript.merkleRootPoseidon !== merkleBundle.merkleRoot
    ) {
      return {
        ok: false,
        error: "Transcript merkleRootPoseidon mismatch. Refuse to generate proof with inconsistent Merkle data.",
      };
    }

    // Create job record
    await pool.query(
      `INSERT INTO zk_proof_jobs (
        job_id, chain_id, contract_address, election_id, tally_job_id,
        proof_system, circuit_id, status,
        merkle_root_keccak, merkle_root_poseidon,
        proving_started_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'BUILDING',$8,$9,NOW())`,
      [
        jobId,
        chainId,
        contractAddress,
        electionId,
        tallyJobId,
        ZK_PROOF_SYSTEM,
        ZK_CIRCUIT_ID,
        transcript.merkleRoot ?? null,
        merkleBundle.merkleRoot,
      ],
    );

    // Build witness from transcript
    const witness = buildWitnessFromTranscript(transcript, candidateKeys, merkleBundle);

    // Generate proof
    const proofResult = await proveTally(witness);

    // Update with proof data
    await pool.query(
      `UPDATE zk_proof_jobs SET
        status='PROVED',
        public_inputs=$2,
        proof_json=$3,
        verification_key_hash=$4,
        proving_completed_at=NOW()
      WHERE job_id=$1`,
      [
        jobId,
        JSON.stringify({
          signals: proofResult.publicSignals,
          candidateOrder: candidateKeys,
          merkleRootPoseidon: merkleBundle.merkleRoot,
        }),
        JSON.stringify(proofResult.proof),
        proofResult.verificationKeyHash,
      ],
    );

    // Verify off-chain
    const verifyResult = await verifyTallyProof(proofResult.proof, proofResult.publicSignals);

    if (!verifyResult.valid) {
      await pool.query(
        `UPDATE zk_proof_jobs SET status='FAILED', error_message='Off-chain verification failed' WHERE job_id=$1`,
        [jobId],
      );
      return { ok: false, error: "ZK proof generated but off-chain verification FAILED", jobId };
    }

    // Update to VERIFIED_OFFCHAIN
    await pool.query(
      `UPDATE zk_proof_jobs SET
        status='VERIFIED_OFFCHAIN',
        verified_offchain=true,
        merkle_inclusion_verified=true
      WHERE job_id=$1`,
      [jobId],
    );

    // Best-effort Phase 9D: generate decryption proof on top of V2 ciphertext witness lane.
    let decryptionProofJob: {
      jobId: string;
      status: string;
      circuitId: string;
      verificationKeyHash: string | null;
      error: string | null;
    } | null = null;

    try {
      const decryptionArtifacts = checkArtifactsForCircuit("DECRYPTION");
      if (decryptionArtifacts.ok) {
        const ballotsRes = await pool.query<{
          ballotIndex: number;
          ciphertext: string;
        }>(
          `SELECT ballot_index::int AS "ballotIndex", ciphertext
           FROM ballot_records
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
           ORDER BY ballot_index ASC, block_number ASC, log_index ASC`,
          [chainId, contractAddress, electionId],
        );

        const keyResolution = await resolveCoordinatorPrivateKeyForTally({
          chainId,
          contractAddress,
          electionId,
        });

        if (keyResolution.ok) {
          const v2Ballots = ballotsRes.rows.filter((row) => {
            try {
              return decodeBallotCiphertextEnvelope(String(row.ciphertext)).version === "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2";
            } catch {
              return false;
            }
          });

          if (v2Ballots.length > 0) {
            await pool.query(
              `INSERT INTO zk_proof_jobs (
                 job_id, chain_id, contract_address, election_id, tally_job_id,
                 proof_system, circuit_id, status,
                 proving_started_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,'BUILDING',NOW())`,
              [
                decryptionJobId,
                chainId,
                contractAddress,
                electionId,
                tallyJobId,
                ZK_PROOF_SYSTEM,
                ZK_DECRYPTION_CIRCUIT_ID,
              ],
            );

            const decryptionEntries = [] as Array<{
              selectionCiphertext: string;
              selectionNonce: string;
              selectionSharedKey: string;
              decryptedSelection: string;
            }>;

            for (const ballot of v2Ballots) {
              const entry = await deriveZkFriendlySelectionWitnessData(
                String(ballot.ciphertext),
                keyResolution.keyHex,
              );
              decryptionEntries.push(entry);
            }

            const decryptionWitness = buildDecryptionWitness({
              summary: transcript.summary,
              candidateOrder: candidateKeys,
              entries: decryptionEntries,
            });

            const decryptionProof = await proveDecryption(decryptionWitness);
            const decryptionVerify = await verifyDecryptionProof(
              decryptionProof.proof,
              decryptionProof.publicSignals,
            );

            if (!decryptionVerify.valid) {
              throw new Error("Off-chain verification failed for decryption proof");
            }

            await pool.query(
              `UPDATE zk_proof_jobs SET
                 status='VERIFIED_OFFCHAIN',
                 verified_offchain=true,
                 public_inputs=$2,
                 proof_json=$3,
                 verification_key_hash=$4,
                 proving_completed_at=NOW(),
                 error_message=NULL
               WHERE job_id=$1`,
              [
                decryptionJobId,
                JSON.stringify({
                  signals: decryptionProof.publicSignals,
                  candidateOrder: candidateKeys,
                  witnessBallotsCount: decryptionEntries.length,
                }),
                JSON.stringify(decryptionProof.proof),
                decryptionProof.verificationKeyHash,
              ],
            );

            decryptionProofJob = {
              jobId: decryptionJobId,
              status: "VERIFIED_OFFCHAIN",
              circuitId: ZK_DECRYPTION_CIRCUIT_ID,
              verificationKeyHash: decryptionProof.verificationKeyHash,
              error: null,
            };
          }
        }
      }
    } catch (decryptionErr: unknown) {
      const decryptionErrorMessage = getErrorMessage(decryptionErr);
      await pool.query(
        `INSERT INTO zk_proof_jobs (
           job_id, chain_id, contract_address, election_id, tally_job_id,
           proof_system, circuit_id, status,
           error_message, proving_started_at, proving_completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'FAILED',$8,NOW(),NOW())
         ON CONFLICT (job_id) DO UPDATE SET
           status='FAILED',
           error_message=EXCLUDED.error_message,
           proving_completed_at=NOW()`,
        [
          decryptionJobId,
          chainId,
          contractAddress,
          electionId,
          tallyJobId,
          ZK_PROOF_SYSTEM,
          ZK_DECRYPTION_CIRCUIT_ID,
          decryptionErrorMessage.slice(0, 1000),
        ],
      );

      decryptionProofJob = {
        jobId: decryptionJobId,
        status: "FAILED",
        circuitId: ZK_DECRYPTION_CIRCUIT_ID,
        verificationKeyHash: null,
        error: decryptionErrorMessage,
      };
    }

    const decryptionVerified =
      decryptionProofJob?.status === "VERIFIED_OFFCHAIN" ||
      decryptionProofJob?.status === "VERIFIED_ONCHAIN";

    return {
      ok: true,
      jobId,
      proofSystem: ZK_PROOF_SYSTEM,
      circuitId: ZK_CIRCUIT_ID,
      verificationKeyHash: proofResult.verificationKeyHash,
      publicSignals: proofResult.publicSignals,
      candidateOrder: candidateKeys,
      verifiedOffchain: true,
      verifiedOnchain: false,
      status: "VERIFIED_OFFCHAIN",
      decryptionProofJob,
      honesty: {
        whatIsProved:
          "Los conteos publicados son la suma correcta de selecciones individuales y los hashes procesados están incluidos en la raíz Merkle Poseidon",
        whatIsNotProved: [
          ...(decryptionVerified
            ? []
            : ["Descifrado correcto de ciphertexts (requiere circuito de descifrado)"]),
          "Verificación en cadena",
        ],
        auditabilityNote: "El transcript completo permanece disponible para auditoría independiente fuera de cadena",
      },
    };
  } catch (err: unknown) {
    // Update job status to FAILED
    try {
      await pool.query(
        `UPDATE zk_proof_jobs SET status='FAILED', error_message=$2 WHERE job_id=$1`,
        [jobId, getErrorMessage(err).slice(0, 1000)],
      );
    } catch {
      // ignore secondary failure
    }
    return { ok: false, error: getErrorMessage(err), jobId };
  }
}

function toBigIntValue(value: unknown, label: string): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`Invalid bigint value in ${label}`);
  }
}

type Groth16ProofData = {
  a: [unknown, unknown];
  b: [[unknown, unknown], [unknown, unknown]];
  c: [unknown, unknown];
};

function parseGroth16ProofData(value: unknown): Groth16ProofData | null {
  if (!isRecord(value)) return null;

  const aValue = value.a;
  const bValue = value.b;
  const cValue = value.c;

  if (!Array.isArray(aValue) || !Array.isArray(bValue) || !Array.isArray(cValue)) {
    return null;
  }

  if (aValue.length < 2 || bValue.length < 2 || cValue.length < 2) {
    return null;
  }

  const b0 = bValue[0];
  const b1 = bValue[1];
  if (!Array.isArray(b0) || !Array.isArray(b1) || b0.length < 2 || b1.length < 2) {
    return null;
  }

  return {
    a: [aValue[0], aValue[1]],
    b: [
      [b0[0], b0[1]],
      [b1[0], b1[1]],
    ],
    c: [cValue[0], cValue[1]],
  };
}

function parseSignalsFromPublicInputs(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.signals)) {
    return [];
  }

  return value.signals.map((signal) => String(signal));
}

export async function submitOnchainZkProofAction(
  electionId: string,
  options?: { jobId?: string },
) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
    const verifierContract = getTallyVerifierContract();

    const whereByJob = options?.jobId ? " AND job_id=$4" : "";
    const circuitIdParam = options?.jobId ? 5 : 4;
    const queryParams = options?.jobId
      ? [chainId, contractAddress, electionId, options.jobId, ZK_CIRCUIT_ID]
      : [chainId, contractAddress, electionId, ZK_CIRCUIT_ID];

    const jobRes = await pool.query<{
      jobId: string;
      tallyJobId: string | null;
      status: string;
      circuitId: string;
      proofJson: unknown;
      publicInputs: unknown;
      onchainVerificationTx: string | null;
    }>(
      `SELECT
         job_id AS "jobId",
         tally_job_id AS "tallyJobId",
         status,
         circuit_id AS "circuitId",
         proof_json AS "proofJson",
         public_inputs AS "publicInputs",
         onchain_verification_tx AS "onchainVerificationTx"
       FROM zk_proof_jobs
       WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3${whereByJob} AND circuit_id=$${circuitIdParam}
       ORDER BY created_at DESC
       LIMIT 1`,
      queryParams,
    );

    const job = jobRes.rows[0] ?? null;
    if (!job) {
      return {
        ok: false,
        error: "No hay ZK proof job de tally verificado para esta eleccion",
      };
    }

    if (job.circuitId !== ZK_CIRCUIT_ID) {
      return {
        ok: false,
        error: `El job ${job.jobId} no corresponde al circuito on-chain de tally (${job.circuitId})`,
      };
    }

    if (job.status === "VERIFIED_ONCHAIN" && job.onchainVerificationTx) {
      return {
        ok: true,
        jobId: job.jobId,
        status: "VERIFIED_ONCHAIN",
        txHash: job.onchainVerificationTx,
        alreadyVerified: true,
      };
    }

    if (job.status !== "VERIFIED_OFFCHAIN" && job.status !== "PROVED") {
      return {
        ok: false,
        error: `El job ${job.jobId} no esta listo para verificacion on-chain (status=${job.status})`,
      };
    }

    const proof = parseGroth16ProofData(job.proofJson);
    const signals = parseSignalsFromPublicInputs(job.publicInputs);

    if (!proof) {
      return { ok: false, error: `El job ${job.jobId} no contiene proof_json valido` };
    }

    if (signals.length === 0) {
      return { ok: false, error: `El job ${job.jobId} no contiene public inputs` };
    }

    const a = [
      toBigIntValue(proof.a[0], "proof.a[0]"),
      toBigIntValue(proof.a[1], "proof.a[1]"),
    ] as [bigint, bigint];

    // Rust backend serializes Fq2 coordinates as [c0, c1], while the Solidity verifier expects [c1, c0].
    const b = [
      [
        toBigIntValue(proof.b[0][1], "proof.b[0][1]"),
        toBigIntValue(proof.b[0][0], "proof.b[0][0]"),
      ],
      [
        toBigIntValue(proof.b[1][1], "proof.b[1][1]"),
        toBigIntValue(proof.b[1][0], "proof.b[1][0]"),
      ],
    ] as [[bigint, bigint], [bigint, bigint]];

    const c = [
      toBigIntValue(proof.c[0], "proof.c[0]"),
      toBigIntValue(proof.c[1], "proof.c[1]"),
    ] as [bigint, bigint];

    const input = signals.map((value: string, index: number) =>
      toBigIntValue(value, `publicSignals[${index}]`),
    );

    const tx = await verifierContract.verifyTallyProof(BigInt(electionId), job.jobId, a, b, c, input);
    const receipt = await tx.wait();
    const txHash = receipt?.hash ?? tx.hash;
    const verifierAddress = (await verifierContract.getAddress()).toLowerCase();

    await pool.query(
      `UPDATE zk_proof_jobs
       SET status='VERIFIED_ONCHAIN',
           verified_onchain=true,
           onchain_verifier_address=$2,
           onchain_verification_tx=$3,
           error_message=NULL
       WHERE job_id=$1`,
      [job.jobId, verifierAddress, txHash],
    );

    const gate = await loadZkPublicationGateState({
      chainId,
      contractAddress,
      electionId,
      tallyJobId: job.tallyJobId,
    });

    if (job.tallyJobId) {
      await pool.query(
        `UPDATE tally_jobs SET proof_state=$2 WHERE tally_job_id=$1`,
        [job.tallyJobId, gate.proofState],
      );

      await pool.query(
         `UPDATE result_payloads
         SET proof_state=$5
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND tally_job_id=$4`,
        [chainId, contractAddress, electionId, job.tallyJobId, gate.proofState],
      );
    } else {
      await pool.query(
         `UPDATE result_payloads
         SET proof_state=$4
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
        [chainId, contractAddress, electionId, gate.proofState],
      );
    }

    return {
      ok: true,
      jobId: job.jobId,
      status: gate.proofState,
      txHash,
      verifierAddress,
      publicationReady: gate.ready,
      blockers: gate.blockers,
      alreadyVerified: false,
    };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err) };
  }
}
