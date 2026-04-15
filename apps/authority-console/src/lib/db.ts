import { Pool } from "pg";

const SCHEMA_SQL = `
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

declare global {
  var __authorityConsolePgPool: Pool | undefined;
  var __authorityConsolePgSchemaEnsured: boolean | undefined;
}

export type AdminLogEntry = {
  entryId: string;
  electionId: string | null;
  code: string;
  severity: string | null;
  message: string;
  details: unknown;
  evidencePointers: unknown;
  actorAddress: string | null;
  relatedTxHash: string | null;
  relatedBlockNumber: string | null;
  relatedBlockTimestamp: string | null;
  createdAt: string;
};

export function getPool(databaseUrl: string): Pool {
  if (!globalThis.__authorityConsolePgPool) {
    globalThis.__authorityConsolePgPool = new Pool({ connectionString: databaseUrl });
  }
  return globalThis.__authorityConsolePgPool;
}

export async function ensureSchema(pool: Pool): Promise<void> {
  if (globalThis.__authorityConsolePgSchemaEnsured) return;
  await pool.query(SCHEMA_SQL);
  globalThis.__authorityConsolePgSchemaEnsured = true;
}

export async function insertAdminLogEntry(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId?: number | null;
  code: string;
  severity?: string | null;
  message: string;
  details?: unknown;
  evidencePointers?: unknown;
  actorAddress?: string | null;
  relatedTxHash?: string | null;
  relatedBlockNumber?: number | null;
  relatedBlockTimestampIso?: string | null;
}): Promise<void> {
  const {
    pool,
    chainId,
    contractAddress,
    electionId,
    code,
    severity,
    message,
    details,
    evidencePointers,
    actorAddress,
    relatedTxHash,
    relatedBlockNumber,
    relatedBlockTimestampIso,
  } = params;

  await pool.query(
    `INSERT INTO admin_log_entries(
      chain_id, contract_address, election_id,
      code, severity, message,
      details, evidence_pointers,
      actor_address,
      related_tx_hash, related_block_number, related_block_timestamp
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      chainId,
      contractAddress,
      electionId ?? null,
      code,
      severity ?? null,
      message,
      JSON.stringify(details ?? {}),
      JSON.stringify(evidencePointers ?? []),
      actorAddress ?? null,
      relatedTxHash ?? null,
      relatedBlockNumber ?? null,
      relatedBlockTimestampIso ?? null,
    ],
  );
}

export async function listAdminLogEntries(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId?: number;
  limit?: number;
}): Promise<AdminLogEntry[]> {
  const { pool, chainId, contractAddress, electionId, limit } = params;
  const max = Math.max(1, Math.min(200, Number(limit ?? 50)));

  const res = await pool.query<{
    entryId: string;
    electionId: string | null;
    code: string;
    severity: string | null;
    message: string;
    details: unknown;
    evidencePointers: unknown;
    actorAddress: string | null;
    relatedTxHash: string | null;
    relatedBlockNumber: string | null;
    relatedBlockTimestamp: Date | null;
    createdAt: Date;
  }>(
    electionId === undefined
      ? `SELECT
          entry_id::text AS "entryId",
          election_id::text AS "electionId",
          code,
          severity,
          message,
          details AS "details",
          evidence_pointers AS "evidencePointers",
          actor_address AS "actorAddress",
          related_tx_hash AS "relatedTxHash",
          related_block_number::text AS "relatedBlockNumber",
          related_block_timestamp AS "relatedBlockTimestamp",
          created_at AS "createdAt"
        FROM admin_log_entries
        WHERE chain_id=$1 AND contract_address=$2
        ORDER BY created_at DESC, entry_id DESC
        LIMIT $3`
      : `SELECT
          entry_id::text AS "entryId",
          election_id::text AS "electionId",
          code,
          severity,
          message,
          details AS "details",
          evidence_pointers AS "evidencePointers",
          actor_address AS "actorAddress",
          related_tx_hash AS "relatedTxHash",
          related_block_number::text AS "relatedBlockNumber",
          related_block_timestamp AS "relatedBlockTimestamp",
          created_at AS "createdAt"
        FROM admin_log_entries
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY created_at DESC, entry_id DESC
        LIMIT $4`,
    electionId === undefined
      ? [chainId, contractAddress, max]
      : [chainId, contractAddress, electionId, max],
  );

  return res.rows.map((r) => ({
    entryId: r.entryId,
    electionId: r.electionId,
    code: r.code,
    severity: r.severity,
    message: r.message,
    details: r.details,
    evidencePointers: r.evidencePointers,
    actorAddress: r.actorAddress,
    relatedTxHash: r.relatedTxHash,
    relatedBlockNumber: r.relatedBlockNumber,
    relatedBlockTimestamp: r.relatedBlockTimestamp?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
