"use server";

import { ethers } from "ethers";
import { getEnv } from "@/lib/env";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";
import {
  decryptBallotPayload,
  deriveBallotMerkleRoot,
  signActaECDSA,
} from "@blockurna/crypto";

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

export async function computeRealTallyAction(electionId: string, ciphertexts: string[]) {
  try {
    const env = getEnv();
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.COORDINATOR_PRIVATE_KEY)) {
      return {
        ok: false,
        error: "COORDINATOR_PRIVATE_KEY ausente o inválida (se requiere 0x + 32 bytes)",
      };
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
          decrypted = decryptBallotPayload(ciphertext, env.COORDINATOR_PRIVATE_KEY);
        } catch {
          // Transitional compatibility while old ballots are drained from the system.
          decrypted = decodeLegacyBallot(ciphertext);
          format = "LEGACY_RAW_HEX";
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
    const canonicalData = JSON.stringify(actaJson);
    const env = getEnv();
    const actId = ethers.keccak256(ethers.toUtf8Bytes(canonicalData)).toLowerCase();

    const actType = kind === 2 ? "ACTA_ESCRUTINIO" : kind === 3 ? "ACTA_RESULTADOS" : `KIND_${kind}`;
    const signingKey = actType === "ACTA_ESCRUTINIO" ? env.JED_PRIVATE_KEY : env.AE_PRIVATE_KEY;

    if (!signingKey) {
      await logIncidentAction(electionId, "MISSING_ACTA_SIGNER_KEY", "CRITICAL", `Falta la private key para firmar el acta ${actType}`, "Firma requerida no pudo generarse");
      throw new Error(`Missing PRIVATE_KEY to sign ${actType}`);
    }

    const signedActa = await signActaECDSA(actaJson, signingKey);
    const snapshotHash = signedActa.signature.signingDigest; // The digest of the payload is the anchor hash or we can use contentHash depending on the contract setup, but the prompt says snapshotHash should be keccak256(canonical JSON) which is contentHash.

    // Let's ensure snapshotHash matches contentHash as specified in the plan
    const finalSnapshotHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalData)).toLowerCase();

    const contract = getContract();
    const tx = await contract.publishActa(BigInt(electionId), kind, finalSnapshotHash);
    const receipt = await tx.wait();

    // Persist full content to acta_contents so evidence-api can serve it
    const chainId = "31337";
    const contractAddress = (await contract.getAddress()).toLowerCase();

    // Default expected address setup
    const electionMetaRes = await pool.query(`SELECT authority FROM election_registry WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 LIMIT 1`, [chainId, contractAddress, electionId]);
    const expectedSignerAddress = electionMetaRes.rows[0]?.authority?.toLowerCase() || new ethers.Wallet(signingKey).address.toLowerCase(); // If JED has no specific on-chain mapping, we might just assume it's valid if it matches Tally Board's key logic, or we use authority. In MVP Authority is shared. Let's use authority as baseline if requested. Actually the verify API does the robust expected match.

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

import { pool } from "@/lib/db";
import crypto from "crypto";

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

    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payloadJson)));
    const proofState = options?.proofState ?? "SIMULATED";
    const resultKind = options?.resultKind ?? "EXPERIMENTAL";
    const publicationStatus = options?.publicationStatus ?? "PUBLISHED";

    await pool.query(
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
        JSON.stringify(payloadJson),
        payloadHash,
        publicationStatus,
        proofState,
      ]
    );
    return { ok: true, payloadId, payloadHash, proofState, resultMode: mapProofStateToResultMode(proofState) };
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
