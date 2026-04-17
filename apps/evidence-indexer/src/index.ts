import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";
import {
  canonicalizeJson,
  sha256Hex,
  verifyActaECDSASignature,
  verifySignedSnapshot,
} from "@blockurna/crypto";
import { SignedSnapshotSchema } from "@blockurna/shared";

import { getEnv } from "./env.js";
import {
  createPool,
  ensureSchema,
  getOrInitNextBlock,
  resetEvidenceForContract,
  setNextBlock,
  withTransaction,
} from "./db.js";

const REPO_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(address: string): string {
  return ethers.getAddress(address).toLowerCase();
}

async function pickCanaryTx(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
}): Promise<{ txHash: string; blockNumber: number } | null> {
  const { pool, chainId, contractAddress } = params;
  const res = await pool.query<{ tx_hash: string; block_number: string }>(
    `SELECT tx_hash, block_number::text AS block_number
     FROM (
       SELECT tx_hash, block_number, log_index FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2
       UNION ALL
       SELECT tx_hash, block_number, log_index FROM phase_changes WHERE chain_id=$1 AND contract_address=$2
       UNION ALL
       SELECT tx_hash, block_number, log_index FROM signup_records WHERE chain_id=$1 AND contract_address=$2
       UNION ALL
       SELECT tx_hash, block_number, log_index FROM ballot_records WHERE chain_id=$1 AND contract_address=$2
     ) t
     ORDER BY block_number DESC, log_index DESC
     LIMIT 1`,
    [chainId, contractAddress],
  );

  const row = res.rows[0];
  if (!row) return null;
  return { txHash: row.tx_hash, blockNumber: Number(row.block_number) };
}

async function ensureEvidenceNotStale(params: {
  pool: ReturnType<typeof createPool>;
  provider: ethers.Provider;
  chainId: string;
  contractAddress: string;
  startBlock: number;
  genesisBlockHash: string | null;
}): Promise<number> {
  const { pool, provider, chainId, contractAddress, startBlock, genesisBlockHash } = params;

  const stateRes = await pool.query<{
    next_block: string;
    last_indexed_block: string | null;
    last_indexed_block_hash: string | null;
  }>(
    `SELECT
      next_block::text AS next_block,
      last_indexed_block::text AS last_indexed_block,
      last_indexed_block_hash
    FROM indexer_state
    WHERE chain_id=$1 AND contract_address=$2`,
    [chainId, contractAddress],
  );

  const state = stateRes.rows[0];
  if (!state) return startBlock;

  const head = await provider.getBlockNumber();
  const nextBlock = Number(state.next_block);

  const reset = async (reason: string): Promise<number> => {
    console.warn(
      `[evidence-indexer] resetting stale evidence for ${contractAddress} (chainId=${chainId}): ${reason}`,
    );
    await resetEvidenceForContract({ pool, chainId, contractAddress });
    await pool.query(
      "UPDATE indexer_state SET next_block=$3, genesis_block_hash=$4, last_indexed_block=NULL, last_indexed_block_hash=NULL, last_reset_at=NOW(), last_reset_reason=$5, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
      [chainId, contractAddress, startBlock, genesisBlockHash, reason],
    );
    return startBlock;
  };

  if (nextBlock > head + 1 && nextBlock > startBlock) {
    return await reset(`stored next_block=${nextBlock} ahead of head=${head}`);
  }

  const storedLastBlock = state.last_indexed_block ? Number(state.last_indexed_block) : null;
  const storedLastHash = state.last_indexed_block_hash
    ? state.last_indexed_block_hash.toLowerCase()
    : null;

  if (storedLastBlock != null && storedLastHash) {
    if (storedLastBlock > head) {
      return await reset(`stored last_indexed_block=${storedLastBlock} ahead of head=${head}`);
    }

    const block = await provider.getBlock(storedLastBlock);
    const chainHash = block?.hash ? block.hash.toLowerCase() : null;
    if (!chainHash) {
      return await reset(`missing chain block hash at ${storedLastBlock}`);
    }
    if (chainHash !== storedLastHash) {
      return await reset(
        `block hash mismatch at ${storedLastBlock} (db=${storedLastHash} chain=${chainHash})`,
      );
    }
  } else if (nextBlock > startBlock) {
    const canary = await pickCanaryTx({ pool, chainId, contractAddress });
    if (canary) {
      const receipt = await provider.getTransactionReceipt(canary.txHash);
      if (!receipt) {
        return await reset(`canary tx receipt missing: ${canary.txHash}`);
      }
      if (receipt.blockNumber !== canary.blockNumber) {
        return await reset(
          `canary tx block mismatch (db=${canary.blockNumber} chain=${receipt.blockNumber}) for ${canary.txHash}`,
        );
      }

      const to = receipt.to ? normalizeAddress(receipt.to) : null;
      if (!to || to !== contractAddress) {
        return await reset(
          `canary tx 'to' mismatch (db=${contractAddress} chain=${to ?? "null"}) for ${canary.txHash}`,
        );
      }
    }
  }

  if ((storedLastBlock == null || !storedLastHash) && nextBlock > startBlock) {
    const candidate = nextBlock - 1;
    if (candidate >= startBlock && candidate <= head) {
      const block = await provider.getBlock(candidate);
      const chainHash = block?.hash ? block.hash.toLowerCase() : null;
      if (chainHash) {
        await pool.query(
          "UPDATE indexer_state SET last_indexed_block=$3, last_indexed_block_hash=$4, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
          [chainId, contractAddress, candidate, chainHash],
        );
      }
    }
  }

  return nextBlock;
}

const PHASE_LABELS = [
  "SETUP",
  "REGISTRY_OPEN",
  "REGISTRY_CLOSED",
  "VOTING_OPEN",
  "VOTING_CLOSED",
  "PROCESSING",
  "TALLYING",
  "RESULTS_PUBLISHED",
  "AUDIT_WINDOW",
  "ARCHIVED",
] as const;

const CONSISTENCY_RULESET_VERSION = "2";

const ACTA_KIND_LABELS = [
  "ACTA_APERTURA",
  "ACTA_CIERRE",
  "ACTA_ESCRUTINIO",
  "ACTA_RESULTADOS",
] as const;

function actTypeFromKind(kind: number): string {
  return ACTA_KIND_LABELS[kind] ?? String(kind);
}

type Severity = "INFO" | "WARNING" | "CRITICAL";

type LoadedActaFromDisk = {
  filePath: string;
  signedJson: unknown;
  electionId: string;
  actType: string;
  actId: string;
  signature: string;
  signerPublicKey: string | null;
  signerKeyId: string | null;
  canonicalJson: unknown;
  contentHash: string;
};

