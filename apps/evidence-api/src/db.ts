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

CREATE TABLE IF NOT EXISTS phase_changes (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  election_id BIGINT NOT NULL,
  previous_phase INTEGER NOT NULL,
  new_phase INTEGER NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS phase_changes_election_idx
  ON phase_changes(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS acta_anchors (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  election_id BIGINT NOT NULL,
  kind INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS acta_anchors_election_idx
  ON acta_anchors(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS signups (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  election_id BIGINT NOT NULL,
  registry_nullifier TEXT NOT NULL,
  voting_pub_key TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS signups_election_idx
  ON signups(chain_id, contract_address, election_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS ballots (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  election_id BIGINT NOT NULL,
  ballot_index BIGINT NOT NULL,
  ballot_hash TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ballots_election_idx
  ON ballots(chain_id, contract_address, election_id, block_number, log_index);
`;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
