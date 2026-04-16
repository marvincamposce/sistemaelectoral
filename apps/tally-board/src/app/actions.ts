"use server";

import { ethers } from "ethers";
import { getEnv } from "@/lib/env";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";
import {
  decryptBallotPayload,
  deriveBallotMerkleRoot,
  parseThresholdSharePayload,
  reconstructCoordinatorKeyFromShares,
  signActaECDSA,
  splitCoordinatorKey2of3,
} from "@blockurna/crypto";

import { pool } from "@/lib/db";
import crypto from "crypto";

function getContract() {
  const env = getEnv();
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AE_PRIVATE_KEY, provider);
  return new ethers.Contract(env.ELECTION_REGISTRY_ADDRESS, BU_PVP_1_ELECTION_REGISTRY_ABI, wallet);
}

function mapProofStateToResultMode(proofState: string): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "TRANSCRIPT_VERIFIED") return "TRANSCRIPT_VERIFIED";
  if (state === "SIMULATED") return "SIMULATED";
  if (state === "NOT_IMPLEMENTED" || state.length === 0) return "PENDING";
  return state;
}

function decodeLegacyBallot(ciphertext: string): unknown {
  const text = ethers.toUtf8String(ciphertext);
  return JSON.parse(text) as unknown;
}

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

function coerceVotes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function extractSummaryMap(payloadJson: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const payload = payloadJson as any;

  if (payload && typeof payload.summary === "object" && payload.summary !== null) {
    for (const [key, votesRaw] of Object.entries(payload.summary as Record<string, unknown>)) {
      const cleanedKey = String(key ?? "").trim();
      if (!cleanedKey) continue;
      const votes = coerceVotes(votesRaw);
      if (votes <= 0) continue;
      map.set(cleanedKey, votes);
    }
    return map;
  }

  if (Array.isArray(payload?.summaryItems)) {
    for (const item of payload.summaryItems) {
      const key = String(item?.candidateId ?? item?.candidateCode ?? item?.displayName ?? "").trim();
      if (!key) continue;
      const votes = coerceVotes(item?.votes);
      if (votes <= 0) continue;
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
    if (!key || votes <= 0) continue;

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

async function resolveRuntimeContext() {
  const chainId = "31337";
  const contract = getContract();
  const contractAddress = (await contract.getAddress()).toLowerCase();
  return { chainId, contractAddress, contract };
}

async function loadElectionCandidates(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
}): Promise<CandidateCatalogRow[]> {
  const res = await pool.query<CandidateCatalogRow>(
    `SELECT
      candidate_id AS "id",
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
      keySource: "THRESHOLD_2_OF_3" | "LEGACY_ENV";
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

  const env = getEnv();
  if (env.ALLOW_LEGACY_COORDINATOR_KEY && /^0x[0-9a-fA-F]{64}$/.test(env.COORDINATOR_PRIVATE_KEY)) {
    return {
      ok: true,
      keyHex: env.COORDINATOR_PRIVATE_KEY,
      keySource: "LEGACY_ENV",
      ceremonyId: null,
      shareCount: 0,
    };
  }

  return {
    ok: false,
    error:
      "No hay ceremonia 2-de-3 activa con suficientes shares. Carga al menos 2 shares o habilita ALLOW_LEGACY_COORDINATOR_KEY para modo transicional.",
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), ceremony: null };
  }
}

export async function createDecryptionCeremonyAction(electionId: string) {
  try {
    const { chainId, contractAddress } = await resolveRuntimeContext();
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
      [ceremonyId, chainId, contractAddress, electionId, 2, 3, "OPEN"],
    );

    const ceremony = await loadLatestCeremonyState({
      chainId,
      contractAddress,
      electionId,
      openOnly: true,
    });

    return { ok: true, created: true, ceremony };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), ceremony: null };
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), ceremony: null };
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), signingMessage: null };
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

      metadata.signingMessage = signingMessage;
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), ceremony: null, ready: false };
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), shares: [] as string[] };
  }
}

export async function computeRealTallyAction(electionId: string, ciphertexts: string[]) {
  try {
    const runtime = await resolveRuntimeContext();
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
      format: "X25519_XCHACHA20" | "LEGACY_RAW_HEX";
    }> = [];
    const errors: Array<{ ballotIndex: number; error: string }> = [];

    for (let i = 0; i < ciphertexts.length; i += 1) {
      const ciphertext = String(ciphertexts[i]);
      const ballotHash = ethers.keccak256(ciphertext);

      try {
        let decrypted: unknown;
        let format: "X25519_XCHACHA20" | "LEGACY_RAW_HEX" = "X25519_XCHACHA20";
        try {
          decrypted = decryptBallotPayload(ciphertext, keyResolution.keyHex);
        } catch {
          if (keyResolution.keySource === "LEGACY_ENV") {
            // Transitional compatibility while old ballots are drained from the system.
            decrypted = decodeLegacyBallot(ciphertext);
            format = "LEGACY_RAW_HEX";
          } else {
            throw new Error("decryption_failed");
          }
        }

        const selectionRaw =
          typeof decrypted === "object" && decrypted !== null && "selection" in decrypted
            ? (decrypted as any).selection
            : null;

        if (typeof selectionRaw !== "string" || selectionRaw.trim().length === 0) {
          throw new Error("selection_missing_or_invalid");
        }

        const selection = selectionRaw.trim();
        summary[selection] = (summary[selection] ?? 0) + 1;
        transcriptEntries.push({
          ballotIndex: i,
          ballotHash,
          selection,
          format,
        });
      } catch (err: unknown) {
        errors.push({ ballotIndex: i, error: (err as Error).message });
      }
    }

    const merkleRoot = deriveBallotMerkleRoot(ciphertexts);
    const transcript = {
      protocolVersion: "BU-PVP-1",
      transcriptVersion: "TALLY_TRANSCRIPT_V1",
      electionId: String(electionId),
      computedAt: new Date().toISOString(),
      ballotsCount: ciphertexts.length,
      decryptedValidCount: transcriptEntries.length,
      invalidCount: errors.length,
      merkleRoot,
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
      transcript,
      transcriptHash,
      keySource: keyResolution.keySource,
      ceremonyId: keyResolution.ceremonyId,
      shareCount: keyResolution.shareCount,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function publishProofAction(electionId: string, proofPayload: string) {
  try {
    const contract = getContract();
    const tx = await contract.publishTallyProof(BigInt(electionId), proofPayload);
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt.hash };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
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
    const chainId = "31337";
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function advanceToResultsPublishedAction(electionId: string) {
  try {
    const contract = getContract();
    const tx = await contract.publishResults(BigInt(electionId));
    const receipt = await tx.wait();
    return { ok: true, txHash: receipt.hash };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function createProcessingBatchAction(electionId: string, inputCount: number, relatedRoot: string) {
  try {
    const batchId = crypto.randomUUID();
    // Default to a 31337 chain ID and localhost contract for now, or match indexer logically
    // To match indexer, we need the contract address and chain ID
    const chainId = "31337";
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function createTallyJobAction(electionId: string, basedOnBatchSet: string) {
  try {
    const jobId = crypto.randomUUID();
    const chainId = "31337";
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    await pool.query(
      `INSERT INTO tally_jobs (
        tally_job_id, chain_id, contract_address, election_id, based_on_batch_set, status, proof_state
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, chainId, contractAddress, electionId, basedOnBatchSet, "RUNNING", "NOT_IMPLEMENTED"]
    );
    return { ok: true, jobId };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}
export async function logIncidentAction(electionId: string, fingerprint: string, code: string, message: string, severity: string = "CRITICAL", evidencePointers: any = []) {
  try {
    const chainId = "31337";
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function createResultPayloadAction(
  electionId: string,
  tallyJobId: string,
  payloadJson: any,
  options?: { proofState?: string; resultKind?: string; publicationStatus?: string },
) {
  try {
    const payloadId = crypto.randomUUID();
    const chainId = "31337";
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();
    const proofState = options?.proofState ?? "SIMULATED";
    const resultKind = options?.resultKind ?? "EXPERIMENTAL";
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

    const finalPayloadJson = {
      ...payloadJson,
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

      if (unresolvedLabels.length > 0) {
        const fingerprint = `RESULT_SUMMARY_CATALOG_MISMATCH:${payloadId}`;
        await client.query(
          `INSERT INTO incident_logs (
            chain_id, contract_address, election_id, fingerprint,
            code, severity, message, details,
            related_entity_type, related_entity_id, evidence_pointers, active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET
            last_seen_at=NOW(),
            occurrences=incident_logs.occurrences + 1,
            details=EXCLUDED.details,
            evidence_pointers=EXCLUDED.evidence_pointers,
            active=true,
            resolved_at=NULL`,
          [
            chainId,
            contractAddress,
            electionId,
            fingerprint,
            "RESULT_SUMMARY_CATALOG_MISMATCH",
            "WARNING",
            "El resumen de resultados contiene etiquetas no resueltas contra el catálogo de candidaturas.",
            JSON.stringify({
              payloadId,
              unresolvedLabels,
            }),
            "RESULT_PAYLOAD",
            payloadId,
            JSON.stringify([
              { type: "result_payload", resultPayloadId: payloadId },
              { type: "summary_unresolved_labels", values: unresolvedLabels },
            ]),
            true,
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function openAuditWindowAction(electionId: string) {
  try {
    const auditId = crypto.randomUUID();
    const chainId = "31337";
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Materializes the audit bundle by collecting all evidence artifacts
 * and persisting a manifest + hash in audit_bundle_exports.
 */
export async function persistAuditBundleAction(electionId: string) {
  try {
    const bundleId = crypto.randomUUID();
    const chainId = "31337";
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
            : latestProofState === "TRANSCRIPT_VERIFIED"
              ? "Descifrado y conteo reales con transcript verificable; ZK completa pendiente."
              : latestProofState === "SIMULATED"
                ? "Resultado marcado como simulado."
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
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}
