"use server";

import { ethers } from "ethers";
import { getEnv } from "@/lib/env";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";

function getContract() {
  const env = getEnv();
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AE_PRIVATE_KEY, provider);
  return new ethers.Contract(env.ELECTION_REGISTRY_ADDRESS, BU_PVP_1_ELECTION_REGISTRY_ABI, wallet);
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
    const snapshotHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalData));
    const contentHash = snapshotHash; // SHA3-256 of canonical JSON
    const actId = snapshotHash.toLowerCase();

    const contract = getContract();
    const tx = await contract.publishActa(BigInt(electionId), kind, snapshotHash);
    const receipt = await tx.wait();

    // Persist full content to acta_contents so evidence-api can serve it
    const chainId = "31337";
    const contractAddress = (await contract.getAddress()).toLowerCase();
    const actType = kind === 2 ? "ACTA_ESCRUTINIO" : kind === 3 ? "ACTA_RESULTADOS" : `KIND_${kind}`;

    await pool.query(
      `INSERT INTO acta_contents (
        chain_id, contract_address, election_id, act_id, act_type,
        canonical_json, signed_json, signature, content_hash, verification_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (chain_id, contract_address, election_id, act_id) DO UPDATE SET
        canonical_json = EXCLUDED.canonical_json,
        signed_json = EXCLUDED.signed_json,
        verification_status = EXCLUDED.verification_status`,
      [
        chainId, contractAddress, electionId, actId, actType,
        JSON.stringify(actaJson),   // canonical_json
        JSON.stringify({ snapshot: actaJson, signature: "stub-jed-signature" }), // signed_json
        "stub-jed-signature",       // signature
        contentHash,                // content_hash
        "EXPERIMENTAL",             // verification_status
      ]
    );

    return { ok: true, txHash: receipt.hash, snapshotHash, actId };
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

export async function updateTallyJobStatusAction(jobId: string, status: string, proofState: string, commitment: string) {
  try {
    await pool.query(
      `UPDATE tally_jobs SET status=$1, proof_state=$2, tally_commitment=$3, completed_at=NOW() WHERE tally_job_id=$4`,
      [status, proofState, commitment, jobId]
    );
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

export async function createResultPayloadAction(electionId: string, tallyJobId: string, payloadJson: any) {
  try {
    const payloadId = crypto.randomUUID();
    const chainId = "31337";
    const contract = getContract();
    const contractAddress = (await contract.getAddress()).toLowerCase();

    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payloadJson)));

    await pool.query(
      `INSERT INTO result_payloads (
        id, chain_id, contract_address, election_id, tally_job_id, result_kind, payload_json, payload_hash, publication_status, proof_state, published_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [payloadId, chainId, contractAddress, electionId, tallyJobId, "EXPERIMENTAL", JSON.stringify(payloadJson), payloadHash, "PUBLISHED", "SIMULATED"]
    );
    return { ok: true, payloadId, payloadHash };
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
    const [ballotsR, batchesR, jobsR, resultsR, actsR, anchorsR, incidentsR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM processing_batches WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM tally_jobs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM result_payloads WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM acta_contents WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM incident_logs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`, [chainId, contractAddress, electionId]),
    ]);

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
        resultMode: "SIMULATED",
        proofState: "SIMULATED",
        note: "El resultSummary es estático y no proviene de descifrado real. Los anchorajes on-chain son reales.",
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
