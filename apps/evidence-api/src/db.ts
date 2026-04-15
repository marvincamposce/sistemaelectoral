import { Pool } from "pg";

// Keep schema in-sync with evidence-indexer.
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
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNKNOWN';
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
`;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