async function loadActasFromSourceDir(sourceDir: string): Promise<LoadedActaFromDisk[]> {
  const candidates = path.isAbsolute(sourceDir)
    ? [sourceDir]
    : [sourceDir, path.resolve(REPO_ROOT_DIR, sourceDir)];

  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
        .map((e) => path.join(dir, e.name));

      const loaded: LoadedActaFromDisk[] = [];
      for (const filePath of files) {
        try {
          const raw = await fs.readFile(filePath, "utf8");
          const signedJson = JSON.parse(raw) as unknown;

          const parsed = SignedSnapshotSchema.safeParse(signedJson);

          const snapshot: any = parsed.success ? parsed.data.snapshot : (signedJson as any)?.snapshot;
          const signatureObj: any = parsed.success ? parsed.data.signature : (signedJson as any)?.signature;
          if (!snapshot || typeof snapshot !== "object") continue;
          if (!signatureObj || typeof signatureObj !== "object") continue;

          const actIdRaw = signatureObj.snapshotHashHex;
          const signatureHex = signatureObj.signatureHex;
          if (typeof actIdRaw !== "string" || typeof signatureHex !== "string") continue;

          const electionIdRaw = snapshot.electionId;
          const kindRaw = snapshot.kind;
          if (electionIdRaw === undefined || electionIdRaw === null) continue;
          if (kindRaw === undefined || kindRaw === null) continue;

          const actId = actIdRaw.toLowerCase();
          const electionId = String(electionIdRaw);
          const actType = String(kindRaw);
          const signature = signatureHex;
          const signerPublicKey = typeof signatureObj.publicKeyHex === "string" ? signatureObj.publicKeyHex : null;
          const signerKeyId = null;

          const canonicalJson = snapshot;
          const contentHash = sha256Hex(canonicalizeJson(canonicalJson)).toLowerCase();

          loaded.push({
            filePath,
            signedJson,
            electionId,
            actType,
            actId,
            signature,
            signerPublicKey,
            signerKeyId,
            canonicalJson,
            contentHash,
          });
        } catch {
          // Ignore unreadable/invalid JSON files in the source dir.
          continue;
        }
      }

      return loaded;
    } catch (err: unknown) {
      // Missing directory is expected in some deployments.
      if ((err as any)?.code === "ENOENT") continue;
      throw err;
    }
  }

  return [];
}

async function upsertActaContent(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  acta: LoadedActaFromDisk;
}): Promise<void> {
  const { pool, chainId, contractAddress, acta } = params;
  await pool.query(
    `INSERT INTO acta_contents(
      chain_id, contract_address, election_id, act_id,
      act_type, canonical_json, signed_json,
      signature, signer_key_id, signer_public_key,
      content_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (chain_id, contract_address, election_id, act_id) DO UPDATE SET
      act_type=EXCLUDED.act_type,
      canonical_json=EXCLUDED.canonical_json,
      signed_json=EXCLUDED.signed_json,
      signature=EXCLUDED.signature,
      signer_key_id=COALESCE(EXCLUDED.signer_key_id, acta_contents.signer_key_id),
      signer_public_key=COALESCE(EXCLUDED.signer_public_key, acta_contents.signer_public_key),
      content_hash=EXCLUDED.content_hash,
      -- Bug 8.3 fix: Preserve optional metadata fields that tally-board may have already written.
      -- The indexer loads from disk and does not populate these, so COALESCE keeps existing values.
      verification_status=COALESCE(acta_contents.verification_status, EXCLUDED.verification_status),
      signature_scheme=COALESCE(acta_contents.signature_scheme, EXCLUDED.signature_scheme),
      signer_address=COALESCE(acta_contents.signer_address, EXCLUDED.signer_address),
      signing_digest=COALESCE(acta_contents.signing_digest, EXCLUDED.signing_digest),
      signer_role=COALESCE(acta_contents.signer_role, EXCLUDED.signer_role),
      expected_signer_address=COALESCE(acta_contents.expected_signer_address, EXCLUDED.expected_signer_address),
      signing_payload=COALESCE(acta_contents.signing_payload, EXCLUDED.signing_payload)`,
    [
      chainId,
      contractAddress,
      acta.electionId,
      acta.actId,
      acta.actType,
      acta.canonicalJson,
      acta.signedJson,
      acta.signature,
      acta.signerKeyId,
      acta.signerPublicKey,
      acta.contentHash,
    ],
  );
}

async function refreshActaContentsFromDisk(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  sourceDir: string;
}): Promise<{ electionIdsTouched: string[] }> {
  const { pool, chainId, contractAddress, sourceDir } = params;
  const actas = await loadActasFromSourceDir(sourceDir);

  const electionIds = new Set<string>();
  for (const acta of actas) {
    await upsertActaContent({ pool, chainId, contractAddress, acta });
    electionIds.add(acta.electionId);
  }

  return { electionIdsTouched: Array.from(electionIds.values()).sort((a, b) => Number(a) - Number(b)) };
}

