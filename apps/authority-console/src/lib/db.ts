import crypto from "node:crypto";
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
  dni TEXT NOT NULL REFERENCES hn_voter_registry(dni) ON DELETE CASCADE,
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

export type HondurasCensusStatus = "HABILITADO" | "INHABILITADO" | "SUSPENDIDO" | "FALLECIDO" | "OBSERVADO";

export type HondurasWalletLinkStatus = "ACTIVE" | "PENDING" | "REVOKED";

export type HondurasWalletVerificationMethod = "MANUAL_AEA" | "SELF_ATTESTED" | "CENSUS_VERIFIED" | "SYSTEM_MANAGED";

export type HondurasVoterRegistryRow = {
  dni: string;
  fullName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  secondLastName: string | null;
  habilitationStatus: HondurasCensusStatus;
  statusReason: string | null;
  censusCutoffAt: string | null;
  source: string;
  metadataJson: unknown;
  importedAt: string;
  updatedAt: string;
};

export type HondurasWalletLinkRow = {
  dni: string;
  walletAddress: string;
  linkStatus: HondurasWalletLinkStatus;
  verificationMethod: HondurasWalletVerificationMethod;
  evidenceJson: unknown;
  linkedAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type HondurasEnrollmentRequestStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type HondurasEnrollmentRequestRow = {
  requestId: string;
  dni: string;
  status: HondurasEnrollmentRequestStatus;
  requestedWalletAddress: string | null;
  requestChannel: string;
  requestNotes: string | null;
  metadataJson: unknown;
  reviewedBy: string | null;
  reviewNotes: string | null;
  requestedAt: string;
  reviewedAt: string | null;
};

export type HondurasVoterAuthorizationStatus = "AUTHORIZED" | "REVOKED" | "PENDING";

export type HondurasVoterAuthorizationRow = {
  authorizationId: string;
  chainId: string;
  contractAddress: string;
  electionId: string;
  dni: string;
  walletAddress: string;
  enrollmentRequestId: string | null;
  status: HondurasVoterAuthorizationStatus;
  authorizedBy: string | null;
  authorizationNotes: string | null;
  metadataJson: unknown;
  authorizedAt: string;
  revokedAt: string | null;
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
  electionId?: number | string | null;
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
      electionId !== undefined && electionId !== null ? BigInt(electionId) : null,
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
  electionId?: number | string;
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
      : [chainId, contractAddress, BigInt(electionId), max],
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
  electionId: number | string;
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
    [params.chainId, params.contractAddress, BigInt(params.electionId)],
  );

  return res.rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertHondurasVoterRegistryRecord(params: {
  pool: Pool;
  dni: string;
  fullName: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  secondLastName?: string | null;
  habilitationStatus: HondurasCensusStatus;
  statusReason?: string | null;
  censusCutoffAtIso?: string | null;
  source?: string;
  metadataJson?: unknown;
}): Promise<void> {
  await params.pool.query(
    `INSERT INTO hn_voter_registry(
      dni, full_name, first_name, middle_name, last_name, second_last_name,
      habilitation_status, status_reason, census_cutoff_at, source, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (dni) DO UPDATE SET
      full_name=EXCLUDED.full_name,
      first_name=EXCLUDED.first_name,
      middle_name=EXCLUDED.middle_name,
      last_name=EXCLUDED.last_name,
      second_last_name=EXCLUDED.second_last_name,
      habilitation_status=EXCLUDED.habilitation_status,
      status_reason=EXCLUDED.status_reason,
      census_cutoff_at=EXCLUDED.census_cutoff_at,
      source=EXCLUDED.source,
      metadata_json=EXCLUDED.metadata_json,
      updated_at=NOW()`,
    [
      params.dni,
      params.fullName,
      params.firstName ?? null,
      params.middleName ?? null,
      params.lastName ?? null,
      params.secondLastName ?? null,
      params.habilitationStatus,
      params.statusReason ?? null,
      params.censusCutoffAtIso ?? null,
      params.source ?? "MANUAL",
      JSON.stringify(params.metadataJson ?? {}),
    ],
  );
}

export async function getHondurasVoterRegistryRecord(params: {
  pool: Pool;
  dni: string;
}): Promise<HondurasVoterRegistryRow | null> {
  const res = await params.pool.query<{
    dni: string;
    fullName: string;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    secondLastName: string | null;
    habilitationStatus: HondurasCensusStatus;
    statusReason: string | null;
    censusCutoffAt: Date | null;
    source: string;
    metadataJson: unknown;
    importedAt: Date;
    updatedAt: Date;
  }>(
    `SELECT
      dni,
      full_name AS "fullName",
      first_name AS "firstName",
      middle_name AS "middleName",
      last_name AS "lastName",
      second_last_name AS "secondLastName",
      habilitation_status AS "habilitationStatus",
      status_reason AS "statusReason",
      census_cutoff_at AS "censusCutoffAt",
      source,
      metadata_json AS "metadataJson",
      imported_at AS "importedAt",
      updated_at AS "updatedAt"
    FROM hn_voter_registry
    WHERE dni=$1
    LIMIT 1`,
    [params.dni],
  );

  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    censusCutoffAt: row.censusCutoffAt?.toISOString() ?? null,
    importedAt: row.importedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRecentHondurasVoterRegistryRecords(params: {
  pool: Pool;
  limit?: number;
}): Promise<HondurasVoterRegistryRow[]> {
  const max = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
  const res = await params.pool.query<{
    dni: string;
    fullName: string;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    secondLastName: string | null;
    habilitationStatus: HondurasCensusStatus;
    statusReason: string | null;
    censusCutoffAt: Date | null;
    source: string;
    metadataJson: unknown;
    importedAt: Date;
    updatedAt: Date;
  }>(
    `SELECT
      dni,
      full_name AS "fullName",
      first_name AS "firstName",
      middle_name AS "middleName",
      last_name AS "lastName",
      second_last_name AS "secondLastName",
      habilitation_status AS "habilitationStatus",
      status_reason AS "statusReason",
      census_cutoff_at AS "censusCutoffAt",
      source,
      metadata_json AS "metadataJson",
      imported_at AS "importedAt",
      updated_at AS "updatedAt"
    FROM hn_voter_registry
    ORDER BY updated_at DESC, imported_at DESC
    LIMIT $1`,
    [max],
  );

  return res.rows.map((row) => ({
    ...row,
    censusCutoffAt: row.censusCutoffAt?.toISOString() ?? null,
    importedAt: row.importedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertHondurasWalletLink(params: {
  pool: Pool;
  dni: string;
  walletAddress: string;
  linkStatus: HondurasWalletLinkStatus;
  verificationMethod: HondurasWalletVerificationMethod;
  evidenceJson?: unknown;
  revokedAtIso?: string | null;
}): Promise<void> {
  await params.pool.query(
    `INSERT INTO hn_wallet_links(
      dni, wallet_address, link_status, verification_method, evidence_json, revoked_at
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (dni, wallet_address) DO UPDATE SET
      link_status=EXCLUDED.link_status,
      verification_method=EXCLUDED.verification_method,
      evidence_json=EXCLUDED.evidence_json,
      revoked_at=EXCLUDED.revoked_at,
      updated_at=NOW()`,
    [
      params.dni,
      params.walletAddress,
      params.linkStatus,
      params.verificationMethod,
      JSON.stringify(params.evidenceJson ?? {}),
      params.revokedAtIso ?? null,
    ],
  );
}

export async function listHondurasWalletLinksByDni(params: {
  pool: Pool;
  dni: string;
}): Promise<HondurasWalletLinkRow[]> {
  const res = await params.pool.query<{
    dni: string;
    walletAddress: string;
    linkStatus: HondurasWalletLinkStatus;
    verificationMethod: HondurasWalletVerificationMethod;
    evidenceJson: unknown;
    linkedAt: Date;
    updatedAt: Date;
    revokedAt: Date | null;
  }>(
    `SELECT
      dni,
      wallet_address AS "walletAddress",
      link_status AS "linkStatus",
      verification_method AS "verificationMethod",
      evidence_json AS "evidenceJson",
      linked_at AS "linkedAt",
      updated_at AS "updatedAt",
      revoked_at AS "revokedAt"
    FROM hn_wallet_links
    WHERE dni=$1
    ORDER BY updated_at DESC, linked_at DESC`,
    [params.dni],
  );

  return res.rows.map((row) => ({
    ...row,
    linkedAt: row.linkedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function createHondurasEnrollmentRequest(params: {
  pool: Pool;
  dni: string;
  requestedWalletAddress?: string | null;
  requestChannel?: string;
  requestNotes?: string | null;
  metadataJson?: unknown;
}): Promise<string> {
  const requestId = crypto.randomUUID();
  await params.pool.query(
    `INSERT INTO hn_enrollment_requests(
      request_id, dni, status, requested_wallet_address, request_channel, request_notes, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      requestId,
      params.dni,
      "PENDING_REVIEW",
      params.requestedWalletAddress ?? null,
      params.requestChannel ?? "CITIZEN_PORTAL",
      params.requestNotes ?? null,
      JSON.stringify(params.metadataJson ?? {}),
    ],
  );
  return requestId;
}

export async function listHondurasEnrollmentRequests(params: {
  pool: Pool;
  limit?: number;
  dni?: string;
  status?: HondurasEnrollmentRequestStatus;
}): Promise<HondurasEnrollmentRequestRow[]> {
  const max = Math.max(1, Math.min(100, Number(params.limit ?? 25)));
  const clauses = ["1=1"];
  const values: unknown[] = [];

  if (params.dni) {
    values.push(params.dni);
    clauses.push(`dni=$${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    clauses.push(`status=$${values.length}`);
  }

  values.push(max);

  const res = await params.pool.query<{
    requestId: string;
    dni: string;
    status: HondurasEnrollmentRequestStatus;
    requestedWalletAddress: string | null;
    requestChannel: string;
    requestNotes: string | null;
    metadataJson: unknown;
    reviewedBy: string | null;
    reviewNotes: string | null;
    requestedAt: Date;
    reviewedAt: Date | null;
  }>(
    `SELECT
      request_id AS "requestId",
      dni,
      status,
      requested_wallet_address AS "requestedWalletAddress",
      request_channel AS "requestChannel",
      request_notes AS "requestNotes",
      metadata_json AS "metadataJson",
      reviewed_by AS "reviewedBy",
      review_notes AS "reviewNotes",
      requested_at AS "requestedAt",
      reviewed_at AS "reviewedAt"
    FROM hn_enrollment_requests
    WHERE ${clauses.join(" AND ")}
    ORDER BY requested_at DESC
    LIMIT $${values.length}`,
    values,
  );

  return res.rows.map((row) => ({
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }));
}

export async function reviewHondurasEnrollmentRequest(params: {
  pool: Pool;
  requestId: string;
  status: Extract<HondurasEnrollmentRequestStatus, "APPROVED" | "REJECTED" | "CANCELLED">;
  reviewedBy: string;
  reviewNotes?: string | null;
}): Promise<number> {
  const res = await params.pool.query(
    `UPDATE hn_enrollment_requests
     SET status=$2, reviewed_by=$3, review_notes=$4, reviewed_at=NOW()
     WHERE request_id=$1`,
    [params.requestId, params.status, params.reviewedBy, params.reviewNotes ?? null],
  );
  return res.rowCount ?? 0;
}

export async function createHondurasVoterAuthorization(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: string | number;
  dni: string;
  walletAddress: string;
  enrollmentRequestId?: string | null;
  status?: HondurasVoterAuthorizationStatus;
  authorizedBy?: string | null;
  authorizationNotes?: string | null;
  metadataJson?: unknown;
}): Promise<string> {
  const authorizationId = crypto.randomUUID();
  await params.pool.query(
    `INSERT INTO hn_voter_authorizations(
      authorization_id, chain_id, contract_address, election_id, dni, wallet_address,
      enrollment_request_id, status, authorized_by, authorization_notes, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (chain_id, contract_address, election_id, dni)
    WHERE status = 'AUTHORIZED' AND revoked_at IS NULL
    DO UPDATE SET
      wallet_address=EXCLUDED.wallet_address,
      enrollment_request_id=EXCLUDED.enrollment_request_id,
      status=EXCLUDED.status,
      authorized_by=EXCLUDED.authorized_by,
      authorization_notes=EXCLUDED.authorization_notes,
      metadata_json=EXCLUDED.metadata_json,
      revoked_at=NULL,
      authorized_at=NOW()`,
    [
      authorizationId,
      params.chainId,
      params.contractAddress,
      BigInt(params.electionId),
      params.dni,
      params.walletAddress,
      params.enrollmentRequestId ?? null,
      params.status ?? "AUTHORIZED",
      params.authorizedBy ?? null,
      params.authorizationNotes ?? null,
      JSON.stringify(params.metadataJson ?? {}),
    ],
  );
  return authorizationId;
}

export async function listHondurasVoterAuthorizations(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId?: string | number;
  dni?: string;
  limit?: number;
}): Promise<HondurasVoterAuthorizationRow[]> {
  const max = Math.max(1, Math.min(100, Number(params.limit ?? 25)));
  const clauses = ["chain_id=$1", "contract_address=$2"];
  const values: unknown[] = [params.chainId, params.contractAddress];

  if (params.electionId !== undefined) {
    values.push(BigInt(params.electionId));
    clauses.push(`election_id=$${values.length}`);
  }
  if (params.dni) {
    values.push(params.dni);
    clauses.push(`dni=$${values.length}`);
  }
  values.push(max);

  const res = await params.pool.query<{
    authorizationId: string;
    chainId: string;
    contractAddress: string;
    electionId: string;
    dni: string;
    walletAddress: string;
    enrollmentRequestId: string | null;
    status: HondurasVoterAuthorizationStatus;
    authorizedBy: string | null;
    authorizationNotes: string | null;
    metadataJson: unknown;
    authorizedAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  }>(
    `SELECT
      authorization_id AS "authorizationId",
      chain_id AS "chainId",
      contract_address AS "contractAddress",
      election_id::text AS "electionId",
      dni,
      wallet_address AS "walletAddress",
      enrollment_request_id AS "enrollmentRequestId",
      status,
      authorized_by AS "authorizedBy",
      authorization_notes AS "authorizationNotes",
      metadata_json AS "metadataJson",
      authorized_at AS "authorizedAt",
      revoked_at AS "revokedAt",
      created_at AS "createdAt"
    FROM hn_voter_authorizations
    WHERE ${clauses.join(" AND ")}
    ORDER BY authorized_at DESC, created_at DESC
    LIMIT $${values.length}`,
    values,
  );

  return res.rows.map((row) => ({
    ...row,
    authorizedAt: row.authorizedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function upsertCandidate(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number | string;
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
      BigInt(params.electionId),
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
  electionId: number | string;
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
      BigInt(params.electionId),
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
  electionId: number | string;
  id: string;
  status: CandidateStatus;
}): Promise<number> {
  const res = await params.pool.query(
    `UPDATE candidates
     SET status=$5, updated_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND id=$4
     RETURNING id`,
    [params.chainId, params.contractAddress, BigInt(params.electionId), params.id, params.status],
  );
  return res.rowCount ?? 0;
}

export async function upsertElectionManifest(params: {
  pool: Pool;
  chainId: string;
  contractAddress: string;
  electionId: number | string;
  manifestHash: string;
  manifestJson: unknown;
  source?: string;
}): Promise<void> {
  const source = params.source ?? "DB_PROJECTED";
  await params.pool.query(
    `UPDATE election_manifests
     SET is_current=false, updated_at=NOW()
     WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND is_current=true`,
    [params.chainId, params.contractAddress, BigInt(params.electionId)],
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
      BigInt(params.electionId),
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
  electionId: number | string;
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
    [params.chainId, params.contractAddress, BigInt(params.electionId)],
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
  electionId: number | string;
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
      BigInt(params.electionId),
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
