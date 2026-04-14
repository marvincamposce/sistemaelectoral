import { Pool, type PoolClient } from "pg";

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

export async function getOrInitNextBlock(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  startBlock: number;
}): Promise<number> {
  const { pool, chainId, contractAddress, startBlock } = params;

  const existing = await pool.query<{
    next_block: string;
  }>(
    "SELECT next_block FROM indexer_state WHERE chain_id=$1 AND contract_address=$2",
    [chainId, contractAddress],
  );
  if (existing.rowCount && existing.rows[0]) {
    return Number(existing.rows[0].next_block);
  }

  await pool.query(
    "INSERT INTO indexer_state(chain_id, contract_address, next_block) VALUES ($1,$2,$3)",
    [chainId, contractAddress, startBlock],
  );
  return startBlock;
}

export async function setNextBlock(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  nextBlock: number;
}): Promise<void> {
  const { pool, chainId, contractAddress, nextBlock } = params;
  await pool.query(
    "UPDATE indexer_state SET next_block=$3, updated_at=NOW() WHERE chain_id=$1 AND contract_address=$2",
    [chainId, contractAddress, nextBlock],
  );
}