async function refreshActaCustodyIncidents(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  sourceDir: string;
  electionIdsHint?: string[];
}): Promise<void> {
  const { pool, chainId, contractAddress, sourceDir, electionIdsHint } = params;

  const electionFilter = Array.isArray(electionIdsHint) && electionIdsHint.length > 0;

  const custodyCodes = [
    "ACTA_CONTENT_MISSING",
    "ACTA_ANCHOR_MISSING",
    "ACTA_SIGNATURE_INVALID",
    "ACTA_HASH_MISMATCH",
  ];

  await pool.query(
    electionFilter
      ? `UPDATE incident_logs
         SET active=false, resolved_at=NOW()
         WHERE chain_id=$1 AND contract_address=$2
           AND election_id = ANY($3::bigint[])
           AND code = ANY($4::text[])
           AND active=true`
      : `UPDATE incident_logs
         SET active=false, resolved_at=NOW()
         WHERE chain_id=$1 AND contract_address=$2
           AND code = ANY($3::text[])
           AND active=true`,
    electionFilter
      ? [chainId, contractAddress, electionIdsHint, custodyCodes]
      : [chainId, contractAddress, custodyCodes],
  );

  const activeAnchorsRes = await pool.query<{
    election_id: string;
    kind: number;
    act_id: string;
    tx_hash: string;
    block_number: string;
    block_timestamp: Date | null;
  }>(
    electionFilter
      ? `SELECT DISTINCT ON (election_id, kind)
          election_id::text AS election_id,
          kind::int AS kind,
          snapshot_hash AS act_id,
          tx_hash,
          block_number::text AS block_number,
          block_timestamp
        FROM acta_anchors
        WHERE chain_id=$1 AND contract_address=$2 AND election_id = ANY($3::bigint[])
        ORDER BY election_id, kind, block_number DESC, log_index DESC`
      : `SELECT DISTINCT ON (election_id, kind)
          election_id::text AS election_id,
          kind::int AS kind,
          snapshot_hash AS act_id,
          tx_hash,
          block_number::text AS block_number,
          block_timestamp
        FROM acta_anchors
        WHERE chain_id=$1 AND contract_address=$2
        ORDER BY election_id, kind, block_number DESC, log_index DESC`,
    electionFilter ? [chainId, contractAddress, electionIdsHint] : [chainId, contractAddress],
  );

  const contentKeysRes = await pool.query<{ election_id: string; act_id: string }>(
    electionFilter
      ? `SELECT election_id::text AS election_id, act_id
         FROM acta_contents
         WHERE chain_id=$1 AND contract_address=$2 AND election_id = ANY($3::bigint[])`
      : `SELECT election_id::text AS election_id, act_id
         FROM acta_contents
         WHERE chain_id=$1 AND contract_address=$2`,
    electionFilter ? [chainId, contractAddress, electionIdsHint] : [chainId, contractAddress],
  );

  const contentKeySet = new Set(contentKeysRes.rows.map((r) => `${r.election_id}:${r.act_id.toLowerCase()}`));
  const activeAnchorKeySet = new Set(activeAnchorsRes.rows.map((r) => `${r.election_id}:${r.act_id.toLowerCase()}`));

  for (const a of activeAnchorsRes.rows) {
    const key = `${a.election_id}:${a.act_id.toLowerCase()}`;
    if (!contentKeySet.has(key)) {
      const actId = a.act_id.toLowerCase();
      await upsertIncident({
        pool,
        chainId,
        contractAddress,
        electionId: a.election_id,
        incident: {
          fingerprint: `ACTA_CONTENT_MISSING:${actId}`,
          code: "ACTA_CONTENT_MISSING",
          severity: "CRITICAL",
          message: "Anchored acta is missing full signed content (acta_contents)",
          details: {
            actId,
            actType: actTypeFromKind(a.kind),
            sourceDir,
          },
          relatedEntityType: "ACTA",
          relatedEntityId: actId,
          evidencePointers: [
            { type: "acta", actId, electionId: a.election_id },
            {
              type: "anchor",
              kind: a.kind,
              txHash: a.tx_hash,
              blockNumber: Number(a.block_number),
              blockTimestamp: a.block_timestamp?.toISOString() ?? null,
            },
          ],
          relatedTxHash: a.tx_hash,
          relatedBlockNumber: Number(a.block_number),
          relatedBlockTimestamp: a.block_timestamp,
        },
      });
    }
  }

  const contentRowsRes = await pool.query<{
    electionId: string;
    actId: string;
    actType: string;
    canonicalJson: unknown;
    signedJson: unknown;
    contentHash: string;
    signatureScheme: string | null;
    expectedSignerAddress: string | null;
  }>(
    electionFilter
      ? `SELECT
          election_id::text AS "electionId",
          act_id AS "actId",
          act_type AS "actType",
          canonical_json AS "canonicalJson",
          signed_json AS "signedJson",
          content_hash AS "contentHash",
          signature_scheme AS "signatureScheme",
          expected_signer_address AS "expectedSignerAddress"
        FROM acta_contents
        WHERE chain_id=$1 AND contract_address=$2 AND election_id = ANY($3::bigint[])
        ORDER BY election_id ASC, created_at DESC`
      : `SELECT
          election_id::text AS "electionId",
          act_id AS "actId",
          act_type AS "actType",
          canonical_json AS "canonicalJson",
          signed_json AS "signedJson",
          content_hash AS "contentHash",
          signature_scheme AS "signatureScheme",
          expected_signer_address AS "expectedSignerAddress"
        FROM acta_contents
        WHERE chain_id=$1 AND contract_address=$2
        ORDER BY election_id ASC, created_at DESC`,
    electionFilter ? [chainId, contractAddress, electionIdsHint] : [chainId, contractAddress],
  );

  for (const row of contentRowsRes.rows) {
    const actId = row.actId.toLowerCase();
    const key = `${row.electionId}:${actId}`;

    // Evaluate only the currently authoritative anchors (latest per kind).
    if (!activeAnchorKeySet.has(key)) {
      continue;
    }

    const signedJson = row.signedJson as any;
    const signatureObj =
      signedJson && typeof signedJson === "object" && typeof signedJson.signature === "object"
        ? signedJson.signature
        : null;

    const resolvedSignatureScheme =
      (typeof row.signatureScheme === "string" && row.signatureScheme.trim().length > 0
        ? row.signatureScheme
        : typeof signatureObj?.signatureScheme === "string"
          ? signatureObj.signatureScheme
          : typeof signatureObj?.algorithm === "string"
            ? signatureObj.algorithm
            : "") ?? "";

    let signatureOk = false;
    let computedHash = "";
    let verifyError: string | null = null;
    let verifyErrorCode: string | null = null;

    if (resolvedSignatureScheme === "ECDSA_SECP256K1_ETH_V1" && signatureObj) {
      const expectedSignerAddress =
        typeof row.expectedSignerAddress === "string" && row.expectedSignerAddress.length > 0
          ? row.expectedSignerAddress
          : typeof signatureObj.signerAddress === "string"
            ? signatureObj.signerAddress
            : "";

      if (expectedSignerAddress.length === 0) {
        verifyError = "Missing expected signer address for ECDSA acta verification";
        verifyErrorCode = "MISSING_EXPECTED_SIGNER";
        computedHash = sha256Hex(canonicalizeJson(row.canonicalJson)).toLowerCase();
      } else {
        const verification = verifyActaECDSASignature(
          row.canonicalJson as Record<string, unknown>,
          signatureObj,
          expectedSignerAddress,
        );
        signatureOk = verification.ok;
        computedHash = String(verification.contentHash ?? "").toLowerCase();
        if (!verification.ok) {
          verifyError = verification.error ?? "verification_failed";
          verifyErrorCode = verification.errorCode ?? "ECDSA_VERIFY_FAILED";
        }
      }
    } else {
      const verified = await verifySignedSnapshot(row.signedJson);
      signatureOk = verified.ok;
      computedHash = verified.ok
        ? String(verified.snapshotHashHex ?? "").toLowerCase()
        : sha256Hex(canonicalizeJson(row.canonicalJson)).toLowerCase();
      if (!verified.ok) {
        verifyError = verified.error ?? "verification_failed";
        verifyErrorCode = "LEGACY_VERIFY_FAILED";
      }
    }

    if (!signatureOk) {
      await upsertIncident({
        pool,
        chainId,
        contractAddress,
        electionId: row.electionId,
        incident: {
          fingerprint: `ACTA_SIGNATURE_INVALID:${actId}`,
          code: "ACTA_SIGNATURE_INVALID",
          severity: "CRITICAL",
          message: "Signed acta failed local verification",
          details: {
            actId,
            actType: row.actType,
            signatureScheme: resolvedSignatureScheme || null,
            errorCode: verifyErrorCode,
            error: verifyError,
          },
          relatedEntityType: "ACTA",
          relatedEntityId: actId,
          evidencePointers: [{ type: "acta", actId, electionId: row.electionId }],
        },
      });
    }

    if (computedHash !== actId) {
      await upsertIncident({
        pool,
        chainId,
        contractAddress,
        electionId: row.electionId,
        incident: {
          fingerprint: `ACTA_HASH_MISMATCH:${actId}`,
          code: "ACTA_HASH_MISMATCH",
          severity: "CRITICAL",
          message: "Acta content hash does not match actId (anchor snapshot hash)",
          details: {
            actId,
            actType: row.actType,
            signatureScheme: resolvedSignatureScheme || null,
            computedContentHash: computedHash,
            storedContentHash: String(row.contentHash ?? ""),
          },
          relatedEntityType: "ACTA",
          relatedEntityId: actId,
          evidencePointers: [{ type: "acta", actId, electionId: row.electionId }],
        },
      });
    }

    const verificationStatus = signatureOk && computedHash === actId ? "OK" : "ERROR";
    await pool.query(
      "UPDATE acta_contents SET verification_status=$5 WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4",
      [chainId, contractAddress, row.electionId, actId, verificationStatus],
    );
  }
}

