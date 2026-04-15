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
