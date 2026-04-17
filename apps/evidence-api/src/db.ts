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
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS signature_scheme TEXT;
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS signer_address TEXT;
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS signer_role TEXT;
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS signing_digest TEXT;
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS expected_signer_address TEXT;
ALTER TABLE acta_contents
  ADD COLUMN IF NOT EXISTS signing_payload JSONB;
CREATE INDEX IF NOT EXISTS acta_contents_election_idx
  ON acta_contents(chain_id, contract_address, election_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS acta_contents_content_hash_uniq
  ON acta_contents(chain_id, contract_address, election_id, content_hash);


/* Legacy signups table removed. Use signup_records exclusively. */

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


/* Legacy ballots table removed. Use ballot_records exclusively. */

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

CREATE TABLE IF NOT EXISTS zk_proof_jobs (
  job_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  tally_job_id TEXT,
  proof_system TEXT NOT NULL,
  circuit_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  merkle_root_keccak TEXT,
  merkle_root_poseidon TEXT,
  merkle_inclusion_verified BOOLEAN NOT NULL DEFAULT false,
  public_inputs JSONB,
  proof_json JSONB,
  verification_key_hash TEXT,
  verified_offchain BOOLEAN NOT NULL DEFAULT false,
  verified_onchain BOOLEAN NOT NULL DEFAULT false,
  onchain_verifier_address TEXT,
  onchain_verification_tx TEXT,
  error_message TEXT,
  proving_started_at TIMESTAMPTZ,
  proving_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zk_proof_jobs_election_idx
  ON zk_proof_jobs(chain_id, contract_address, election_id, created_at DESC);

ALTER TABLE zk_proof_jobs
  ADD COLUMN IF NOT EXISTS merkle_root_keccak TEXT;

ALTER TABLE zk_proof_jobs
  ADD COLUMN IF NOT EXISTS merkle_root_poseidon TEXT;

ALTER TABLE zk_proof_jobs
  ADD COLUMN IF NOT EXISTS merkle_inclusion_verified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS hn_voter_registry (
  dni TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  second_last_name TEXT,
  habilitation_status TEXT NOT NULL,
  status_reason TEXT,
  census_cutoff_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hn_voter_registry_status_idx
  ON hn_voter_registry(habilitation_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS hn_voter_registry_name_idx
  ON hn_voter_registry(full_name);

CREATE TABLE IF NOT EXISTS hn_wallet_links (
  dni TEXT NOT NULL REFERENCES hn_voter_registry(dni) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  link_status TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (dni, wallet_address)
);

CREATE INDEX IF NOT EXISTS hn_wallet_links_dni_idx
  ON hn_wallet_links(dni, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS hn_wallet_links_active_wallet_uniq
  ON hn_wallet_links(wallet_address)
  WHERE link_status = 'ACTIVE' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS hn_enrollment_requests (
  request_id TEXT PRIMARY KEY,
  dni TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_wallet_address TEXT,
  request_channel TEXT NOT NULL DEFAULT 'CITIZEN_PORTAL',
  request_notes TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT,
  review_notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE hn_enrollment_requests
  DROP CONSTRAINT IF EXISTS hn_enrollment_requests_dni_fkey;

CREATE INDEX IF NOT EXISTS hn_enrollment_requests_dni_idx
  ON hn_enrollment_requests(dni, requested_at DESC);

CREATE INDEX IF NOT EXISTS hn_enrollment_requests_status_idx
  ON hn_enrollment_requests(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS hn_voter_authorizations (
  authorization_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  dni TEXT NOT NULL REFERENCES hn_voter_registry(dni) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  enrollment_request_id TEXT REFERENCES hn_enrollment_requests(request_id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  authorized_by TEXT,
  authorization_notes TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hn_voter_authorizations_lookup_idx
  ON hn_voter_authorizations(chain_id, contract_address, election_id, dni, authorized_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS hn_voter_authorizations_active_dni_uniq
  ON hn_voter_authorizations(chain_id, contract_address, election_id, dni)
  WHERE status = 'AUTHORIZED' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS hn_citizen_sessions (
  session_id TEXT PRIMARY KEY,
  dni TEXT NOT NULL REFERENCES hn_voter_registry(dni) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL,
  auth_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hn_citizen_sessions_dni_idx
  ON hn_citizen_sessions(dni, created_at DESC);

CREATE INDEX IF NOT EXISTS hn_citizen_sessions_status_idx
  ON hn_citizen_sessions(status, expires_at ASC);
`;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
