import { Pool, type PoolClient } from "pg";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  next_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address)
);

ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS genesis_block_hash TEXT;

ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS last_indexed_block BIGINT;

ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS last_indexed_block_hash TEXT;

ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ;

ALTER TABLE indexer_state
  ADD COLUMN IF NOT EXISTS last_reset_reason TEXT;

CREATE TABLE IF NOT EXISTS elections (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  manifest_hash TEXT NOT NULL,
  authority TEXT NOT NULL,
  registry_authority TEXT NOT NULL,
  coordinator_pub_key TEXT NOT NULL,
  phase INTEGER NOT NULL,
  created_at_block BIGINT NOT NULL,
  created_tx_hash TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, election_id)
);

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS created_at_timestamp TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS candidates (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  id TEXT NOT NULL,
  candidate_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  party_name TEXT NOT NULL,
  ballot_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  color_hex TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, election_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS candidates_code_uniq
  ON candidates(chain_id, contract_address, election_id, candidate_code);

CREATE INDEX IF NOT EXISTS candidates_election_order_idx
  ON candidates(chain_id, contract_address, election_id, ballot_order ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS election_manifests (
  manifest_id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  manifest_hash TEXT NOT NULL,
  manifest_json JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'DB_PROJECTED',
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS election_manifests_hash_uniq
  ON election_manifests(chain_id, contract_address, election_id, manifest_hash);

CREATE UNIQUE INDEX IF NOT EXISTS election_manifests_current_uniq
  ON election_manifests(chain_id, contract_address, election_id)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS election_manifests_created_idx
  ON election_manifests(chain_id, contract_address, election_id, created_at DESC, manifest_id DESC);

CREATE TABLE IF NOT EXISTS phase_changes (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  previous_phase INTEGER NOT NULL,
  new_phase INTEGER NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE phase_changes
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS phase_changes_election_idx
  ON phase_changes(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS acta_anchors (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  kind INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE acta_anchors
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS acta_anchors_election_idx
  ON acta_anchors(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS acta_contents (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  act_id TEXT NOT NULL,
  act_type TEXT NOT NULL,
  canonical_json JSONB NOT NULL,
  signed_json JSONB NOT NULL,
  signature TEXT NOT NULL,
  signer_key_id TEXT,
  signer_public_key TEXT,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, election_id, act_id)
);

ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS signature_scheme TEXT,
  ADD COLUMN IF NOT EXISTS signer_address TEXT,
  ADD COLUMN IF NOT EXISTS signing_digest TEXT,
  ADD COLUMN IF NOT EXISTS signer_role TEXT,
  ADD COLUMN IF NOT EXISTS expected_signer_address TEXT,
  ADD COLUMN IF NOT EXISTS signing_payload JSONB;

CREATE INDEX IF NOT EXISTS acta_contents_election_idx
  ON acta_contents(chain_id, contract_address, election_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS acta_contents_content_hash_uniq
  ON acta_contents(chain_id, contract_address, election_id, content_hash);

CREATE TABLE IF NOT EXISTS signups (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  registry_nullifier TEXT NOT NULL,
  voting_pub_key TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE signups
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS signups_election_idx
  ON signups(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS signup_records (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  registry_nullifier TEXT NOT NULL,
  voting_pub_key TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE signup_records
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS signup_records_election_idx
  ON signup_records(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS rea_signup_permits (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  registry_nullifier TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  issuer_address TEXT NOT NULL,
  permit_sig TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, election_id, registry_nullifier)
);

CREATE INDEX IF NOT EXISTS rea_signup_permits_election_idx
  ON rea_signup_permits(chain_id, contract_address, election_id, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS rea_signup_permits_credential_uniq
  ON rea_signup_permits(chain_id, contract_address, election_id, credential_id);

CREATE TABLE IF NOT EXISTS ballots (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  ballot_index BIGINT NOT NULL,
  ballot_hash TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE ballots
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ballots_election_idx
  ON ballots(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS ballot_records (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  ballot_index BIGINT NOT NULL,
  ballot_hash TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
ALTER TABLE ballot_records
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ballot_records_election_idx
  ON ballot_records(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS incident_logs (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  fingerprint TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrences BIGINT NOT NULL DEFAULT 1,
  related_tx_hash TEXT,
  related_block_number BIGINT,
  related_block_timestamp TIMESTAMPTZ,
  PRIMARY KEY (chain_id, contract_address, election_id, fingerprint)
);

ALTER TABLE incident_logs
  ADD COLUMN IF NOT EXISTS related_entity_type TEXT;

ALTER TABLE incident_logs
  ADD COLUMN IF NOT EXISTS related_entity_id TEXT;

ALTER TABLE incident_logs
  ADD COLUMN IF NOT EXISTS evidence_pointers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE incident_logs
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE incident_logs
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS incident_logs_election_idx
  ON incident_logs(chain_id, contract_address, election_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS incident_logs_election_active_idx
  ON incident_logs(chain_id, contract_address, election_id, active, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS consistency_report_runs (
  run_id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  data_version TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok BOOLEAN NOT NULL,
  report JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS consistency_report_runs_election_idx
  ON consistency_report_runs(chain_id, contract_address, election_id, computed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS consistency_report_runs_version_uniq
  ON consistency_report_runs(chain_id, contract_address, election_id, data_version);

CREATE TABLE IF NOT EXISTS admin_log_entries (
  entry_id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT,
  code TEXT NOT NULL,
  severity TEXT,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_pointers JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_address TEXT,
  related_tx_hash TEXT,
  related_block_number BIGINT,
  related_block_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_log_entries_election_idx
  ON admin_log_entries(chain_id, contract_address, election_id, created_at DESC, entry_id DESC);

CREATE INDEX IF NOT EXISTS admin_log_entries_created_idx
  ON admin_log_entries(chain_id, contract_address, created_at DESC, entry_id DESC);

CREATE TABLE IF NOT EXISTS tally_proofs (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ,
  election_id BIGINT NOT NULL,
  proof_hash TEXT NOT NULL,
  proof_payload TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS tally_proofs_election_idx
  ON tally_proofs(chain_id, contract_address, election_id, block_number, log_index);    

CREATE TABLE IF NOT EXISTS processing_batches (
  batch_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  batch_index INTEGER NOT NULL,
  input_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  related_root TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS processing_batches_election_idx
  ON processing_batches(chain_id, contract_address, election_id, batch_index ASC);

CREATE TABLE IF NOT EXISTS tally_jobs (
  tally_job_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  based_on_batch_set TEXT NOT NULL,
  status TEXT NOT NULL,
  proof_state TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED',
  result_summary JSONB,
  tally_commitment TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tally_jobs_election_idx
  ON tally_jobs(chain_id, contract_address, election_id, created_at DESC);

CREATE TABLE IF NOT EXISTS result_payloads (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  tally_job_id TEXT NOT NULL,
  result_kind TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  publication_status TEXT NOT NULL,
  proof_state TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS result_payloads_election_idx
  ON result_payloads(chain_id, contract_address, election_id, created_at DESC);

CREATE TABLE IF NOT EXISTS result_summary_items (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  result_payload_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  party_name TEXT NOT NULL,
  votes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS result_summary_items_result_candidate_uniq
  ON result_summary_items(chain_id, contract_address, election_id, result_payload_id, candidate_id);

CREATE INDEX IF NOT EXISTS result_summary_items_result_idx
  ON result_summary_items(chain_id, contract_address, election_id, result_payload_id, created_at ASC);

CREATE TABLE IF NOT EXISTS decryption_ceremonies (
  ceremony_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  threshold_required INTEGER NOT NULL,
  trustee_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS decryption_ceremonies_election_idx
  ON decryption_ceremonies(chain_id, contract_address, election_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decryption_shares (
  ceremony_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  trustee_id TEXT NOT NULL,
  share_payload TEXT NOT NULL,
  submission_channel TEXT NOT NULL DEFAULT 'MANUAL',
  signer_address TEXT,
  signature TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ceremony_id, trustee_id)
);
CREATE INDEX IF NOT EXISTS decryption_shares_election_idx
  ON decryption_shares(chain_id, contract_address, election_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS audit_windows (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  opened_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  opened_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_windows_election_idx
  ON audit_windows(chain_id, contract_address, election_id);

CREATE TABLE IF NOT EXISTS audit_bundle_exports (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  bundle_hash TEXT,
  bundle_manifest_json JSONB,
  export_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_bundle_exports_election_idx
  ON audit_bundle_exports(chain_id, contract_address, election_id, created_at DESC);
`;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function resetEvidenceForContract(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
}): Promise<void> {
  const { pool, chainId, contractAddress } = params;
  const args = [chainId, contractAddress];
  await pool.query("DELETE FROM phase_changes WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM acta_contents WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM signup_records WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM ballot_records WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM signups WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM ballots WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM tally_proofs WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM processing_batches WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM tally_jobs WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM result_payloads WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM decryption_shares WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM decryption_ceremonies WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM audit_windows WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM audit_bundle_exports WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query("DELETE FROM incident_logs WHERE chain_id=$1 AND contract_address=$2", args);
  await pool.query(
    "DELETE FROM consistency_report_runs WHERE chain_id=$1 AND contract_address=$2",
    args,
  );
  await pool.query("DELETE FROM elections WHERE chain_id=$1 AND contract_address=$2", args);
}

export async function getOrInitNextBlock(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  startBlock: number;
  genesisBlockHash?: string | null;
}): Promise<number> {
  const { pool, chainId, contractAddress, startBlock, genesisBlockHash = null } = params;

  const existing = await pool.query<{
    next_block: string;
    genesis_block_hash: string | null;
  }>(
    "SELECT next_block, genesis_block_hash FROM indexer_state WHERE chain_id=$1 AND contract_address=$2",
    [chainId, contractAddress],
  );
  if (existing.rowCount && existing.rows[0]) {
    const row = existing.rows[0];
    const storedGenesis = row.genesis_block_hash;

    if (genesisBlockHash && storedGenesis && storedGenesis !== genesisBlockHash) {
      await resetEvidenceForContract({ pool, chainId, contractAddress });
      await pool.query(
        "UPDATE indexer_state SET next_block=$3, genesis_block_hash=$4, last_indexed_block=NULL, last_indexed_block_hash=NULL, last_reset_at=NOW(), last_reset_reason=$5, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
        [
          chainId,
          contractAddress,
          startBlock,
          genesisBlockHash,
          `genesis_block_hash changed (db=${storedGenesis} chain=${genesisBlockHash})`,
        ],
      );
      return startBlock;
    }

    if (genesisBlockHash && !storedGenesis) {
      await pool.query(
        "UPDATE indexer_state SET genesis_block_hash=$3, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
        [chainId, contractAddress, genesisBlockHash],
      );
    }

    return Number(row.next_block);
  }

  await pool.query(
    "INSERT INTO indexer_state(chain_id, contract_address, next_block, genesis_block_hash) VALUES ($1,$2,$3,$4)",
    [chainId, contractAddress, startBlock, genesisBlockHash],
  );
  return startBlock;
}

export async function setNextBlock(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  nextBlock: number;
  lastIndexedBlock: number;
  lastIndexedBlockHash: string | null;
}): Promise<void> {
  const { pool, chainId, contractAddress, nextBlock, lastIndexedBlock, lastIndexedBlockHash } = params;
  await pool.query(
    "UPDATE indexer_state SET next_block=$3, last_indexed_block=$4, last_indexed_block_hash=$5, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
    [chainId, contractAddress, nextBlock, lastIndexedBlock, lastIndexedBlockHash],
  );
}