async function resolveRecoveredRelayerIncidents(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
}): Promise<void> {
  const { pool, chainId, contractAddress } = params;

  try {
    await pool.query(
      `UPDATE incident_logs i
       SET active=false, resolved_at=NOW(), last_seen_at=NOW()
       FROM mrd_submissions s
       WHERE i.chain_id=$1
         AND i.contract_address=$2
         AND i.code='MRD_SIGNUP_FAILED'
         AND i.active=true
         AND i.related_entity_type='MRD_SUBMISSION'
         AND i.related_entity_id = s.id::text
         AND s.kind='SIGNUP'
         AND i.election_id::text = s.election_id
         AND EXISTS (
           SELECT 1
           FROM signup_records sr
           WHERE sr.chain_id=i.chain_id
             AND sr.contract_address=i.contract_address
             AND sr.election_id=i.election_id
             AND LOWER(sr.registry_nullifier) = LOWER(COALESCE(s.payload->>'registryNullifier', ''))
         )`,
      [chainId, contractAddress],
    );

    await pool.query(
      `UPDATE incident_logs i
       SET active=false, resolved_at=NOW(), last_seen_at=NOW()
       FROM mrd_submissions s
       WHERE i.chain_id=$1
         AND i.contract_address=$2
         AND i.code='MRD_BALLOT_FAILED'
         AND i.active=true
         AND i.related_entity_type='MRD_SUBMISSION'
         AND i.related_entity_id = s.id::text
         AND s.kind='BALLOT'
         AND i.election_id::text = s.election_id
         AND EXISTS (
           SELECT 1
           FROM ballot_records br
           WHERE br.chain_id=i.chain_id
             AND br.contract_address=i.contract_address
             AND br.election_id=i.election_id
             AND br.ciphertext = COALESCE(s.payload->>'ciphertext', '')
         )`,
      [chainId, contractAddress],
    );
  } catch (err: unknown) {
    // mrd_submissions may not exist in deployments without relayer.
    if ((err as { code?: string })?.code === "42P01") {
      return;
    }
    throw err;
  }
}

async function backfillMissingBlockTimestamps(params: {
  pool: ReturnType<typeof createPool>;
  provider: ethers.Provider;
  chainId: string;
  contractAddress: string;
  maxBlocksPerRun?: number;
}): Promise<void> {
  const { pool, provider, chainId, contractAddress, maxBlocksPerRun = 500 } = params;

  const missingBlocksRes = await pool.query<{ block_number: string }>(
    `SELECT block_number FROM (
      SELECT block_number FROM phase_changes WHERE chain_id=$1 AND contract_address=$2 AND block_timestamp IS NULL
      UNION
      SELECT block_number FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND block_timestamp IS NULL
      UNION
      SELECT block_number FROM signup_records WHERE chain_id=$1 AND contract_address=$2 AND block_timestamp IS NULL
      UNION
      SELECT block_number FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND block_timestamp IS NULL
    ) t
    ORDER BY block_number ASC
    LIMIT $3`,
    [chainId, contractAddress, maxBlocksPerRun],
  );

  for (const row of missingBlocksRes.rows) {
    const blockNumber = Number(row.block_number);
    const block = await provider.getBlock(blockNumber);
    if (!block) continue;
    const ts = new Date(Number(block.timestamp) * 1000);

    await pool.query(
      "UPDATE phase_changes SET block_timestamp=$4 WHERE chain_id=$1 AND contract_address=$2 AND block_number=$3 AND block_timestamp IS NULL",
      [chainId, contractAddress, blockNumber, ts],
    );
    await pool.query(
      "UPDATE acta_anchors SET block_timestamp=$4 WHERE chain_id=$1 AND contract_address=$2 AND block_number=$3 AND block_timestamp IS NULL",
      [chainId, contractAddress, blockNumber, ts],
    );
    await pool.query(
      "UPDATE signup_records SET block_timestamp=$4 WHERE chain_id=$1 AND contract_address=$2 AND block_number=$3 AND block_timestamp IS NULL",
      [chainId, contractAddress, blockNumber, ts],
    );
    await pool.query(
      "UPDATE ballot_records SET block_timestamp=$4 WHERE chain_id=$1 AND contract_address=$2 AND block_number=$3 AND block_timestamp IS NULL",
      [chainId, contractAddress, blockNumber, ts],
    );
  }

  const missingElectionsRes = await pool.query<{ election_id: string; created_at_block: string }>(
    `SELECT election_id::text AS election_id, created_at_block::text AS created_at_block
     FROM elections
     WHERE chain_id=$1 AND contract_address=$2 AND created_at_timestamp IS NULL
     ORDER BY election_id ASC
     LIMIT 200`,
    [chainId, contractAddress],
  );

  for (const row of missingElectionsRes.rows) {
    const blockNumber = Number(row.created_at_block);
    const block = await provider.getBlock(blockNumber);
    if (!block) continue;
    const ts = new Date(Number(block.timestamp) * 1000);
    await pool.query(
      "UPDATE elections SET created_at_timestamp=$4 WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND created_at_timestamp IS NULL",
      [chainId, contractAddress, row.election_id, ts],
    );
  }
}

async function upsertIncident(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  electionId: string;
  incident: {
    fingerprint: string;
    code: string;
    severity: Severity;
    message: string;
    details: unknown;
    relatedTxHash?: string;
    relatedBlockNumber?: number;
    relatedBlockTimestamp?: Date | null;
    relatedEntityType?: string;
    relatedEntityId?: string;
    evidencePointers?: unknown[];
    active?: boolean;
    resolvedAt?: Date | null;
  };
}): Promise<void> {
  const { pool, chainId, contractAddress, electionId, incident } = params;

  const active = incident.active ?? true;
  const resolvedAt = active ? null : (incident.resolvedAt ?? new Date());

  await pool.query(
    `INSERT INTO incident_logs(
      chain_id, contract_address, election_id,
      fingerprint, code, severity, message, details,
      related_tx_hash, related_block_number, related_block_timestamp,
      related_entity_type, related_entity_id, evidence_pointers,
      active, resolved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET
      last_seen_at=NOW(),
      occurrences=incident_logs.occurrences + 1,
      code=EXCLUDED.code,
      severity=EXCLUDED.severity,
      message=EXCLUDED.message,
      details=EXCLUDED.details,
      related_tx_hash=COALESCE(EXCLUDED.related_tx_hash, incident_logs.related_tx_hash),
      related_block_number=COALESCE(EXCLUDED.related_block_number, incident_logs.related_block_number),
      related_block_timestamp=COALESCE(EXCLUDED.related_block_timestamp, incident_logs.related_block_timestamp),
      related_entity_type=COALESCE(EXCLUDED.related_entity_type, incident_logs.related_entity_type),
      related_entity_id=COALESCE(EXCLUDED.related_entity_id, incident_logs.related_entity_id),
      evidence_pointers=EXCLUDED.evidence_pointers,
      active=EXCLUDED.active,
      resolved_at=EXCLUDED.resolved_at`,
    [
      chainId,
      contractAddress,
      electionId,
      incident.fingerprint,
      incident.code,
      incident.severity,
      incident.message,
      JSON.stringify(incident.details),
      incident.relatedTxHash ?? null,
      incident.relatedBlockNumber ?? null,
      incident.relatedBlockTimestamp ?? null,
      incident.relatedEntityType ?? null,
      incident.relatedEntityId ?? null,
      JSON.stringify(incident.evidencePointers ?? []),
      active,
      resolvedAt,
    ],
  );
}

