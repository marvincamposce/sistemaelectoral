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
  related_entity_type TEXT,
  related_entity_id TEXT,
  evidence_pointers JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, contract_address, election_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS incident_logs_election_active_idx
  ON incident_logs(chain_id, contract_address, election_id, active, last_seen_at DESC);
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

export type CandidateStatus = "ACTIVE" | "INACTIVE" | "WITHDRAWN";

export type CandidateRow = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: CandidateStatus;
  colorHex: string | null;
  metadataJson: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ElectionManifestRow = {
  manifestId: string;
  manifestHash: string;
  manifestJson: unknown;
  source: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
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

export async function listCandidates(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
}): Promise<CandidateRow[]> {
  const res = await params.pool.query<{
    id: string;
    candidateCode: string;
    displayName: string;
    shortName: string;
    partyName: string;
    ballotOrder: number;
    status: CandidateStatus;
    colorHex: string | null;
    metadataJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT
      id,
      candidate_code AS "candidateCode",
      display_name AS "displayName",
      short_name AS "shortName",
      party_name AS "partyName",
      ballot_order AS "ballotOrder",
      status AS "status",
      color_hex AS "colorHex",
      metadata_json AS "metadataJson",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM candidates
    WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
    ORDER BY ballot_order ASC, created_at ASC`,
    [params.chainId, params.contractAddress, params.electionId],
  );

  return res.rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertCandidate(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: CandidateStatus;
  colorHex?: string | null;
  metadataJson?: unknown;
}): Promise<void> {
  await params.pool.query(
    `INSERT INTO candidates(
      chain_id, contract_address, election_id,
      id, candidate_code,
      display_name, short_name, party_name,
      ballot_order, status, color_hex, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (chain_id, contract_address, election_id, id) DO UPDATE SET
      candidate_code=EXCLUDED.candidate_code,
      display_name=EXCLUDED.display_name,
      short_name=EXCLUDED.short_name,
      party_name=EXCLUDED.party_name,
      ballot_order=EXCLUDED.ballot_order,
      status=EXCLUDED.status,
      color_hex=EXCLUDED.color_hex,
      metadata_json=EXCLUDED.metadata_json,
      updated_at=NOW()`,
    [
      params.chainId,
      params.contractAddress,
      params.electionId,
      params.id,
      params.candidateCode,
      params.displayName,
      params.shortName,
      params.partyName,
      params.ballotOrder,
      params.status,
      params.colorHex ?? null,
      JSON.stringify(params.metadataJson ?? {}),
    ],
  );
}

export async function updateCandidateFields(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
  id: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: CandidateStatus;
  colorHex?: string | null;
  metadataJson?: unknown;
}): Promise<number> {
  const res = await params.pool.query(
    `UPDATE candidates
     SET
       display_name=$5,
       short_name=$6,
       party_name=$7,
       ballot_order=$8,
       status=$9,
       color_hex=$10,
       metadata_json=$11,
       updated_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND id=$4
     RETURNING id`,
    [
      params.chainId,
      params.contractAddress,
      params.electionId,
      params.id,
      params.displayName,
      params.shortName,
      params.partyName,
      params.ballotOrder,
      params.status,
      params.colorHex ?? null,
      JSON.stringify(params.metadataJson ?? {}),
    ],
  );
  return res.rowCount ?? 0;
}

export async function updateCandidateStatus(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
  id: string;
  status: CandidateStatus;
}): Promise<number> {
  const res = await params.pool.query(
    `UPDATE candidates
     SET status=$5, updated_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND id=$4
     RETURNING id`,
    [params.chainId, params.contractAddress, params.electionId, params.id, params.status],
  );
  return res.rowCount ?? 0;
}

export async function upsertElectionManifest(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
  manifestHash: string;
  manifestJson: unknown;
  source?: string;
}): Promise<void> {
  const source = params.source ?? "DB_PROJECTED";
  await params.pool.query(
    `UPDATE election_manifests
     SET is_current=false, updated_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND is_current=true`,
    [params.chainId, params.contractAddress, params.electionId],
  );

  await params.pool.query(
    `INSERT INTO election_manifests(
      chain_id, contract_address, election_id,
      manifest_hash, manifest_json, source, is_current
    ) VALUES ($1,$2,$3,$4,$5,$6,true)
    ON CONFLICT (chain_id, contract_address, election_id, manifest_hash) DO UPDATE SET
      manifest_json=EXCLUDED.manifest_json,
      source=EXCLUDED.source,
      is_current=true,
      updated_at=NOW()`,
    [
      params.chainId,
      params.contractAddress,
      params.electionId,
      params.manifestHash,
      JSON.stringify(params.manifestJson),
      source,
    ],
  );
}

export async function getCurrentElectionManifest(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
}): Promise<ElectionManifestRow | null> {
  const res = await params.pool.query<{
    manifestId: string;
    manifestHash: string;
    manifestJson: unknown;
    source: string;
    isCurrent: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT
      manifest_id::text AS "manifestId",
      manifest_hash AS "manifestHash",
      manifest_json AS "manifestJson",
      source,
      is_current AS "isCurrent",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM election_manifests
    WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND is_current=true
    ORDER BY created_at DESC, manifest_id DESC
    LIMIT 1`,
    [params.chainId, params.contractAddress, params.electionId],
  );

  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertIncidentLog(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number;
  fingerprint: string;
  code: string;
  severity: string;
  message: string;
  details?: unknown;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  evidencePointers?: unknown[];
}): Promise<void> {
  await params.pool.query(
    `INSERT INTO incident_logs(
      chain_id, contract_address, election_id,
      fingerprint, code, severity, message, details,
      related_entity_type, related_entity_id, evidence_pointers,
      active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
    ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET
      last_seen_at=NOW(),
      occurrences=incident_logs.occurrences + 1,
      code=EXCLUDED.code,
      severity=EXCLUDED.severity,
      message=EXCLUDED.message,
      details=EXCLUDED.details,
      related_entity_type=COALESCE(EXCLUDED.related_entity_type, incident_logs.related_entity_type),
      related_entity_id=COALESCE(EXCLUDED.related_entity_id, incident_logs.related_entity_id),
      evidence_pointers=EXCLUDED.evidence_pointers,
      active=true,
      resolved_at=NULL`,
    [
      params.chainId,
      params.contractAddress,
      params.electionId,
      params.fingerprint,
      params.code,
      params.severity,
      params.message,
      JSON.stringify(params.details ?? {}),
      params.relatedEntityType ?? null,
      params.relatedEntityId ?? null,
      JSON.stringify(params.evidencePointers ?? []),
    ],
  );
}