async function computeAndStoreConsistencyReport(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  electionId: string;
}): Promise<void> {
  const { pool, chainId, contractAddress, electionId } = params;

  const electionRes = await pool.query<{
    manifest_hash: string;
    authority: string;
    registry_authority: string;
    coordinator_pub_key: string;
    phase: number;
    created_at_block: string;
    created_at_timestamp: Date | null;
    created_tx_hash: string;
  }>(
    `SELECT
      manifest_hash,
      authority,
      registry_authority,
      coordinator_pub_key,
      phase,
      created_at_block::text AS created_at_block,
      created_at_timestamp,
      created_tx_hash
    FROM elections
    WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
    [chainId, contractAddress, electionId],
  );

  const election = electionRes.rows[0];
  if (!election) return;

  const [
    phaseChangesCountRes,
    actaAnchorsCountRes,
    signupsCountRes,
    ballotsCountRes,
    maxBlockRes,
  ] = await Promise.all([
    pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM phase_changes WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
      [chainId, contractAddress, electionId],
    ),
    pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
      [chainId, contractAddress, electionId],
    ),
    pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM signup_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
      [chainId, contractAddress, electionId],
    ),
    pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
      [chainId, contractAddress, electionId],
    ),
    pool.query<{ max_block: string | null }>(
      `SELECT MAX(block_number)::text AS max_block FROM (
        SELECT block_number FROM phase_changes WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        UNION ALL
        SELECT block_number FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        UNION ALL
        SELECT block_number FROM signup_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        UNION ALL
        SELECT block_number FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
      ) t`,
      [chainId, contractAddress, electionId],
    ),
  ]);

  const phaseChangesCount = phaseChangesCountRes.rows[0]?.n ?? 0;
  const actaAnchorsCount = actaAnchorsCountRes.rows[0]?.n ?? 0;
  const signupsCount = signupsCountRes.rows[0]?.n ?? 0;
  const ballotsCount = ballotsCountRes.rows[0]?.n ?? 0;
  const maxBlockNumber = maxBlockRes.rows[0]?.max_block ? Number(maxBlockRes.rows[0].max_block) : null;

  const dataVersion = [
    CONSISTENCY_RULESET_VERSION,
    election.phase,
    phaseChangesCount,
    actaAnchorsCount,
    signupsCount,
    ballotsCount,
    maxBlockNumber ?? "-",
  ].join(":");

  const previousVersionRes = await pool.query<{ data_version: string }>(
    `SELECT data_version
     FROM consistency_report_runs
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
     ORDER BY computed_at DESC
     LIMIT 1`,
    [chainId, contractAddress, electionId],
  );

  if (previousVersionRes.rows[0]?.data_version === dataVersion) {
    return;
  }

  const managedCodes = [
    "DUP_REGISTRY_NULLIFIER",
    "DUP_BALLOT_INDEX",
    "PHASE_PREVIOUS_MISMATCH",
    "PHASE_NON_SEQUENTIAL",
    "PHASE_CURRENT_MISMATCH",
    "BLOCK_TIMESTAMP_MISSING",
    "BLOCK_TIMESTAMP_NON_MONOTONIC",
    "SIGNUP_OUT_OF_PHASE",
    "BALLOT_OUT_OF_PHASE",
  ];

  await pool.query(
    `UPDATE incident_logs
     SET active=false, resolved_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
       AND code = ANY($4::text[])
       AND active=true`,
    [chainId, contractAddress, electionId, managedCodes],
  );

  const missingTimestampsRes = await pool.query<{ table_name: string; n: number }>(
    `SELECT 'phase_changes' AS table_name, COUNT(*)::int AS n
     FROM phase_changes
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND block_timestamp IS NULL
     UNION ALL
     SELECT 'acta_anchors' AS table_name, COUNT(*)::int AS n
     FROM acta_anchors
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND block_timestamp IS NULL
     UNION ALL
     SELECT 'signup_records' AS table_name, COUNT(*)::int AS n
     FROM signup_records
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND block_timestamp IS NULL
     UNION ALL
     SELECT 'ballot_records' AS table_name, COUNT(*)::int AS n
     FROM ballot_records
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND block_timestamp IS NULL`,
    [chainId, contractAddress, electionId],
  );

  const duplicateNullifiersRes = await pool.query<{
    registry_nullifier: string;
    n: number;
    tx_hash: string;
    block_number: string;
    block_timestamp: Date | null;
  }>(
    `SELECT
      s.registry_nullifier,
      COUNT(*)::int AS n,
      MIN(s.tx_hash) AS tx_hash,
      MIN(s.block_number)::text AS block_number,
      MIN(s.block_timestamp) AS block_timestamp
    FROM signup_records s
    WHERE s.chain_id=$1 AND s.contract_address=$2 AND s.election_id=$3
    GROUP BY s.registry_nullifier
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 25`,
    [chainId, contractAddress, electionId],
  );

  const duplicateBallotIndexesRes = await pool.query<{
    ballot_index: string;
    n: number;
    tx_hash: string;
    block_number: string;
    block_timestamp: Date | null;
  }>(
    `SELECT
      b.ballot_index::text AS ballot_index,
      COUNT(*)::int AS n,
      MIN(b.tx_hash) AS tx_hash,
      MIN(b.block_number)::text AS block_number,
      MIN(b.block_timestamp) AS block_timestamp
    FROM ballot_records b
    WHERE b.chain_id=$1 AND b.contract_address=$2 AND b.election_id=$3
    GROUP BY b.ballot_index
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 25`,
    [chainId, contractAddress, electionId],
  );

  const phaseHistoryRes = await pool.query<{
    tx_hash: string;
    log_index: number;
    block_number: string;
    block_timestamp: Date | null;
    previous_phase: number;
    new_phase: number;
  }>(
    `SELECT
      tx_hash,
      log_index,
      block_number,
      block_timestamp,
      previous_phase,
      new_phase
    FROM phase_changes
    WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
    ORDER BY block_number ASC, log_index ASC`,
    [chainId, contractAddress, electionId],
  );

  const incidents: Array<{
    fingerprint: string;
    code: string;
    severity: Severity;
    message: string;
    details: unknown;
    relatedTxHash?: string;
    relatedBlockNumber?: number;
    relatedBlockTimestamp?: Date | null;
    relatedEntityType?: string;
    relatedEntityId?: string;
    evidencePointers?: unknown[];
  }> = [];

  const missingTimestampTables = missingTimestampsRes.rows.filter((r) => (r.n ?? 0) > 0);
  if (missingTimestampTables.length > 0) {
    incidents.push({
      fingerprint: `BLOCK_TIMESTAMP_MISSING`,
      code: "BLOCK_TIMESTAMP_MISSING",
      severity: "WARNING",
      message: "Some indexed events are missing block_timestamp (backfill incomplete)",
      details: {
        tables: missingTimestampTables.map((r) => ({ table: r.table_name, missing: r.n })),
      },
      relatedEntityType: "ELECTION",
      relatedEntityId: electionId,
      evidencePointers: [{ type: "election", electionId }],
    });
  }

  for (const row of duplicateNullifiersRes.rows) {
    incidents.push({
      fingerprint: `DUP_REGISTRY_NULLIFIER:${row.registry_nullifier}`,
      code: "DUP_REGISTRY_NULLIFIER",
      severity: "CRITICAL",
      message: "Duplicate registry nullifier detected in signup_records",
      details: {
        registryNullifier: row.registry_nullifier,
        occurrences: row.n,
      },
      relatedEntityType: "REGISTRY_NULLIFIER",
      relatedEntityId: row.registry_nullifier,
      evidencePointers: [
        {
          type: "tx",
          txHash: row.tx_hash,
          blockNumber: Number(row.block_number),
          blockTimestamp: row.block_timestamp?.toISOString() ?? null,
        },
      ],
      relatedTxHash: row.tx_hash,
      relatedBlockNumber: Number(row.block_number),
      relatedBlockTimestamp: row.block_timestamp,
    });
  }

  for (const row of duplicateBallotIndexesRes.rows) {
    incidents.push({
      fingerprint: `DUP_BALLOT_INDEX:${row.ballot_index}`,
      code: "DUP_BALLOT_INDEX",
      severity: "CRITICAL",
      message: "Duplicate ballot index detected in ballot_records",
      details: {
        ballotIndex: row.ballot_index,
        occurrences: row.n,
      },
      relatedEntityType: "BALLOT_INDEX",
      relatedEntityId: row.ballot_index,
      evidencePointers: [
        {
          type: "tx",
          txHash: row.tx_hash,
          blockNumber: Number(row.block_number),
          blockTimestamp: row.block_timestamp?.toISOString() ?? null,
        },
      ],
      relatedTxHash: row.tx_hash,
      relatedBlockNumber: Number(row.block_number),
      relatedBlockTimestamp: row.block_timestamp,
    });
  }

  if (phaseHistoryRes.rows.length > 0) {
    let expectedPrevious = phaseHistoryRes.rows[0]!.previous_phase;
    for (const row of phaseHistoryRes.rows) {
      if (row.previous_phase !== expectedPrevious) {
        incidents.push({
          fingerprint: `PHASE_PREVIOUS_MISMATCH:${row.tx_hash}:${row.log_index}`,
          code: "PHASE_PREVIOUS_MISMATCH",
          severity: "CRITICAL",
          message: "PhaseChanged.previousPhase does not match the expected previous phase",
          details: {
            expectedPreviousPhase: expectedPrevious,
            observedPreviousPhase: row.previous_phase,
            newPhase: row.new_phase,
          },
          relatedEntityType: "PHASE_CHANGE",
          relatedEntityId: `${row.tx_hash}:${row.log_index}`,
          evidencePointers: [
            {
              type: "tx",
              txHash: row.tx_hash,
              blockNumber: Number(row.block_number),
              blockTimestamp: row.block_timestamp?.toISOString() ?? null,
              logIndex: row.log_index,
            },
          ],
          relatedTxHash: row.tx_hash,
          relatedBlockNumber: Number(row.block_number),
          relatedBlockTimestamp: row.block_timestamp,
        });
      }

      const expectedNext = expectedPrevious + 1;
      if (row.new_phase !== expectedNext) {
        incidents.push({
          fingerprint: `PHASE_NON_SEQUENTIAL:${row.tx_hash}:${row.log_index}`,
          code: "PHASE_NON_SEQUENTIAL",
          severity: "WARNING",
          message: "Phase transition is non-sequential (expected previous+1)",
          details: {
            previousPhase: row.previous_phase,
            newPhase: row.new_phase,
            expectedNewPhase: expectedNext,
          },
          relatedEntityType: "PHASE_CHANGE",
          relatedEntityId: `${row.tx_hash}:${row.log_index}`,
          evidencePointers: [
            {
              type: "tx",
              txHash: row.tx_hash,
              blockNumber: Number(row.block_number),
              blockTimestamp: row.block_timestamp?.toISOString() ?? null,
              logIndex: row.log_index,
            },
          ],
          relatedTxHash: row.tx_hash,
          relatedBlockNumber: Number(row.block_number),
          relatedBlockTimestamp: row.block_timestamp,
        });
      }

      expectedPrevious = row.new_phase;
    }

    const lastPhase = phaseHistoryRes.rows[phaseHistoryRes.rows.length - 1]!.new_phase;
    if (election.phase !== lastPhase) {
      incidents.push({
        fingerprint: `PHASE_CURRENT_MISMATCH:${election.phase}:${lastPhase}`,
        code: "PHASE_CURRENT_MISMATCH",
        severity: "CRITICAL",
        message: "elections.phase does not match the last PhaseChanged.newPhase",
        details: {
          electionPhase: election.phase,
          lastPhaseChangedNewPhase: lastPhase,
        },
        relatedEntityType: "ELECTION",
        relatedEntityId: electionId,
        evidencePointers: [{ type: "election", electionId }],
      });
    }
  }

  {
    const timelineRes = await pool.query<{
      kind: string;
      tx_hash: string;
      log_index: number;
      block_number: string;
      block_timestamp: Date | null;
    }>(
      `SELECT kind, tx_hash, log_index, block_number, block_timestamp
       FROM (
         SELECT 'PhaseChanged' AS kind, tx_hash, log_index, block_number, block_timestamp
         FROM phase_changes
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
         UNION ALL
         SELECT 'ActaPublished' AS kind, tx_hash, log_index, block_number, block_timestamp
         FROM acta_anchors
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
         UNION ALL
         SELECT 'SignupRecorded' AS kind, tx_hash, log_index, block_number, block_timestamp
         FROM signup_records
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
         UNION ALL
         SELECT 'BallotPublished' AS kind, tx_hash, log_index, block_number, block_timestamp
         FROM ballot_records
         WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
       ) t
       ORDER BY block_number ASC, log_index ASC
       LIMIT 5000`,
      [chainId, contractAddress, electionId],
    );

    let prevTs: Date | null = null;
    let prevEvent: (typeof timelineRes.rows)[number] | null = null;
    for (const ev of timelineRes.rows) {
      if (prevTs && ev.block_timestamp && ev.block_timestamp.getTime() < prevTs.getTime()) {
        incidents.push({
          fingerprint: `BLOCK_TIMESTAMP_NON_MONOTONIC`,
          code: "BLOCK_TIMESTAMP_NON_MONOTONIC",
          severity: "WARNING",
          message: "Non-monotonic block_timestamp detected across indexed events",
          details: {
            previous: prevEvent
              ? {
                  kind: prevEvent.kind,
                  txHash: prevEvent.tx_hash,
                  logIndex: prevEvent.log_index,
                  blockNumber: Number(prevEvent.block_number),
                  blockTimestamp: prevEvent.block_timestamp?.toISOString() ?? null,
                }
              : null,
            current: {
              kind: ev.kind,
              txHash: ev.tx_hash,
              logIndex: ev.log_index,
              blockNumber: Number(ev.block_number),
              blockTimestamp: ev.block_timestamp?.toISOString() ?? null,
            },
          },
          relatedEntityType: "ELECTION",
          relatedEntityId: electionId,
          evidencePointers: [
            prevEvent
              ? {
                  type: "tx",
                  txHash: prevEvent.tx_hash,
                  blockNumber: Number(prevEvent.block_number),
                  logIndex: prevEvent.log_index,
                }
              : null,
            {
              type: "tx",
              txHash: ev.tx_hash,
              blockNumber: Number(ev.block_number),
              logIndex: ev.log_index,
            },
          ].filter(Boolean) as unknown[],
        });
        break;
      }

      if (ev.block_timestamp) {
        prevTs = ev.block_timestamp;
        prevEvent = ev;
      }
    }
  }

  {
    type EventRow = {
      tx_hash: string;
      log_index: number;
      block_number: string;
      block_timestamp: Date | null;
    };

    const signupsRes = await pool.query<EventRow>(
      `SELECT tx_hash, log_index, block_number, block_timestamp
       FROM signup_records
       WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
       ORDER BY block_number ASC, log_index ASC
       LIMIT 5000`,
      [chainId, contractAddress, electionId],
    );

    const ballotsRes = await pool.query<EventRow>(
      `SELECT tx_hash, log_index, block_number, block_timestamp
       FROM ballot_records
       WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
       ORDER BY block_number ASC, log_index ASC
       LIMIT 5000`,
      [chainId, contractAddress, electionId],
    );

    const phasePoints = phaseHistoryRes.rows.map((r) => ({
      blockNumber: Number(r.block_number),
      logIndex: r.log_index,
      newPhase: r.new_phase,
    }));

    const phaseAt = (events: EventRow[]) => {
      let currentPhase = 0;
      let idx = 0;
      const out = [] as Array<{ ev: EventRow; phase: number }>;
      for (const ev of events) {
        const bn = Number(ev.block_number);
        while (idx < phasePoints.length) {
          const p = phasePoints[idx]!;
          if (p.blockNumber < bn || (p.blockNumber === bn && p.logIndex < ev.log_index)) {
            currentPhase = p.newPhase;
            idx++;
            continue;
          }
          break;
        }
        out.push({ ev, phase: currentPhase });
      }
      return out;
    };

    const signupOut = phaseAt(signupsRes.rows).filter((x) => x.phase !== 1);
    if (signupOut.length > 0) {
      const samples = signupOut.slice(0, 5);
      incidents.push({
        fingerprint: `SIGNUP_OUT_OF_PHASE`,
        code: "SIGNUP_OUT_OF_PHASE",
        severity: "CRITICAL",
        message: "SignupRecorded events detected outside REGISTRY_OPEN phase",
        details: {
          total: signupOut.length,
          phases: Object.fromEntries(
            Object.entries(
              signupOut.reduce<Record<string, number>>((acc, x) => {
                const k = String(x.phase);
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {}),
            ).sort(([a], [b]) => Number(a) - Number(b)),
          ),
          samples: samples.map((s) => ({
            txHash: s.ev.tx_hash,
            logIndex: s.ev.log_index,
            blockNumber: Number(s.ev.block_number),
            blockTimestamp: s.ev.block_timestamp?.toISOString() ?? null,
            phaseAtEvent: s.phase,
            phaseLabel: PHASE_LABELS[s.phase] ?? String(s.phase),
          })),
          expectedPhase: 1,
          expectedPhaseLabel: PHASE_LABELS[1] ?? "1",
        },
        relatedEntityType: "ELECTION",
        relatedEntityId: electionId,
        evidencePointers: samples.map((s) => ({
          type: "tx",
          txHash: s.ev.tx_hash,
          blockNumber: Number(s.ev.block_number),
          logIndex: s.ev.log_index,
        })),
      });
    }

    const ballotOut = phaseAt(ballotsRes.rows).filter((x) => x.phase !== 3);
    if (ballotOut.length > 0) {
      const samples = ballotOut.slice(0, 5);
      incidents.push({
        fingerprint: `BALLOT_OUT_OF_PHASE`,
        code: "BALLOT_OUT_OF_PHASE",
        severity: "CRITICAL",
        message: "BallotPublished events detected outside VOTING_OPEN phase",
        details: {
          total: ballotOut.length,
          phases: Object.fromEntries(
            Object.entries(
              ballotOut.reduce<Record<string, number>>((acc, x) => {
                const k = String(x.phase);
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {}),
            ).sort(([a], [b]) => Number(a) - Number(b)),
          ),
          samples: samples.map((s) => ({
            txHash: s.ev.tx_hash,
            logIndex: s.ev.log_index,
            blockNumber: Number(s.ev.block_number),
            blockTimestamp: s.ev.block_timestamp?.toISOString() ?? null,
            phaseAtEvent: s.phase,
            phaseLabel: PHASE_LABELS[s.phase] ?? String(s.phase),
          })),
          expectedPhase: 3,
          expectedPhaseLabel: PHASE_LABELS[3] ?? "3",
        },
        relatedEntityType: "ELECTION",
        relatedEntityId: electionId,
        evidencePointers: samples.map((s) => ({
          type: "tx",
          txHash: s.ev.tx_hash,
          blockNumber: Number(s.ev.block_number),
          logIndex: s.ev.log_index,
        })),
      });
    }
  }

  for (const incident of incidents) {
    await upsertIncident({ pool, chainId, contractAddress, electionId, incident });
  }

  const ok = !incidents.some((i) => i.severity === "CRITICAL");

  const report = {
    chainId,
    contractAddress,
    electionId,
    election: {
      manifestHash: election.manifest_hash,
      authority: election.authority,
      registryAuthority: election.registry_authority,
      coordinatorPubKey: election.coordinator_pub_key,
      phase: election.phase,
      phaseLabel: PHASE_LABELS[election.phase] ?? String(election.phase),
      createdAtBlock: Number(election.created_at_block),
      createdAtTimestamp: election.created_at_timestamp?.toISOString() ?? null,
      createdTxHash: election.created_tx_hash,
    },
    counts: {
      phaseChanges: phaseChangesCount,
      actaAnchors: actaAnchorsCount,
      signups: signupsCount,
      ballots: ballotsCount,
    },
    dataVersion,
    incidents: incidents.map((i) => ({
      fingerprint: i.fingerprint,
      code: i.code,
      severity: i.severity,
      message: i.message,
    })),
    notes: ok ? [] : ["See /v1/elections/:id/incidents for details"],
  };

  await pool.query(
    `INSERT INTO consistency_report_runs(
      chain_id, contract_address, election_id, data_version, ok, report
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING`,
    [chainId, contractAddress, electionId, dataVersion, ok, report],
  );
}

async function refreshConsistencyReports(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
  electionIds: string[];
}): Promise<void> {
  const { pool, chainId, contractAddress, electionIds } = params;
  for (const electionId of electionIds) {
    await computeAndStoreConsistencyReport({ pool, chainId, contractAddress, electionId });
  }
}

async function refreshConsistencyForAllElections(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
}): Promise<void> {
  const { pool, chainId, contractAddress } = params;
  const res = await pool.query<{ election_id: string }>(
    "SELECT election_id::text AS election_id FROM elections WHERE chain_id=$1 AND contract_address=$2 ORDER BY election_id ASC",
    [chainId, contractAddress],
  );
  await refreshConsistencyReports({
    pool,
    chainId,
    contractAddress,
    electionIds: res.rows.map((r) => r.election_id),
  });
}

async function materializePendingIndexerResetIncidents(params: {
  pool: ReturnType<typeof createPool>;
  chainId: string;
  contractAddress: string;
}): Promise<void> {
  const { pool, chainId, contractAddress } = params;
  const stateRes = await pool.query<{ last_reset_at: Date | null; last_reset_reason: string | null }>(
    `SELECT last_reset_at, last_reset_reason
     FROM indexer_state
     WHERE chain_id=$1 AND contract_address=$2`,
    [chainId, contractAddress],
  );

  const state = stateRes.rows[0];
  if (!state?.last_reset_reason) return;

  const electionsRes = await pool.query<{ election_id: string }>(
    `SELECT election_id::text AS election_id
     FROM elections
     WHERE chain_id=$1 AND contract_address=$2
     ORDER BY election_id ASC
     LIMIT 500`,
    [chainId, contractAddress],
  );

  if (electionsRes.rows.length === 0) return;

  const resetAt = state.last_reset_at ?? new Date();
  for (const row of electionsRes.rows) {
    await upsertIncident({
      pool,
      chainId,
      contractAddress,
      electionId: row.election_id,
      incident: {
        fingerprint: "INDEXER_EVIDENCE_RESET",
        code: "INDEXER_EVIDENCE_RESET",
        severity: "WARNING",
        message: "Evidence was reset due to detected divergence between DB and chain",
        details: {
          resetAt: resetAt.toISOString(),
          reason: state.last_reset_reason,
        },
        relatedEntityType: "INDEXER_STATE",
        relatedEntityId: contractAddress,
        evidencePointers: [
          {
            type: "indexer_state",
            chainId,
            contractAddress,
            resetAt: resetAt.toISOString(),
          },
        ],
        active: false,
        resolvedAt: resetAt,
      },
    });
  }

  await pool.query(
    "UPDATE indexer_state SET last_reset_at=NULL, last_reset_reason=NULL, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
    [chainId, contractAddress],
  );
}

async function main() {
  const env = getEnv();

  const contractAddress = normalizeAddress(env.ELECTION_REGISTRY_ADDRESS);

  const pool = createPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const network = await provider.getNetwork();
  const chainId = network.chainId.toString();
  const genesisBlockHash = (await provider.getBlock(0))?.hash ?? null;

  let nextBlock = await getOrInitNextBlock({
    pool,
    chainId,
    contractAddress,
    startBlock: env.START_BLOCK,
    genesisBlockHash,
  });

  nextBlock = await ensureEvidenceNotStale({
    pool,
    provider,
    chainId,
    contractAddress,
    startBlock: env.START_BLOCK,
    genesisBlockHash,
  });

  await backfillMissingBlockTimestamps({ pool, provider, chainId, contractAddress });
  const diskRefresh = await refreshActaContentsFromDisk({
    pool,
    chainId,
    contractAddress,
    sourceDir: env.ACTA_SOURCE_DIR,
  });
  await refreshActaCustodyIncidents({
    pool,
    chainId,
    contractAddress,
    sourceDir: env.ACTA_SOURCE_DIR,
    electionIdsHint: diskRefresh.electionIdsTouched,
  });
  await refreshConsistencyForAllElections({ pool, chainId, contractAddress });
  await resolveRecoveredRelayerIncidents({ pool, chainId, contractAddress });
  await materializePendingIndexerResetIncidents({ pool, chainId, contractAddress });

  const iface = new ethers.Interface(BU_PVP_1_ELECTION_REGISTRY_ABI);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const head = await provider.getBlockNumber();
    const target = Math.max(0, head - env.CONFIRMATIONS);
    if (nextBlock > target) {
      await sleep(env.POLL_INTERVAL_MS);
      continue;
    }

    const toBlock = Math.min(target, nextBlock + env.BATCH_SIZE - 1);

    const logs = await provider.getLogs({
      address: contractAddress,
      fromBlock: nextBlock,
      toBlock,
    });

    const timestampsByBlock = new Map<number, Date>();
    for (const bn of Array.from(new Set(logs.map((l) => l.blockNumber))).sort((a, b) => a - b)) {
      const block = await provider.getBlock(bn);
      if (block) {
        timestampsByBlock.set(bn, new Date(Number(block.timestamp) * 1000));
      }
    }

    const touchedElectionIds = new Set<string>();

    await withTransaction(pool, async (client) => {
      for (const log of logs) {
        const parsed = (() => {
          try {
            return iface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })();

        if (!parsed) continue;

        const txHash = log.transactionHash;
        const logIndex = log.index;
        const blockNumber = log.blockNumber;
        const blockTimestamp = timestampsByBlock.get(blockNumber) ?? null;

        if (parsed.name === "ElectionCreated") {
          const electionId = (parsed.args as any).electionId as bigint;
          const manifestHash = String((parsed.args as any).manifestHash);
          const authority = String((parsed.args as any).authority).toLowerCase();
          const registryAuthority = String((parsed.args as any).registryAuthority).toLowerCase();
          const coordinatorPubKey = String((parsed.args as any).coordinatorPubKey);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO elections(
              chain_id, contract_address, election_id,
              manifest_hash, authority, registry_authority, coordinator_pub_key,
              phase, created_at_block, created_tx_hash, created_at_timestamp
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              electionId.toString(),
              manifestHash,
              authority,
              registryAuthority,
              coordinatorPubKey,
              0,
              blockNumber,
              txHash,
              blockTimestamp,
            ],
          );
          continue;
        }

        if (parsed.name === "PhaseChanged") {
          const electionId = (parsed.args as any).electionId as bigint;
          const previousPhase = Number((parsed.args as any).previousPhase);
          const newPhase = Number((parsed.args as any).newPhase);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO phase_changes(
              chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp,
              election_id, previous_phase, new_phase
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              blockTimestamp,
              electionId.toString(),
              previousPhase,
              newPhase,
            ],
          );

          await client.query(
            "UPDATE elections SET phase=$4 WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
            [chainId, contractAddress, electionId.toString(), newPhase],
          );
          continue;
        }

        if (parsed.name === "ActaPublished") {
          const electionId = (parsed.args as any).electionId as bigint;
          const kind = Number((parsed.args as any).kind);
          const snapshotHash = String((parsed.args as any).snapshotHash);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO acta_anchors(
              chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp,
              election_id, kind, snapshot_hash
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              blockTimestamp,
              electionId.toString(),
              kind,
              snapshotHash,
            ],
          );
          continue;
        }

        if (parsed.name === "SignupRecorded") {
          const electionId = (parsed.args as any).electionId as bigint;
          const registryNullifier = String((parsed.args as any).registryNullifier);
          const votingPubKey = String((parsed.args as any).votingPubKey);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO signup_records(
              chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp,
              election_id, registry_nullifier, voting_pub_key
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              blockTimestamp,
              electionId.toString(),
              registryNullifier,
              votingPubKey,
            ],
          );
          continue;
        }

        if (parsed.name === "BallotPublished") {
          const electionId = (parsed.args as any).electionId as bigint;
          const ballotIndex = (parsed.args as any).ballotIndex as bigint;
          const ballotHash = String((parsed.args as any).ballotHash);
          const ciphertext = String((parsed.args as any).ciphertext);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO ballot_records(
              chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp,
              election_id, ballot_index, ballot_hash, ciphertext
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              blockTimestamp,
              electionId.toString(),
              ballotIndex.toString(),
              ballotHash,
              ciphertext,
            ],
          );
          continue;
        }

        // Bug 3.1 fix: Add missing `continue` to match all other event handlers
        // and prevent fallthrough to subsequent if-blocks.
        if (parsed.name === "TallyTranscriptCommitmentPublished") {
          const electionId = (parsed.args as any).electionId as bigint;
          const proofHash = String((parsed.args as any).commitmentHash);
          const proofPayload = String((parsed.args as any).commitmentPayload);

          touchedElectionIds.add(electionId.toString());

          await client.query(
            `INSERT INTO tally_proofs(
              chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp,
              election_id, proof_hash, proof_payload
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              blockTimestamp,
              electionId.toString(),
              proofHash,
              proofPayload,
            ],
          );
        }
      }
    });

    const newNext = toBlock + 1;
    const indexedBlock = await provider.getBlock(toBlock);
    await setNextBlock({
      pool,
      chainId,
      contractAddress,
      nextBlock: newNext,
      lastIndexedBlock: toBlock,
      lastIndexedBlockHash: indexedBlock?.hash ? indexedBlock.hash.toLowerCase() : null,
    });
    nextBlock = newNext;

    if (touchedElectionIds.size > 0) {
      const diskRefreshBatch = await refreshActaContentsFromDisk({
        pool,
        chainId,
        contractAddress,
        sourceDir: env.ACTA_SOURCE_DIR,
      });
      const electionIdsHint = Array.from(new Set<string>([
        ...Array.from(touchedElectionIds.values()),
        ...diskRefreshBatch.electionIdsTouched,
      ])).sort((a, b) => Number(a) - Number(b));
      await refreshActaCustodyIncidents({
        pool,
        chainId,
        contractAddress,
        sourceDir: env.ACTA_SOURCE_DIR,
        electionIdsHint,
      });
      await refreshConsistencyReports({
        pool,
        chainId,
        contractAddress,
        electionIds: Array.from(touchedElectionIds.values()).sort((a, b) => Number(a) - Number(b)),
      });

      await resolveRecoveredRelayerIncidents({ pool, chainId, contractAddress });
      await materializePendingIndexerResetIncidents({ pool, chainId, contractAddress });
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
