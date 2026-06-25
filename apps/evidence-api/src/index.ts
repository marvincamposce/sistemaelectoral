import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { ethers } from "ethers";
import { verifyActaECDSASignature } from "@blockurna/crypto";

import { getEnv } from "./env.js";
import { createPool, ensureSchema } from "./db.js";

type ActaAnchorRow = {
  electionId: string;
  kind: number;
  snapshotHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ElectionMetaRow = {
  electionId: string;
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: number;
  createdAtBlock: string;
  createdAtTimestamp: Date | null;
  createdTxHash: string;
};

type PhaseChangeRow = {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockTimestamp: Date | null;
  previousPhase: number;
  newPhase: number;
};

type AnchorRow = {
  kind: number;
  snapshotHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ActRefRow = {
  actId: string;
  kind: number;
  actType: string;
  anchorTxHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  contentHash: string | null;
  createdAt: Date | null;
  verificationStatus: string | null;
  signatureScheme: string | null;
  signerAddress: string | null;
  expectedSignerAddress: string | null;
  signerRole: string | null;
  signingDigest: string | null;
  hasCritical: boolean;
  hasWarning: boolean;
};

type ActMetaRow = {
  actType: string;
  canonicalJson: unknown;
  signature: string;
  signerKeyId: string | null;
  signerPublicKey: string | null;
  contentHash: string;
  createdAt: Date;
  verificationStatus: string;
};

type ActContentRow = {
  signedJson: unknown;
};

type SignupRow = {
  registryNullifier: string;
  votingPubKey: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type SignupWithPermitRow = SignupRow & {
  permitCredentialId: string | null;
  permitIssuerAddress: string | null;
  permitSig: string | null;
  permitIssuedAt: Date | null;
  permitRecordedAt: Date | null;
};

type BallotRow = {
  ballotIndex: string;
  ballotHash: string;
  ciphertext: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ConsistencyRunRow = {
  runId: string;
  dataVersion: string;
  computedAt: Date;
  ok: boolean;
  report: unknown;
};

type IncidentRow = {
  fingerprint: string;
  code: string;
  severity: string;
  message: string;
  details: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: string;
  relatedTxHash: string | null;
  relatedBlockNumber: string | null;
  relatedBlockTimestamp: Date | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  evidencePointers: unknown;
  active: boolean;
  resolvedAt: Date | null;
};

type CandidateRow = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: string;
  colorHex: string | null;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ElectionManifestRow = {
  manifestHash: string;
  manifestJson: unknown;
  source: string;
  signatureHex: string | null;
  signerAddress: string | null;
  schemaVersion: string;
  generatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ResultPayloadRow = {
  id: string;
  tallyJobId: string | null;
  resultKind: string;
  payloadJson: unknown;
  payloadHash: string;
  publicationStatus: string;
  proofState: string | null;
  createdAt: Date;
  publishedAt: Date | null;
};

type ResultSummaryItemRow = {
  resultId: string;
  candidateId: string | null;
  candidateCode: string | null;
  displayName: string;
  partyName: string | null;
  votes: number;
  rank: number | null;
  unresolvedLabel: string | null;
};

type HondurasCensusRow = {
  dni: string;
  fullName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  secondLastName: string | null;
  habilitationStatus: string;
  statusReason: string | null;
  censusCutoffAt: Date | null;
  source: string;
  metadataJson: unknown;
  importedAt: Date;
  updatedAt: Date;
};

type HondurasWalletLinkRow = {
  dni: string;
  walletAddress: string;
  linkStatus: string;
  verificationMethod: string;
  evidenceJson: unknown;
  linkedAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

type HondurasEnrollmentRequestRow = {
  requestId: string;
  dni: string;
  status: string;
  requestedWalletAddress: string | null;
  requestChannel: string;
  requestNotes: string | null;
  metadataJson: unknown;
  reviewedBy: string | null;
  reviewNotes: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
};

type HondurasVoterAuthorizationRow = {
  authorizationId: string;
  chainId: string;
  contractAddress: string;
  electionId: string;
  dni: string;
  walletAddress: string;
  enrollmentRequestId: string | null;
  status: string;
  authorizedBy: string | null;
  authorizationNotes: string | null;
  metadataJson: unknown;
  authorizedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

type ElectionEnrollmentRequestRow = HondurasEnrollmentRequestRow & {
  fullName: string | null;
};

type ElectionAuthorizationRow = HondurasVoterAuthorizationRow & {
  fullName: string | null;
  verificationMethod: string | null;
  walletLinkStatus: string | null;
};

type EnrollmentRequestBody = {
  dni?: string;
  electionId?: string;
  requestedWalletAddress?: string;
  requestNotes?: string;
};

type PublicEnrollmentRequestBody = {
  dni?: string;
  fullName?: string;
  electionId?: string;
  requestNotes?: string;
  contactEmail?: string;
  contactPhone?: string;
};

type CitizenSessionRequestBody = {
  dni?: string;
  accessCode?: string;
};

type CitizenSessionRow = {
  sessionId: string;
  dni: string;
  tokenHash: string;
  authMethod: string;
  authContextJson: unknown;
  status: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

type EnrollmentRegistryCredential = {
  credentialVersion: "1";
  protocolVersion: "BU-PVP-1";
  credentialId: string;
  issuedAt: string;
  registryAuthority: string;
  subjectLabel: string;
  secretHex: string;
};

function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

function mapProofStateToResultMode(proofState: string | null | undefined): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "TALLY_VERIFIED_ONCHAIN" || state === "TRANSCRIPT_COMMITTED") return "BLOCKED_BY_ZK";
  if (state === "NOT_IMPLEMENTED" || state.length === 0) return "UNVERIFIED";
  return "UNVERIFIED";
}

function honestyNoteForProofState(proofState: string | null | undefined): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "Resultado y prueba verificados.";
  if (state === "TALLY_VERIFIED_ONCHAIN") {
    return "La prueba ZK principal del tally ya fue verificada en cadena, pero la publicación final sigue esperando el cierre del gate criptográfico complementario.";
  }
  if (state === "TRANSCRIPT_COMMITTED") {
    return "Existe compromiso de transcript en cadena, pero todavía no hay publicación final habilitada por verificación ZK.";
  }
  return "Resultado aún no verificado.";
}

function verifiedResultPayloadWhereClause(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}publication_status='PUBLISHED' AND ${prefix}proof_state='VERIFIED'`;
}

function zkProofJobPriorityOrderSql(): string {
  return `ORDER BY
    COALESCE(verified_onchain, false) DESC,
    COALESCE(verified_offchain, false) DESC,
    CASE status
      WHEN 'VERIFIED_ONCHAIN' THEN 4
      WHEN 'VERIFIED_OFFCHAIN' THEN 3
      WHEN 'PROVED' THEN 2
      WHEN 'BUILDING' THEN 1
      ELSE 0
    END DESC,
    created_at DESC`;
}

type ElectionRow = {
  electionId: string;
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: number;
  createdAtBlock: string;
  createdAtTimestamp: Date | null;
  createdTxHash: string;
  signups: number;
  ballots: number;
};

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

const ACTA_KIND_LABELS = [
  "ACTA_APERTURA",
  "ACTA_CIERRE",
  "ACTA_ESCRUTINIO",
  "ACTA_RESULTADOS",
] as const;

function actTypeFromKind(kind: number): string {
  return ACTA_KIND_LABELS[kind] ?? String(kind);
}

function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? String(phase);
}

function requireElectionId(id: string): string {
  if (!/^[0-9]+$/.test(id)) {
    throw new Error("Invalid election id");
  }
  // Bug 8.2 fix: Normalize to canonical form by stripping leading zeros.
  // Without this, JS string comparisons of "01" vs "1" would fail even though
  // PostgreSQL BIGINT treats both identically, causing silent data mismatches.
  return String(BigInt(id));
}

function requireHondurasDni(dni: string): string {
  const normalized = String(dni ?? "").replace(/\D/g, "");
  if (!/^[0-9]{13}$/.test(normalized)) {
    throw new Error("Invalid Honduras DNI");
  }
  return normalized;
}

function requireWalletAddress(address: string): string {
  try {
    return ethers.getAddress(address).toLowerCase();
  } catch {
    throw new Error("Invalid wallet address");
  }
}

function normalizeAddress(address: string): string {
  return ethers.getAddress(address).toLowerCase();
}

function requireTxHash(txHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Invalid txHash");
  }
  return txHash.toLowerCase();
}

function requireLogIndex(logIndex: string): number {
  if (!/^[0-9]+$/.test(logIndex)) {
    throw new Error("Invalid logIndex");
  }
  return Number(logIndex);
}

function parseSignupsCursor(cursor: string): { blockNumber: string; logIndex: number } {
  const raw = String(cursor ?? "");
  const parts = raw.split(":");
  if (parts.length !== 2) throw new Error("Invalid cursor");
  const [blockNumber, logIndex] = parts;
  if (!blockNumber || !/^[0-9]+$/.test(blockNumber)) throw new Error("Invalid cursor");
  if (!logIndex || !/^[0-9]+$/.test(logIndex)) throw new Error("Invalid cursor");
  return { blockNumber, logIndex: Number(logIndex) };
}

function formatSignupsCursor(params: { blockNumber: string; logIndex: number }): string {
  return `${params.blockNumber}:${params.logIndex}`;
}

function computeSignupDigest(params: { electionId: string; registryNullifier: string }): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:signup", BigInt(params.electionId), params.registryNullifier],
    ),
  );
}

function normalizeCandidate(row: CandidateRow) {
  return {
    id: row.id,
    candidateId: row.id,
    candidateCode: row.candidateCode,
    displayName: row.displayName,
    shortName: row.shortName,
    partyName: row.partyName,
    ballotOrder: row.ballotOrder,
    status: row.status,
    colorHex: row.colorHex,
    metadata: row.metadataJson ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeHondurasCensusRecord(row: HondurasCensusRow) {
  return {
    dni: row.dni,
    fullName: row.fullName,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    secondLastName: row.secondLastName,
    habilitationStatus: row.habilitationStatus,
    statusReason: row.statusReason,
    censusCutoffAt: row.censusCutoffAt?.toISOString() ?? null,
    source: row.source,
    metadata: row.metadataJson ?? {},
    importedAt: row.importedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeHondurasWalletLink(row: HondurasWalletLinkRow) {
  return {
    dni: row.dni,
    walletAddress: row.walletAddress,
    linkStatus: row.linkStatus,
    verificationMethod: row.verificationMethod,
    evidence: row.evidenceJson ?? {},
    linkedAt: row.linkedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function getObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getActiveWalletLink(rows: HondurasWalletLinkRow[]): HondurasWalletLinkRow | null {
  return (
    rows.find((link) => String(link.linkStatus).toUpperCase() === "ACTIVE" && !link.revokedAt) ??
    null
  );
}

function deriveCredentialId(secretHex: string): string {
  return ethers.keccak256(secretHex).toLowerCase();
}

function hashCitizenAccessCode(accessCode: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(accessCode.trim())).toLowerCase();
}

function extractCitizenAccessCodeHash(record: HondurasCensusRow): string | null {
  const metadata = getObjectRecord(record.metadataJson);
  const value = metadata.citizenAccessCodeHash;
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

function deriveRegistryNullifier(params: {
  credentialSecretHex: string;
  electionId: string | number | bigint;
}): string {
  return ethers
    .keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "bytes32"],
        ["BU-PVP-1:nullifier", BigInt(String(params.electionId)), params.credentialSecretHex],
      ),
    )
    .toLowerCase();
}

function computeSignupDigestForPermit(params: {
  electionId: string | number | bigint;
  registryNullifier: string;
}): string {
  return ethers
    .keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "bytes32"],
        ["BU-PVP-1:signup", BigInt(String(params.electionId)), params.registryNullifier],
      ),
    )
    .toLowerCase();
}

async function issueSignupPermitLocally(params: {
  chainId: string;
  contractAddress: string;
  electionId: string;
  credential: EnrollmentRegistryCredential;
  reaPrivateKey: string;
}) {
  const registryNullifier = deriveRegistryNullifier({
    credentialSecretHex: params.credential.secretHex,
    electionId: params.electionId,
  });
  const digest = computeSignupDigestForPermit({
    electionId: params.electionId,
    registryNullifier,
  });
  const wallet = new ethers.Wallet(params.reaPrivateKey);
  const permitSig = await wallet.signMessage(ethers.getBytes(digest));

  return {
    permitVersion: "1" as const,
    protocolVersion: "BU-PVP-1" as const,
    chainId: String(params.chainId),
    contractAddress: normalizeAddress(params.contractAddress),
    electionId: String(params.electionId),
    registryNullifier,
    credentialId: params.credential.credentialId,
    issuedAt: new Date().toISOString(),
    issuerAddress: normalizeAddress(wallet.address),
    permitSig,
  };
}

function normalizeHondurasEnrollmentRequest(row: HondurasEnrollmentRequestRow) {
  return {
    requestId: row.requestId,
    dni: row.dni,
    status: row.status,
    requestedWalletAddress: row.requestedWalletAddress,
    requestChannel: row.requestChannel,
    requestNotes: row.requestNotes,
    metadata: row.metadataJson ?? {},
    reviewedBy: row.reviewedBy,
    reviewNotes: row.reviewNotes,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function normalizeHondurasVoterAuthorization(row: HondurasVoterAuthorizationRow) {
  return {
    authorizationId: row.authorizationId,
    chainId: row.chainId,
    contractAddress: row.contractAddress,
    electionId: row.electionId,
    dni: row.dni,
    walletAddress: row.walletAddress,
    enrollmentRequestId: row.enrollmentRequestId,
    status: row.status,
    authorizedBy: row.authorizedBy,
    authorizationNotes: row.authorizationNotes,
    metadata: row.metadataJson ?? {},
    authorizedAt: row.authorizedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeElectionEnrollmentRequest(row: ElectionEnrollmentRequestRow) {
  return {
    ...normalizeHondurasEnrollmentRequest(row),
    fullName: row.fullName,
  };
}

function normalizeElectionAuthorization(row: ElectionAuthorizationRow) {
  return {
    ...normalizeHondurasVoterAuthorization(row),
    fullName: row.fullName,
    verificationMethod: row.verificationMethod,
    walletLinkStatus: row.walletLinkStatus,
  };
}

function coerceVotes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function resolveResultSummary(params: {
  payloadJson: unknown;
  candidates: ReturnType<typeof normalizeCandidate>[];
}) {
  const { payloadJson, candidates } = params;
  const byId = new Map(candidates.map((c) => [String(c.id).toLowerCase(), c]));
  const byCode = new Map(candidates.map((c) => [String(c.candidateCode).toLowerCase(), c]));

  const items: Array<{
    candidateId: string | null;
    candidateCode: string | null;
    displayName: string;
    partyName: string | null;
    votes: number;
    status: string | null;
    unresolvedLabel: string | null;
  }> = [];

  const unresolvedLabels: string[] = [];

  const raw = payloadJson as any;
  const summaryItems = Array.isArray(raw?.summaryItems) ? raw.summaryItems : null;

  if (summaryItems) {
    for (const rawItem of summaryItems) {
      const candidateId =
        typeof rawItem?.candidateId === "string" && rawItem.candidateId.length > 0
          ? rawItem.candidateId
          : null;
      const candidateCode =
        typeof rawItem?.candidateCode === "string" && rawItem.candidateCode.length > 0
          ? rawItem.candidateCode
          : null;
      const resolved = candidateId
        ? byId.get(candidateId.toLowerCase()) ?? (candidateCode ? byCode.get(candidateCode.toLowerCase()) : undefined)
        : candidateCode
          ? byCode.get(candidateCode.toLowerCase())
          : undefined;

      if (!resolved) {
        const label = String(candidateId ?? candidateCode ?? rawItem?.displayName ?? "UNKNOWN");
        unresolvedLabels.push(label);
        items.push({
          candidateId,
          candidateCode,
          displayName: String(rawItem?.displayName ?? label),
          partyName: typeof rawItem?.partyName === "string" ? rawItem.partyName : null,
          votes: coerceVotes(rawItem?.votes),
          status: null,
          unresolvedLabel: label,
        });
      } else {
        items.push({
          candidateId: resolved.id,
          candidateCode: resolved.candidateCode,
          displayName: resolved.displayName,
          partyName: resolved.partyName,
          votes: coerceVotes(rawItem?.votes),
          status: resolved.status,
          unresolvedLabel: null,
        });
      }
    }
  } else if (raw && typeof raw.summary === "object" && raw.summary !== null) {
    for (const [label, votes] of Object.entries(raw.summary as Record<string, unknown>)) {
      const resolved = byId.get(label.toLowerCase()) ?? byCode.get(label.toLowerCase());
      if (!resolved) {
        unresolvedLabels.push(label);
        items.push({
          candidateId: null,
          candidateCode: null,
          displayName: label,
          partyName: null,
          votes: coerceVotes(votes),
          status: null,
          unresolvedLabel: label,
        });
      } else {
        items.push({
          candidateId: resolved.id,
          candidateCode: resolved.candidateCode,
          displayName: resolved.displayName,
          partyName: resolved.partyName,
          votes: coerceVotes(votes),
          status: resolved.status,
          unresolvedLabel: null,
        });
      }
    }
  }

  return {
    items,
    unresolvedLabels,
    hasUnresolvedLabels: unresolvedLabels.length > 0,
  };
}

function resolveStoredResultSummary(params: {
  rows: ResultSummaryItemRow[];
  candidates: ReturnType<typeof normalizeCandidate>[];
}) {
  const { rows, candidates } = params;
  const byId = new Map(candidates.map((c) => [String(c.id).toLowerCase(), c]));
  const byCode = new Map(candidates.map((c) => [String(c.candidateCode).toLowerCase(), c]));

  const unresolvedLabels: string[] = [];
  const items = rows.map((row) => {
    const resolved = row.candidateId
      ? byId.get(row.candidateId.toLowerCase()) ?? (row.candidateCode ? byCode.get(row.candidateCode.toLowerCase()) : undefined)
      : row.candidateCode
        ? byCode.get(row.candidateCode.toLowerCase())
        : undefined;

    if (!resolved) {
      const unresolvedLabel = row.unresolvedLabel ?? row.displayName;
      unresolvedLabels.push(unresolvedLabel);
      return {
        candidateId: row.candidateId,
        candidateCode: row.candidateCode,
        displayName: row.displayName,
        partyName: row.partyName,
        votes: coerceVotes(row.votes),
        rank: row.rank,
        status: null,
        unresolvedLabel,
      };
    }

    return {
      candidateId: resolved.id,
      candidateCode: resolved.candidateCode,
      displayName: resolved.displayName,
      partyName: resolved.partyName,
      votes: coerceVotes(row.votes),
      rank: row.rank,
      status: resolved.status,
      unresolvedLabel: null,
    };
  });

  return {
    items,
    unresolvedLabels,
    hasUnresolvedLabels: unresolvedLabels.length > 0,
  };
}

async function main() {
  const env = getEnv();

  const chainId = env.CHAIN_ID;
  const contractAddress = ethers.getAddress(env.ELECTION_REGISTRY_ADDRESS).toLowerCase();

  const pool = createPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/", async () => {
    return {
      ok: true,
      service: "evidence-api",
      endpoints: [
        "/healthz",
        "/v1/elections",
        "/v1/hn/census/:dni",
        "/v1/hn/wallet-links/:dni",
        "/v1/hn/wallet-links/by-wallet/:wallet",
        "/v1/hn/eligibility/:dni",
        "/v1/hn/enrollment-requests",
        "/v1/hn/enrollment/:dni",
        "/v1/hn/elections/:id/prepare-signup",
        "/v1/elections/:id/enrollment",
        "/v1/elections/:id/phases",
        "/v1/elections/:id/phase-changes",
        "/v1/elections/:id/candidates",
        "/v1/elections/:id/candidates/:candidateId",
        "/v1/elections/:id/manifest",
        "/v1/elections/:id/acts",
        "/v1/elections/:id/acts/:actId",
        "/v1/elections/:id/acts/:actId/content",
        "/v1/elections/:id/acts/:actId/verify",
        "/v1/elections/:id/anchors",
        "/v1/elections/:id/signups",
        "/v1/elections/:id/signups/summary",
        "/v1/elections/:id/signups/:txHash/:logIndex",
        "/v1/elections/:id/ballots",
        "/v1/elections/:id/ballots/summary",
        "/v1/elections/:id/consistency",
        "/v1/elections/:id/incidents",
      ],
    };
  });

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");

    // Bug 8.1 fix: Expose indexer lag info so clients (e.g. voter portal)
    // can calculate appropriate polling timeouts based on actual indexer lag.
    const indexerStateRes = await pool.query<{
      last_indexed_block: string | null;
      next_block: string;
      updated_at: Date;
    }>(
      `SELECT last_indexed_block::text, next_block::text, updated_at
       FROM indexer_state
       ORDER BY updated_at DESC
       LIMIT 1`
    );
    const indexerState = indexerStateRes.rows[0] ?? null;

    return {
      ok: true,
      indexer: indexerState
        ? {
            lastIndexedBlock: indexerState.last_indexed_block
              ? Number(indexerState.last_indexed_block)
              : null,
            nextBlock: Number(indexerState.next_block),
            updatedAt: indexerState.updated_at?.toISOString() ?? null,
          }
        : null,
    };
  });

  async function getHondurasCensusRecord(dni: string): Promise<HondurasCensusRow | null> {
    const res = await pool.query<HondurasCensusRow>(
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
      [dni],
    );
    return res.rows[0] ?? null;
  }

  async function listHondurasWalletLinksByDni(dni: string): Promise<HondurasWalletLinkRow[]> {
    const res = await pool.query<HondurasWalletLinkRow>(
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
      [dni],
    );
    return res.rows;
  }

  async function listHondurasWalletLinksByWallet(walletAddress: string): Promise<HondurasWalletLinkRow[]> {
    const res = await pool.query<HondurasWalletLinkRow>(
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
      WHERE wallet_address=$1
      ORDER BY updated_at DESC, linked_at DESC`,
      [walletAddress],
    );
    return res.rows;
  }

  async function listHondurasEnrollmentRequestsByDni(dni: string): Promise<HondurasEnrollmentRequestRow[]> {
    const res = await pool.query<HondurasEnrollmentRequestRow>(
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
      WHERE dni=$1
      ORDER BY requested_at DESC`,
      [dni],
    );
    return res.rows;
  }

  async function listHondurasVoterAuthorizations(params: {
    dni: string;
    electionId?: string;
  }): Promise<HondurasVoterAuthorizationRow[]> {
    const values: unknown[] = [chainId, contractAddress, params.dni];
    let query = `SELECT
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
      WHERE chain_id=$1 AND contract_address=$2 AND dni=$3`;
    if (params.electionId) {
      values.push(BigInt(params.electionId));
      query += ` AND election_id=$${values.length}`;
    }
    query += ` ORDER BY authorized_at DESC, created_at DESC`;
    const res = await pool.query<HondurasVoterAuthorizationRow>(query, values);
    return res.rows;
  }

  async function createEnrollmentRequest(params: {
    dni: string;
    requestedWalletAddress?: string | null;
    electionId?: string | null;
    requestNotes?: string | null;
    requestChannel?: string | null;
    metadataJson?: Record<string, unknown> | null;
  }): Promise<HondurasEnrollmentRequestRow> {
    const requestId = crypto.randomUUID();
    await pool.query(
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
        JSON.stringify({
          electionId: params.electionId ?? null,
          chainId,
          contractAddress,
          ...(params.metadataJson ?? {}),
        }),
      ],
    );
    const created = await listHondurasEnrollmentRequestsByDni(params.dni);
    const latest = created[0];
    if (!latest) throw new Error("enrollment_request_creation_failed");
    return latest;
  }

  async function createCitizenSession(params: {
    dni: string;
    authMethod: string;
    authContextJson?: Record<string, unknown>;
  }): Promise<{ session: CitizenSessionRow; token: string }> {
    const sessionId = crypto.randomUUID();
    const token = ethers.hexlify(ethers.randomBytes(32)).toLowerCase();
    const tokenHash = ethers.keccak256(token).toLowerCase();
    const expiresAt = new Date(Date.now() + env.CITIZEN_SESSION_TTL_MINUTES * 60_000);

    const res = await pool.query<CitizenSessionRow>(
      `INSERT INTO hn_citizen_sessions(
        session_id, dni, token_hash, auth_method, auth_context_json, status, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING
        session_id AS "sessionId",
        dni,
        token_hash AS "tokenHash",
        auth_method AS "authMethod",
        auth_context_json AS "authContextJson",
        status,
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt"`,
      [
        sessionId,
        params.dni,
        tokenHash,
        params.authMethod,
        JSON.stringify(params.authContextJson ?? {}),
        "ACTIVE",
        expiresAt.toISOString(),
      ],
    );

    return {
      session: res.rows[0]!,
      token,
    };
  }

  async function resolveCitizenSession(token: string | null): Promise<CitizenSessionRow | null> {
    if (!token) return null;
    const tokenHash = ethers.keccak256(token).toLowerCase();
    const res = await pool.query<CitizenSessionRow>(
      `SELECT
        session_id AS "sessionId",
        dni,
        token_hash AS "tokenHash",
        auth_method AS "authMethod",
        auth_context_json AS "authContextJson",
        status,
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt"
      FROM hn_citizen_sessions
      WHERE token_hash=$1
      LIMIT 1`,
      [tokenHash],
    );
    const session = res.rows[0] ?? null;
    if (!session) return null;
    if (String(session.status).toUpperCase() !== "ACTIVE") return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    await pool.query(
      `UPDATE hn_citizen_sessions
       SET last_seen_at=NOW()
       WHERE session_id=$1`,
      [session.sessionId],
    );
    return session;
  }

  async function requireCitizenSession(request: Fastify.FastifyRequest, dni: string): Promise<CitizenSessionRow> {
    const token =
      extractBearerToken(request.headers.authorization) ??
      (typeof request.headers["x-citizen-session"] === "string" ? request.headers["x-citizen-session"] : null);
    const session = await resolveCitizenSession(token);
    if (!session) {
      throw new Error("citizen_session_required");
    }
    if (session.dni !== dni) {
      throw new Error("citizen_session_subject_mismatch");
    }
    return session;
  }

  async function ensureManagedWalletLinkForDni(record: HondurasCensusRow): Promise<HondurasWalletLinkRow> {
    const links = await listHondurasWalletLinksByDni(record.dni);
    const active = getActiveWalletLink(links);
    if (active) {
      const evidence = getObjectRecord(active.evidenceJson);
      const hasSecret =
        typeof evidence.credentialSecretHex === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(evidence.credentialSecretHex);
      if (hasSecret) {
        return active;
      }

      const seededEvidence = {
        ...evidence,
        credentialSecretHex: ethers.hexlify(ethers.randomBytes(32)).toLowerCase(),
        walletProvisioningMode: "SYSTEM_MANAGED",
      };
      await pool.query(
        `UPDATE hn_wallet_links
         SET evidence_json=$3, updated_at=NOW()
         WHERE dni=$1 AND wallet_address=$2`,
        [active.dni, active.walletAddress, JSON.stringify(seededEvidence)],
      );
      return {
        ...active,
        evidenceJson: seededEvidence,
        updatedAt: new Date(),
      };
    }

    const embeddedWallet = ethers.Wallet.createRandom();
    const evidence = {
      systemManagedWallet: true,
      managedPrivateKeyHex: embeddedWallet.privateKey.toLowerCase(),
      credentialSecretHex: ethers.hexlify(ethers.randomBytes(32)).toLowerCase(),
      walletProvisioningMode: "SYSTEM_MANAGED",
    };

    await pool.query(
      `INSERT INTO hn_wallet_links(
        dni, wallet_address, link_status, verification_method, evidence_json
      ) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (dni, wallet_address) DO UPDATE SET
        link_status=EXCLUDED.link_status,
        verification_method=EXCLUDED.verification_method,
        evidence_json=EXCLUDED.evidence_json,
        revoked_at=NULL,
        updated_at=NOW()`,
      [
        record.dni,
        embeddedWallet.address.toLowerCase(),
        "ACTIVE",
        "SYSTEM_MANAGED",
        JSON.stringify(evidence),
      ],
    );

    const created = await listHondurasWalletLinksByDni(record.dni);
    const createdActive = getActiveWalletLink(created);
    if (!createdActive) {
      throw new Error("system_wallet_link_creation_failed");
    }
    return createdActive;
  }

  async function issueAuthorizedSignupPermit(params: {
    electionId: string;
    election: ElectionMetaRow;
    record: HondurasCensusRow;
    walletLink: HondurasWalletLinkRow;
  }) {
    if (!env.REA_PRIVATE_KEY) {
      throw new Error("rea_private_key_not_configured");
    }

    const issuerWallet = new ethers.Wallet(env.REA_PRIVATE_KEY);
    if (issuerWallet.address.toLowerCase() !== String(params.election.registryAuthority).toLowerCase()) {
      throw new Error("rea_private_key_does_not_match_registry_authority");
    }

    const evidence = getObjectRecord(params.walletLink.evidenceJson);
    const credentialSecretHex = evidence.credentialSecretHex;
    if (typeof credentialSecretHex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(credentialSecretHex)) {
      throw new Error("wallet_link_missing_credential_secret");
    }

    const credential: EnrollmentRegistryCredential = {
      credentialVersion: "1",
      protocolVersion: "BU-PVP-1",
      credentialId: deriveCredentialId(credentialSecretHex),
      issuedAt: new Date().toISOString(),
      registryAuthority: params.election.registryAuthority,
      subjectLabel: `${params.record.dni}:${params.walletLink.walletAddress}`,
      secretHex: credentialSecretHex,
    };

    const permit = await issueSignupPermitLocally({
      chainId,
      electionId: params.electionId,
      contractAddress,
      credential,
      reaPrivateKey: env.REA_PRIVATE_KEY,
    });

    await pool.query(
      `INSERT INTO rea_signup_permits(
        chain_id, contract_address, election_id, registry_nullifier,
        credential_id, issuer_address, permit_sig, issued_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (chain_id, contract_address, election_id, registry_nullifier) DO UPDATE SET
        credential_id=EXCLUDED.credential_id,
        issuer_address=EXCLUDED.issuer_address,
        permit_sig=EXCLUDED.permit_sig,
        issued_at=EXCLUDED.issued_at,
        recorded_at=NOW()`,
      [
        chainId,
        contractAddress,
        BigInt(params.electionId),
        permit.registryNullifier,
        permit.credentialId,
        permit.issuerAddress,
        permit.permitSig,
        permit.issuedAt,
      ],
    );

    return permit;
  }

  app.get<{ Params: { dni: string } }>("/v1/hn/census/:dni", async (req, reply) => {
    try {
      const dni = requireHondurasDni(req.params.dni);
      const record = await getHondurasCensusRecord(dni);
      if (!record) {
        reply.status(404);
        return { ok: false, error: "dni_not_found", dni };
      }

      return {
        ok: true,
        dni,
        record: normalizeHondurasCensusRecord(record),
      };
    } catch (err: unknown) {
      const message = (err as Error).message;
      const status =
        message === "citizen_session_required" ? 401
        : message === "citizen_session_subject_mismatch" ? 403
        : 400;
      reply.status(status);
      return { ok: false, error: message };
    }
  });

  app.get<{ Params: { dni: string } }>("/v1/hn/wallet-links/:dni", async (req, reply) => {
    try {
      const dni = requireHondurasDni(req.params.dni);
      const links = await listHondurasWalletLinksByDni(dni);
      return {
        ok: true,
        dni,
        links: links.map(normalizeHondurasWalletLink),
        count: links.length,
      };
    } catch (err: unknown) {
      const message = (err as Error).message;
      const status =
        message === "citizen_session_required" ? 401
        : message === "citizen_session_subject_mismatch" ? 403
        : 400;
      reply.status(status);
      return { ok: false, error: message };
    }
  });

  app.get<{ Params: { wallet: string } }>("/v1/hn/wallet-links/by-wallet/:wallet", async (req, reply) => {
    try {
      const walletAddress = requireWalletAddress(req.params.wallet);
      const links = await listHondurasWalletLinksByWallet(walletAddress);
      return {
        ok: true,
        walletAddress,
        links: links.map(normalizeHondurasWalletLink),
        count: links.length,
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { dni: string } }>("/v1/hn/eligibility/:dni", async (req, reply) => {
    try {
      const dni = requireHondurasDni(req.params.dni);
      const [record, links, requests, authorizations] = await Promise.all([
        getHondurasCensusRecord(dni),
        listHondurasWalletLinksByDni(dni),
        listHondurasEnrollmentRequestsByDni(dni),
        listHondurasVoterAuthorizations({ dni }),
      ]);

      if (!record) {
        reply.status(404);
        return { ok: false, error: "dni_not_found", dni };
      }

      const activeLink = getActiveWalletLink(links);

      return {
        ok: true,
        dni,
        habilitado: String(record.habilitationStatus).toUpperCase() === "HABILITADO",
        record: normalizeHondurasCensusRecord(record),
        latestRequest: requests[0] ? normalizeHondurasEnrollmentRequest(requests[0]) : null,
        latestAuthorization: authorizations[0] ? normalizeHondurasVoterAuthorization(authorizations[0]) : null,
        walletLink: activeLink ? normalizeHondurasWalletLink(activeLink) : null,
        walletLinks: links.map(normalizeHondurasWalletLink),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{ Body: PublicEnrollmentRequestBody }>(
    "/v1/hn/public-enrollment-requests",
    async (req, reply) => {
      try {
        const dni = requireHondurasDni(String(req.body?.dni ?? ""));
        const fullName = String(req.body?.fullName ?? "").trim();
        if (fullName.length < 5) {
          reply.status(400);
          return { ok: false, error: "full_name_required" };
        }

        const electionId = req.body?.electionId ? requireElectionId(String(req.body.electionId)) : null;
        const existing = await listHondurasEnrollmentRequestsByDni(dni);
        const latestPending = existing.find((row) => String(row.status).toUpperCase() === "PENDING_REVIEW");
        if (latestPending) {
          return {
            ok: true,
            dni,
            request: normalizeHondurasEnrollmentRequest(latestPending),
            idempotent: true,
          };
        }

        const request = await createEnrollmentRequest({
          dni,
          electionId,
          requestNotes: req.body?.requestNotes ? String(req.body.requestNotes) : null,
          requestedWalletAddress: null,
          requestChannel: "PUBLIC_SELF_REGISTRATION",
          metadataJson: {
            selfRegistration: true,
            fullName,
            contactEmail: String(req.body?.contactEmail ?? "").trim() || null,
            contactPhone: String(req.body?.contactPhone ?? "").trim() || null,
          },
        });

        return {
          ok: true,
          dni,
          request: normalizeHondurasEnrollmentRequest(request),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.post<{ Body: EnrollmentRequestBody }>(
    "/v1/hn/enrollment-requests",
    async (req, reply) => {
      try {
        const dni = requireHondurasDni(String(req.body?.dni ?? ""));
        await requireCitizenSession(req, dni);
        const electionId = req.body?.electionId ? requireElectionId(String(req.body.electionId)) : null;
        const requestedWalletAddress = req.body?.requestedWalletAddress
          ? requireWalletAddress(String(req.body.requestedWalletAddress))
          : null;

        const record = await getHondurasCensusRecord(dni);
        if (!record) {
          reply.status(404);
          return { ok: false, error: "dni_not_found", dni };
        }

        const existing = await listHondurasEnrollmentRequestsByDni(dni);
        const latestPending = existing.find((row) => String(row.status).toUpperCase() === "PENDING_REVIEW");
        if (latestPending) {
          return {
            ok: true,
            dni,
            request: normalizeHondurasEnrollmentRequest(latestPending),
            record: normalizeHondurasCensusRecord(record),
            idempotent: true,
          };
        }

        const request = await createEnrollmentRequest({
          dni,
          electionId,
          requestedWalletAddress,
          requestNotes: req.body?.requestNotes ? String(req.body.requestNotes) : null,
          requestChannel: "CITIZEN_PORTAL",
          metadataJson: {
            electionId,
            citizenInitiated: true,
          },
        });

        return {
          ok: true,
          dni,
          request: normalizeHondurasEnrollmentRequest(request),
          record: normalizeHondurasCensusRecord(record),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{
    Params: {
      dni: string;
    };
  }>("/v1/hn/public-enrollment-status/:dni", async (req, reply) => {
    try {
      const dni = requireHondurasDni(String(req.params?.dni ?? ""));
      const [record, requests, walletLinks, authorizations] = await Promise.all([
        getHondurasCensusRecord(dni),
        listHondurasEnrollmentRequestsByDni(dni),
        listHondurasWalletLinksByDni(dni),
        listHondurasVoterAuthorizations({
          dni,
        }),
      ]);

      const activeWallet = getActiveWalletLink(walletLinks);
      const activeAuthorizations = authorizations.filter(
        (row) => String(row.status).toUpperCase() === "AUTHORIZED" && !row.revokedAt,
      );

      return {
        ok: true,
        dni,
        record: record ? normalizeHondurasCensusRecord(record) : null,
        latestRequest: requests[0] ? normalizeHondurasEnrollmentRequest(requests[0]) : null,
        requests: requests.map(normalizeHondurasEnrollmentRequest),
        walletProvisioned: Boolean(activeWallet),
        citizenAccessConfigured: record ? Boolean(extractCitizenAccessCodeHash(record)) : false,
        authorizations: activeAuthorizations.map(normalizeHondurasVoterAuthorization),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{ Body: CitizenSessionRequestBody }>("/v1/hn/auth/session", async (req, reply) => {
    try {
      const dni = requireHondurasDni(String(req.body?.dni ?? ""));
      const accessCode = String(req.body?.accessCode ?? "").trim();
      if (accessCode.length < 6) {
        reply.status(400);
        return { ok: false, error: "invalid_access_code" };
      }

      const [record, links, requests, authorizations] = await Promise.all([
        getHondurasCensusRecord(dni),
        listHondurasWalletLinksByDni(dni),
        listHondurasEnrollmentRequestsByDni(dni),
        listHondurasVoterAuthorizations({ dni }),
      ]);

      if (!record) {
        reply.status(404);
        return { ok: false, error: "dni_not_found", dni };
      }

      const expectedHash = extractCitizenAccessCodeHash(record);
      if (!expectedHash) {
        reply.status(403);
        return { ok: false, error: "citizen_access_not_configured", dni };
      }
      if (hashCitizenAccessCode(accessCode) !== expectedHash) {
        reply.status(401);
        return { ok: false, error: "invalid_access_code", dni };
      }

      const created = await createCitizenSession({
        dni,
        authMethod: "ACCESS_CODE",
        authContextJson: {
          accessCodeVerifiedAt: new Date().toISOString(),
        },
      });

      return {
        ok: true,
        session: {
          sessionId: created.session.sessionId,
          token: created.token,
          authMethod: created.session.authMethod,
          expiresAt: created.session.expiresAt.toISOString(),
        },
        dni,
        record: normalizeHondurasCensusRecord(record),
        latestRequest: requests[0] ? normalizeHondurasEnrollmentRequest(requests[0]) : null,
        requests: requests.map(normalizeHondurasEnrollmentRequest),
        walletLink: getActiveWalletLink(links) ? normalizeHondurasWalletLink(getActiveWalletLink(links)!) : null,
        walletLinks: links.map(normalizeHondurasWalletLink),
        authorizations: authorizations.map(normalizeHondurasVoterAuthorization),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { dni: string } }>("/v1/hn/enrollment/:dni", async (req, reply) => {
    try {
      const dni = requireHondurasDni(req.params.dni);
      await requireCitizenSession(req, dni);
      const [record, links, requests, authorizations] = await Promise.all([
        getHondurasCensusRecord(dni),
        listHondurasWalletLinksByDni(dni),
        listHondurasEnrollmentRequestsByDni(dni),
        listHondurasVoterAuthorizations({ dni }),
      ]);

      if (!record) {
        reply.status(404);
        return { ok: false, error: "dni_not_found", dni };
      }

      return {
        ok: true,
        dni,
        record: normalizeHondurasCensusRecord(record),
        latestRequest: requests[0] ? normalizeHondurasEnrollmentRequest(requests[0]) : null,
        requests: requests.map(normalizeHondurasEnrollmentRequest),
        walletLink: getActiveWalletLink(links) ? normalizeHondurasWalletLink(getActiveWalletLink(links)!) : null,
        walletLinks: links.map(normalizeHondurasWalletLink),
        authorizations: authorizations.map(normalizeHondurasVoterAuthorization),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{ Params: { id: string }; Body: EnrollmentRequestBody }>(
    "/v1/hn/elections/:id/prepare-signup",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const dni = requireHondurasDni(String(req.body?.dni ?? ""));
        const session = await requireCitizenSession(req, dni);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const [record, authorizations, requests] = await Promise.all([
          getHondurasCensusRecord(dni),
          listHondurasVoterAuthorizations({ dni, electionId }),
          listHondurasEnrollmentRequestsByDni(dni),
        ]);
        if (!record) {
          reply.status(404);
          return { ok: false, error: "dni_not_found", dni };
        }
        if (String(record.habilitationStatus).toUpperCase() !== "HABILITADO") {
          reply.status(403);
          return { ok: false, error: "dni_not_eligible", dni, record: normalizeHondurasCensusRecord(record) };
        }

        const activeAuthorization =
          authorizations.find((row) => String(row.status).toUpperCase() === "AUTHORIZED" && !row.revokedAt) ?? null;
        if (!activeAuthorization) {
          reply.status(403);
          return {
            ok: false,
            error: "voter_not_authorized_for_election",
            dni,
            latestRequest: requests[0] ? normalizeHondurasEnrollmentRequest(requests[0]) : null,
          };
        }

        const walletLinks = await listHondurasWalletLinksByDni(dni);
        const walletLink =
          walletLinks.find(
            (link) =>
              link.walletAddress.toLowerCase() === activeAuthorization.walletAddress.toLowerCase() &&
              String(link.linkStatus).toUpperCase() === "ACTIVE" &&
              !link.revokedAt,
          ) ?? getActiveWalletLink(walletLinks);
        if (!walletLink) {
          throw new Error("authorized_wallet_link_not_found");
        }

        const hardenedWalletLink = await ensureManagedWalletLinkForDni(record);
        const permit = await issueAuthorizedSignupPermit({
          electionId,
          election,
          record,
          walletLink: hardenedWalletLink.walletAddress.toLowerCase() === walletLink.walletAddress.toLowerCase()
            ? hardenedWalletLink
            : walletLink,
        });

        return {
          ok: true,
          dni,
          electionId,
          session: {
            sessionId: session.sessionId,
            authMethod: session.authMethod,
            expiresAt: session.expiresAt.toISOString(),
          },
          record: normalizeHondurasCensusRecord(record),
          walletLink: normalizeHondurasWalletLink(
            hardenedWalletLink.walletAddress.toLowerCase() === walletLink.walletAddress.toLowerCase()
              ? hardenedWalletLink
              : walletLink,
          ),
          permit,
          authorization: normalizeHondurasVoterAuthorization(activeAuthorization),
        };
      } catch (err: unknown) {
        const message = (err as Error).message;
        const status =
          message === "rea_private_key_not_configured" ? 503
          : message === "citizen_session_required" ? 401
          : message === "citizen_session_subject_mismatch" ? 403
          : 400;
        reply.status(status);
        return { ok: false, error: message };
      }
    },
  );

  app.get("/v1/elections", async () => {
    const electionsRes = await pool.query<ElectionRow>(
      `SELECT
        e.election_id::text AS "electionId",
        e.manifest_hash AS "manifestHash",
        e.authority AS "authority",
        e.registry_authority AS "registryAuthority",
        e.coordinator_pub_key AS "coordinatorPubKey",
        e.phase::int AS "phase",
        e.created_at_block::text AS "createdAtBlock",
        e.created_at_timestamp AS "createdAtTimestamp",
        e.created_tx_hash AS "createdTxHash",
        (SELECT COUNT(*)::int FROM signup_records s WHERE s.chain_id=e.chain_id AND s.contract_address=e.contract_address AND s.election_id=e.election_id) AS "signups",
        (SELECT COUNT(*)::int FROM ballot_records b WHERE b.chain_id=e.chain_id AND b.contract_address=e.contract_address AND b.election_id=e.election_id) AS "ballots"
      FROM elections e
      WHERE e.chain_id=$1 AND e.contract_address=$2
      ORDER BY e.election_id ASC`,
      [chainId, contractAddress],
    );

    const actasRes = await pool.query<ActaAnchorRow>(
      `SELECT
        a.election_id::text AS "electionId",
        a.kind::int AS "kind",
        a.snapshot_hash AS "snapshotHash",
        a.block_number::text AS "blockNumber",
        a.block_timestamp AS "blockTimestamp",
        a.tx_hash AS "txHash",
        a.log_index::int AS "logIndex"
      FROM acta_anchors a
      WHERE a.chain_id=$1 AND a.contract_address=$2
      ORDER BY a.block_number ASC, a.log_index ASC`,
      [chainId, contractAddress],
    );

    const actasByElection = new Map<string, ActaAnchorRow[]>();
    for (const a of actasRes.rows) {
      const list = actasByElection.get(a.electionId) ?? [];
      list.push(a);
      actasByElection.set(a.electionId, list);
    }

    return {
      ok: true,
      chainId,
      contractAddress,
      elections: electionsRes.rows.map((e: ElectionRow) => ({
        ...e,
        createdAtTimestamp: e.createdAtTimestamp?.toISOString() ?? null,
        phaseLabel: phaseLabel(e.phase),
        counts: { signups: e.signups, ballots: e.ballots },
        actas: actasByElection.get(e.electionId) ?? [],
      })),
    };
  });

  async function getElectionMeta(electionIdRaw: string): Promise<ElectionMetaRow | null> {
    const electionId = requireElectionId(electionIdRaw);
    const res = await pool.query<ElectionMetaRow>(
      `SELECT
        e.election_id::text AS "electionId",
        e.manifest_hash AS "manifestHash",
        e.authority AS "authority",
        e.registry_authority AS "registryAuthority",
        e.coordinator_pub_key AS "coordinatorPubKey",
        e.phase::int AS "phase",
        e.created_at_block::text AS "createdAtBlock",
        e.created_at_timestamp AS "createdAtTimestamp",
        e.created_tx_hash AS "createdTxHash"
      FROM elections e
      WHERE e.chain_id=$1 AND e.contract_address=$2 AND e.election_id=$3`,
      [chainId, contractAddress, electionId],
    );
    return res.rows[0] ?? null;
  }

  async function listElectionCandidates(electionId: string) {
    const res = await pool.query<CandidateRow>(
      `SELECT
        id,
        candidate_code AS "candidateCode",
        display_name AS "displayName",
        short_name AS "shortName",
        party_name AS "partyName",
        ballot_order::int AS "ballotOrder",
        status AS "status",
        color_hex AS "colorHex",
        metadata_json AS "metadataJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM candidates
      WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
      ORDER BY ballot_order ASC, created_at ASC`,
      [chainId, contractAddress, electionId],
    );

    return res.rows.map(normalizeCandidate);
  }

  async function getCurrentElectionManifest(electionId: string): Promise<ElectionManifestRow | null> {
    const res = await pool.query<ElectionManifestRow>(
      `SELECT
        manifest_hash AS "manifestHash",
        manifest_json AS "manifestJson",
        source,
        NULL::text AS "signatureHex",
        NULL::text AS "signerAddress",
        COALESCE(
          manifest_json->'manifest'->>'manifestVersion',
          manifest_json->>'manifestVersion',
          '1.0.0'
        ) AS "schemaVersion",
        NULL::timestamptz AS "generatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM election_manifests
      WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND is_current=true
      ORDER BY updated_at DESC, manifest_id DESC
      LIMIT 1`,
      [chainId, contractAddress, electionId],
    );
    return res.rows[0] ?? null;
  }

  app.get<{ Params: { id: string } }>("/v1/elections/:id/candidates", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId.toString());
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const candidates = await listElectionCandidates(electionId);
      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        candidates,
        count: candidates.length,
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string; candidateId: string } }>(
    "/v1/elections/:id/candidates/:candidateId",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId.toString());
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const candidateId = req.params.candidateId.trim();
        if (!candidateId) {
          reply.status(400);
          return { ok: false, error: "candidate_id_required" };
        }

        const res = await pool.query<CandidateRow>(
          `SELECT
            id,
            candidate_code AS "candidateCode",
            display_name AS "displayName",
            short_name AS "shortName",
            party_name AS "partyName",
            ballot_order::int AS "ballotOrder",
            status AS "status",
            color_hex AS "colorHex",
            metadata_json AS "metadataJson",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM candidates
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
            AND (id=$4 OR lower(candidate_code)=lower($4))
          LIMIT 1`,
          [chainId, contractAddress, electionId, candidateId],
        );

        if (res.rows.length === 0) {
          reply.status(404);
          return { ok: false, error: "candidate_not_found" };
        }

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          candidate: normalizeCandidate(res.rows[0]!),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/manifest", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId.toString());
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const manifest = await getCurrentElectionManifest(electionId);

      if (!manifest) {
        reply.status(404);
        return {
          ok: false,
          error: "manifest_not_materialized",
        };
      }

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        manifest: {
          manifestHash: manifest.manifestHash,
          manifestJson: manifest.manifestJson,
          signatureHex: manifest.signatureHex,
          signerAddress: manifest.signerAddress,
          schemaVersion: manifest.schemaVersion,
          generatedAt: manifest.generatedAt?.toISOString() ?? null,
          createdAt: manifest.createdAt.toISOString(),
          updatedAt: manifest.updatedAt.toISOString(),
        },
        source: "materialized",
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/phases", async (req, reply) => {
    try {
      const election = await getElectionMeta(req.params.id);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      return {
        ok: true,
        chainId,
        contractAddress,
        election: {
          ...election,
          createdAtTimestamp: election.createdAtTimestamp?.toISOString() ?? null,
          phaseLabel: phaseLabel(election.phase),
        },
        phases: PHASE_LABELS.map((label, id) => ({ id, label })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/phase-changes",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<PhaseChangeRow>(
          `SELECT
            tx_hash AS "txHash",
            log_index::int AS "logIndex",
            block_number::text AS "blockNumber",
            block_timestamp AS "blockTimestamp",
            previous_phase::int AS "previousPhase",
            new_phase::int AS "newPhase"
          FROM phase_changes
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY block_number ASC, log_index ASC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          phaseChanges: res.rows.map((r) => ({
            ...r,
            blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
            previousPhaseLabel: phaseLabel(r.previousPhase),
            newPhaseLabel: phaseLabel(r.newPhase),
          })),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/anchors", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<AnchorRow>(
        `SELECT
          kind::int AS "kind",
          snapshot_hash AS "snapshotHash",
          block_number::text AS "blockNumber",
          block_timestamp AS "blockTimestamp",
          tx_hash AS "txHash",
          log_index::int AS "logIndex"
        FROM acta_anchors
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY block_number ASC, log_index ASC`,
        [chainId, contractAddress, electionId],
      );


      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        anchors: res.rows.map((r) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/acts", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<ActRefRow>(
        `SELECT DISTINCT ON (a.snapshot_hash)
          a.snapshot_hash AS "actId",
          a.kind::int AS "kind",
          COALESCE(c.act_type, '') AS "actType",
          a.tx_hash AS "anchorTxHash",
          a.block_number::text AS "blockNumber",
          a.block_timestamp AS "blockTimestamp",
          c.content_hash AS "contentHash",
           c.created_at AS "createdAt",
           c.verification_status AS "verificationStatus",
           c.signature_scheme AS "signatureScheme",
           c.signer_address AS "signerAddress",
           c.expected_signer_address AS "expectedSignerAddress",
           c.signer_role AS "signerRole",
           c.signing_digest AS "signingDigest",
           COALESCE(i.has_critical, false) AS "hasCritical",
           COALESCE(i.has_warning, false) AS "hasWarning"
        FROM acta_anchors a
        LEFT JOIN acta_contents c
          ON c.chain_id=a.chain_id AND c.contract_address=a.contract_address AND c.election_id=a.election_id AND c.act_id=a.snapshot_hash
          LEFT JOIN (
            SELECT
              regexp_replace(fingerprint, '^.*:', '') AS act_id,
              BOOL_OR(severity IN ('CRITICAL','ERROR')) AS has_critical,
              BOOL_OR(severity IN ('WARNING','WARN')) AS has_warning
            FROM incident_logs
            WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND active=true
            GROUP BY act_id
          ) i ON i.act_id = a.snapshot_hash
        WHERE a.chain_id=$1 AND a.contract_address=$2 AND a.election_id=$3
        ORDER BY a.snapshot_hash, a.block_number ASC, a.log_index ASC`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        acts: res.rows.map((r) => ({
          contentAvailable: Boolean(r.contentHash),
          consistencyStatus: r.hasCritical ? 'CRITICAL' : r.hasWarning ? 'WARNING' : 'OK',
          verificationStatus: !r.contentHash
            ? 'INCOMPLETE'
            : r.verificationStatus && r.verificationStatus !== 'UNKNOWN'
              ? r.verificationStatus
              : r.hasCritical
                ? 'ERROR'
                : r.hasWarning
                  ? 'WARNING'
                  : 'OK',
          actId: r.actId,
          actType: r.actType && r.actType.length > 0 ? r.actType : actTypeFromKind(r.kind),
          anchorTxHash: r.anchorTxHash,
          blockNumber: r.blockNumber,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
          contentHash: r.contentHash,
          createdAt: r.createdAt?.toISOString() ?? null,
          signatureScheme: r.signatureScheme ?? null,
          signerAddress: r.signerAddress ?? null,
          expectedSignerAddress: r.expectedSignerAddress ?? null,
          signerRole: r.signerRole ?? null,
          signingDigest: r.signingDigest ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const anchorRes = await pool.query<{
          kind: number;
          anchorTxHash: string;
          blockNumber: string;
          blockTimestamp: Date | null;
        }>(
          `SELECT
            kind::int AS "kind",
            tx_hash AS "anchorTxHash",
            block_number::text AS "blockNumber",
            block_timestamp AS "blockTimestamp"
          FROM acta_anchors
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND snapshot_hash=$4
          ORDER BY block_number ASC, log_index ASC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const contentRes = await pool.query<ActMetaRow>(
          `SELECT
            act_type AS "actType",
            canonical_json AS "canonicalJson",
            signature AS "signature",
            signer_key_id AS "signerKeyId",
            signer_public_key AS "signerPublicKey",
            content_hash AS "contentHash",
            created_at AS "createdAt",
            verification_status AS "verificationStatus"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const anchor = anchorRes.rows[0] ?? null;
        const content = contentRes.rows[0] ?? null;

        if (!anchor && !content) {
          reply.status(404);
          return { ok: false, error: "act_not_found" };
        }

        const inferredActType = content?.actType ?? (anchor ? actTypeFromKind(anchor.kind) : "UNKNOWN");

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          actId,
          act: {
            actId,
            electionId,
            actType: inferredActType,
            canonicalJson: content?.canonicalJson ?? null,
            signature: content?.signature ?? null,
            signerKeyId: content?.signerKeyId ?? null,
            signerPublicKey: content?.signerPublicKey ?? null,
            contentHash: content?.contentHash ?? null,
            verificationStatus: content?.verificationStatus ?? null,
            anchorTxHash: anchor?.anchorTxHash ?? null,
            blockNumber: anchor?.blockNumber ?? null,
            blockTimestamp: anchor?.blockTimestamp?.toISOString() ?? null,
            createdAt: content?.createdAt?.toISOString() ?? null,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId/content",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const res = await pool.query<ActContentRow>(
          `SELECT
            signed_json AS "signedJson"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const row = res.rows[0] ?? null;
        if (!row) {
          reply.status(404);
          return { ok: false, error: "act_content_not_found" };
        }

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          actId,
          signedJson: row.signedJson,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId/verify",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const anchorRes = await pool.query<{ snapshotHash: string }>(
          `SELECT snapshot_hash AS "snapshotHash"
           FROM acta_anchors
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND snapshot_hash=$4
           LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );
        const anchorFoundOnChain = (anchorRes.rowCount ?? 0) > 0;

        const contentRes = await pool.query<{ 
          canonicalJson: unknown; 
          signedJson: unknown;
          signatureScheme: string;
          signerAddress: string;
          signingDigest: string;
          signerRole: string;
          expectedSignerAddress: string;
        }>(
          `SELECT
            canonical_json AS "canonicalJson",
            signed_json AS "signedJson",
            signature_scheme AS "signatureScheme",
            signer_address AS "signerAddress",
            signing_digest AS "signingDigest",
            signer_role AS "signerRole",
            expected_signer_address AS "expectedSignerAddress"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const content = contentRes.rows[0] ?? null;

        let signatureValid = false;
        let signatureScheme = null;
        let recoveredSignerAddress = null;
        let expectedSignerAddress = null;
        let expectedSignerRole = null;
        let signatureMatchesExpectedSigner = false;
        let contentHash = null;
        let signingDigest = null;
        let verifyError = null;
        let verifyErrorCode = null;
        
        let hashMatchesAnchor = false;
        let anchoredHash = actId;

        if (content && typeof content.signedJson === 'object' && content.signedJson !== null && 'signature' in content.signedJson) {
           const signedJsonObj = content.signedJson as any;
           signatureScheme = content.signatureScheme || signedJsonObj.signature?.signatureScheme || signedJsonObj.signature?.algorithm;
           expectedSignerAddress = content.expectedSignerAddress;
           expectedSignerRole = content.signerRole;
           
           if (signatureScheme === "ECDSA_SECP256K1_ETH_V1") {
             const verification = verifyActaECDSASignature(content.canonicalJson as any, signedJsonObj.signature, expectedSignerAddress);
             signatureValid = verification.signatureValid;
             recoveredSignerAddress = verification.recoveredSignerAddress;
             signatureMatchesExpectedSigner = verification.signerMatchesRole;
             contentHash = verification.contentHash;
             signingDigest = verification.signingDigest;
             if (!verification.ok) {
               verifyError = verification.error;
               verifyErrorCode = verification.errorCode;
             }
           } else {
              signatureValid = false;
              verifyError = "UNSUPPORTED_SCHEME";
              verifyErrorCode = "UNSUPPORTED_SCHEME";
           }

           hashMatchesAnchor = Boolean(
             anchorFoundOnChain && (contentHash === actId)
           );
           
           if (!hashMatchesAnchor && anchorFoundOnChain && !verifyErrorCode) {
              verifyErrorCode = "ANCHORED_HASH_MISMATCH";
              verifyError = "Hash de contenido no coincide con el anclado on-chain";
           } else if (!anchorFoundOnChain && !verifyErrorCode) {
              verifyErrorCode = "ANCHOR_MISSING";
              verifyError = "No se encontró anclaje on-chain";
           }
        } else if (!content) {
          verifyErrorCode = "INCOMPLETE_METADATA";
          verifyError = "Contenido no disponible en la base de datos";
        }

        const incidentsRes = await pool.query<{
          code: string;
          severity: string;
          message: string;
          details: unknown;
          relatedEntityType: string | null;
          relatedEntityId: string | null;
          evidencePointers: unknown;
          firstSeenAt: Date;
        }>(
          `SELECT
             code,
             severity,
             message,
             details,
             related_entity_type AS "relatedEntityType",
             related_entity_id AS "relatedEntityId",
             evidence_pointers AS "evidencePointers",
             first_seen_at AS "firstSeenAt"
           FROM incident_logs
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND fingerprint LIKE $4 AND active=true
           ORDER BY last_seen_at DESC
           LIMIT 50`,
          [chainId, contractAddress, electionId, `%:${actId}%`],
        );

        const severities = new Set(incidentsRes.rows.map((r) => String(r.severity ?? "")));
        const consistencyStatus = Array.from(severities.values()).some(isCriticalSeverity)
          ? "CRITICAL"
          : Array.from(severities.values()).some(isWarningSeverity)
            ? "WARNING"
            : "OK";

        // Old errorDetails block removed

        const verificationStatusResolved = verifyErrorCode === "INVALID_SIGNATURE" ? "INVALID_SIGNATURE" :
                                         verifyErrorCode === "SIGNER_ROLE_MISMATCH" ? "SIGNER_ROLE_MISMATCH" :
                                         verifyErrorCode === "CONTENT_HASH_MISMATCH" ? "CONTENT_HASH_MISMATCH" :
                                         verifyErrorCode === "ANCHORED_HASH_MISMATCH" ? "ANCHORED_HASH_MISMATCH" :
                                         verifyErrorCode === "ANCHOR_MISSING" ? "ANCHOR_MISSING" :
                                         verifyErrorCode === "INCOMPLETE_METADATA" ? "INCOMPLETE_METADATA" :
                                         verifyErrorCode === "UNSUPPORTED_SCHEME" ? "UNSUPPORTED_SCHEME" :
                                         "VALID";

        return {
          ok: true,
          electionId,
          actId,
          actType: content?.signedJson ? (content.signedJson as any).kind || "UNKNOWN" : "UNKNOWN",
          signerRole: expectedSignerRole,
          signatureScheme,
          signatureValid,
          recoveredSignerAddress,
          expectedSignerAddress,
          signerMatchesRole: signatureMatchesExpectedSigner,
          contentHash,
          signingDigest,
          anchoredHash,
          hashMatchesAnchor,
          anchorFoundOnChain,
          verificationStatus: verificationStatusResolved,
          consistencyStatus,
          warnings: incidentsRes.rows.filter(x => x.severity === "WARNING").map(x => x.message),
          errorDetails: verifyError || null,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/signups", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const orderRaw = String((req as any).query?.order ?? "").toLowerCase();
      const order = orderRaw === "asc" || orderRaw === "desc" ? (orderRaw as "asc" | "desc") : null;

      const limitRaw = (req as any).query?.limit;
      const parsedLimit = limitRaw === undefined ? null : Number(limitRaw);
      const limit = parsedLimit === null || Number.isNaN(parsedLimit)
        ? null
        : Math.max(1, Math.min(200, parsedLimit));

      const cursorRaw = (req as any).query?.cursor;
      const cursor = cursorRaw ? parseSignupsCursor(String(cursorRaw)) : null;

      const usePagination = Boolean(limit !== null || order !== null || cursor !== null);
      const effectiveOrder: "asc" | "desc" = order ?? (usePagination ? "desc" : "asc");
      const effectiveLimit = usePagination ? (limit ?? 50) : null;
      const fetchLimit = effectiveLimit ? effectiveLimit + 1 : null;

      const args: Array<string | number> = [chainId, contractAddress, electionId];

      let cursorSql = "";
      if (cursor) {
        const blockParam = args.length + 1;
        args.push(cursor.blockNumber);
        const logParam = args.length + 1;
        args.push(cursor.logIndex);
        cursorSql =
          effectiveOrder === "asc"
            ? `AND (s.block_number, s.log_index) > ($${blockParam}::bigint, $${logParam}::int)`
            : `AND (s.block_number, s.log_index) < ($${blockParam}::bigint, $${logParam}::int)`;
      }

      let limitSql = "";
      if (fetchLimit) {
        args.push(fetchLimit);
        limitSql = `LIMIT $${args.length}`;
      }

      const orderSql =
        effectiveOrder === "asc"
          ? "ORDER BY s.block_number ASC, s.log_index ASC"
          : "ORDER BY s.block_number DESC, s.log_index DESC";

      const res = await pool.query<SignupWithPermitRow>(
        `SELECT
          s.registry_nullifier AS "registryNullifier",
          s.voting_pub_key AS "votingPubKey",
          s.block_number::text AS "blockNumber",
          s.block_timestamp AS "blockTimestamp",
          s.tx_hash AS "txHash",
          s.log_index::int AS "logIndex",
          p.credential_id AS "permitCredentialId",
          p.issuer_address AS "permitIssuerAddress",
          p.permit_sig AS "permitSig",
          p.issued_at AS "permitIssuedAt",
          p.recorded_at AS "permitRecordedAt"
        FROM signup_records s
        LEFT JOIN rea_signup_permits p
          ON p.chain_id=s.chain_id
          AND p.contract_address=s.contract_address
          AND p.election_id=s.election_id
          AND p.registry_nullifier=s.registry_nullifier
        WHERE s.chain_id=$1 AND s.contract_address=$2 AND s.election_id=$3
        ${cursorSql}
        ${orderSql}
        ${limitSql}`,
        args,
      );

      const expectedRegistryAuthority = String(election.registryAuthority ?? "").toLowerCase();

      let rows = res.rows;
      let hasMore = false;
      if (effectiveLimit && rows.length > effectiveLimit) {
        hasMore = true;
        rows = rows.slice(0, effectiveLimit);
      }

      const nextCursor =
        hasMore && rows.length > 0
          ? formatSignupsCursor({
              blockNumber: rows[rows.length - 1]!.blockNumber,
              logIndex: rows[rows.length - 1]!.logIndex,
            })
          : null;

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        page: usePagination
          ? { limit: effectiveLimit, order: effectiveOrder, nextCursor }
          : null,
        signups: rows.map((r) => {
          const permit = r.permitSig
            ? {
                credentialId: r.permitCredentialId,
                issuerAddress: r.permitIssuerAddress,
                permitSig: r.permitSig,
                issuedAt: r.permitIssuedAt?.toISOString() ?? null,
                recordedAt: r.permitRecordedAt?.toISOString() ?? null,
              }
            : null;

          if (!permit || !permit.permitSig || !permit.issuerAddress) {
            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: { status: "UNVERIFIED", reason: "missing_permit_log", recoveredIssuerAddress: null },
            };
          }

          const digest = computeSignupDigest({
            electionId,
            registryNullifier: r.registryNullifier,
          });

          const declaredIssuer = String(permit.issuerAddress).toLowerCase();
          try {
            const recovered = ethers
              .verifyMessage(ethers.getBytes(digest), String(permit.permitSig))
              .toLowerCase();

            if (recovered !== declaredIssuer) {
              return {
                registryNullifier: r.registryNullifier,
                votingPubKey: r.votingPubKey,
                blockNumber: r.blockNumber,
                blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
                txHash: r.txHash,
                logIndex: r.logIndex,
                permit,
                validity: {
                  status: "INVALID",
                  reason: "issuer_address_field_mismatch",
                  recoveredIssuerAddress: recovered,
                },
              };
            }

            if (expectedRegistryAuthority && recovered !== expectedRegistryAuthority) {
              return {
                registryNullifier: r.registryNullifier,
                votingPubKey: r.votingPubKey,
                blockNumber: r.blockNumber,
                blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
                txHash: r.txHash,
                logIndex: r.logIndex,
                permit,
                validity: {
                  status: "INVALID",
                  reason: "not_signed_by_registry_authority",
                  recoveredIssuerAddress: recovered,
                },
              };
            }

            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: { status: "VALID", reason: null, recoveredIssuerAddress: recovered },
            };
          } catch (err: unknown) {
            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: {
                status: "INVALID",
                reason: "signature_parse_error",
                recoveredIssuerAddress: null,
                error: (err as Error).message,
              },
            };
          }
        }),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/signups/summary",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{ total: number; unique_nullifiers: number }>(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT registry_nullifier)::int AS unique_nullifiers
          FROM signup_records
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        );

        const row = res.rows[0] ?? { total: 0, unique_nullifiers: 0 };
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          summary: {
            total: row.total,
            uniqueNullifiers: row.unique_nullifiers,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; txHash: string; logIndex: string } }>(
    "/v1/elections/:id/signups/:txHash/:logIndex",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const txHash = requireTxHash(req.params.txHash);
        const logIndex = requireLogIndex(req.params.logIndex);

        const res = await pool.query<SignupWithPermitRow>(
          `SELECT
            s.registry_nullifier AS "registryNullifier",
            s.voting_pub_key AS "votingPubKey",
            s.block_number::text AS "blockNumber",
            s.block_timestamp AS "blockTimestamp",
            s.tx_hash AS "txHash",
            s.log_index::int AS "logIndex",
            p.credential_id AS "permitCredentialId",
            p.issuer_address AS "permitIssuerAddress",
            p.permit_sig AS "permitSig",
            p.issued_at AS "permitIssuedAt",
            p.recorded_at AS "permitRecordedAt"
          FROM signup_records s
          LEFT JOIN rea_signup_permits p
            ON p.chain_id=s.chain_id
            AND p.contract_address=s.contract_address
            AND p.election_id=s.election_id
            AND p.registry_nullifier=s.registry_nullifier
          WHERE s.chain_id=$1 AND s.contract_address=$2 AND s.election_id=$3
            AND s.tx_hash=$4 AND s.log_index=$5
          LIMIT 1`,
          [chainId, contractAddress, electionId, txHash, logIndex],
        );

        const row = res.rows[0];
        if (!row) {
          reply.status(404);
          return { ok: false, error: "signup_not_found" };
        }

        const expectedRegistryAuthority = String(election.registryAuthority ?? "").toLowerCase();

        const permit = row.permitSig
          ? {
              credentialId: row.permitCredentialId,
              issuerAddress: row.permitIssuerAddress,
              permitSig: row.permitSig,
              issuedAt: row.permitIssuedAt?.toISOString() ?? null,
              recordedAt: row.permitRecordedAt?.toISOString() ?? null,
            }
          : null;

        if (!permit || !permit.permitSig || !permit.issuerAddress) {
          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity: { status: "UNVERIFIED", reason: "missing_permit_log", recoveredIssuerAddress: null },
            },
          };
        }

        const digest = computeSignupDigest({
          electionId,
          registryNullifier: row.registryNullifier,
        });

        const declaredIssuer = String(permit.issuerAddress).toLowerCase();
        try {
          const recovered = ethers
            .verifyMessage(ethers.getBytes(digest), String(permit.permitSig))
            .toLowerCase();

          const validity =
            recovered !== declaredIssuer
              ? {
                  status: "INVALID",
                  reason: "issuer_address_field_mismatch",
                  recoveredIssuerAddress: recovered,
                }
              : expectedRegistryAuthority && recovered !== expectedRegistryAuthority
                ? {
                    status: "INVALID",
                    reason: "not_signed_by_registry_authority",
                    recoveredIssuerAddress: recovered,
                  }
                : { status: "VALID", reason: null, recoveredIssuerAddress: recovered };

          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity,
            },
          };
        } catch (err: unknown) {
          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity: {
                status: "INVALID",
                reason: "signature_parse_error",
                recoveredIssuerAddress: null,
                error: (err as Error).message,
              },
            },
          };
        }
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/ballots", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<BallotRow>(
        `SELECT
          ballot_index::text AS "ballotIndex",
          ballot_hash AS "ballotHash",
          ciphertext AS "ciphertext",
          block_number::text AS "blockNumber",
          block_timestamp AS "blockTimestamp",
          tx_hash AS "txHash",
          log_index::int AS "logIndex"
        FROM ballot_records
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY block_number ASC, log_index ASC`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        ballots: res.rows.map((r) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/ballots/summary",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{ total: number; unique_indexes: number }>(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT ballot_index)::int AS unique_indexes
          FROM ballot_records
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        );

        const row = res.rows[0] ?? { total: 0, unique_indexes: 0 };
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          summary: {
            total: row.total,
            uniqueBallotIndexes: row.unique_indexes,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/tally",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{
          proof_hash: string;
          proof_payload: string;
          tx_hash: string;
          block_timestamp: Date | null;
        }>(
          `SELECT
            proof_hash,
            proof_payload,
            tx_hash,
            block_timestamp
          FROM tally_proofs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY block_number DESC, log_index DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId],
        );

        const proof = res.rows[0] ?? null;

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          proof: proof ? {
            proofHash: proof.proof_hash,
            proofPayload: proof.proof_payload,
            txHash: proof.tx_hash,
            blockTimestamp: proof.block_timestamp?.toISOString() ?? null,
          } : null,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/processing/batches",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query(
          `SELECT
            batch_id AS "batchId",
            batch_index AS "batchIndex",
            input_count AS "inputCount",
            status AS "status",
            error_message AS "errorMessage",
            related_root AS "relatedRoot",
            created_at AS "createdAt",
            started_at AS "startedAt",
            completed_at AS "completedAt"
          FROM processing_batches
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY batch_index ASC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          batches: res.rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString(), startedAt: r.startedAt?.toISOString(), completedAt: r.completedAt?.toISOString() })),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/tally/jobs",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query(
          `SELECT
            tally_job_id AS "tallyJobId",
            based_on_batch_set AS "basedOnBatchSet",
            status AS "status",
            proof_state AS "proofState",
            result_summary AS "resultSummary",
            tally_commitment AS "tallyCommitment",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            completed_at AS "completedAt"
          FROM tally_jobs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          jobs: res.rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString(), completedAt: r.completedAt?.toISOString() })),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/consistency",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<ConsistencyRunRow>(
          `SELECT
            run_id::text AS "runId",
            data_version AS "dataVersion",
            computed_at AS "computedAt",
            ok AS "ok",
            report AS "report"
          FROM consistency_report_runs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY computed_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId],
        );

        const run = res.rows[0] ?? null;
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          consistency: run
            ? {
                runId: run.runId,
                dataVersion: run.dataVersion,
                computedAt: run.computedAt.toISOString(),
                ok: run.ok,
                report: run.report,
              }
            : null,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/incidents", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<IncidentRow>(
        `SELECT
          fingerprint,
          code,
          severity,
          message,
          details,
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          occurrences::text AS "occurrences",
          related_tx_hash AS "relatedTxHash",
          related_block_number::text AS "relatedBlockNumber",
          related_block_timestamp AS "relatedBlockTimestamp",
          related_entity_type AS "relatedEntityType",
          related_entity_id AS "relatedEntityId",
          evidence_pointers AS "evidencePointers",
          active AS "active",
          resolved_at AS "resolvedAt"
        FROM incident_logs
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY active DESC, last_seen_at DESC
        LIMIT 200`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        incidents: res.rows.map((r) => ({
          ...r,
          firstSeenAt: r.firstSeenAt.toISOString(),
          detectedAt: r.firstSeenAt.toISOString(),
          lastSeenAt: r.lastSeenAt.toISOString(),
          relatedBlockTimestamp: r.relatedBlockTimestamp?.toISOString() ?? null,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/enrollment", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const [requestsRes, authorizationsRes, requestCountsRes] = await Promise.all([
        pool.query<ElectionEnrollmentRequestRow>(
          `SELECT
            r.request_id AS "requestId",
            r.dni,
            r.status,
            r.requested_wallet_address AS "requestedWalletAddress",
            r.request_channel AS "requestChannel",
            r.request_notes AS "requestNotes",
            r.metadata_json AS "metadataJson",
            r.reviewed_by AS "reviewedBy",
            r.review_notes AS "reviewNotes",
            r.requested_at AS "requestedAt",
            r.reviewed_at AS "reviewedAt",
            v.full_name AS "fullName"
          FROM hn_enrollment_requests r
          LEFT JOIN hn_voter_registry v ON v.dni=r.dni
          WHERE COALESCE(r.metadata_json->>'electionId', '') = $1
            AND (
              (COALESCE(r.metadata_json->>'chainId', '') = '' AND COALESCE(r.metadata_json->>'contractAddress', '') = '')
              OR (
                COALESCE(r.metadata_json->>'chainId', '') = $2
                AND LOWER(COALESCE(r.metadata_json->>'contractAddress', '')) = LOWER($3)
              )
            )
          ORDER BY r.requested_at DESC
          LIMIT 100`,
          [electionId, chainId, contractAddress],
        ),
        pool.query<ElectionAuthorizationRow>(
          `SELECT
            a.authorization_id AS "authorizationId",
            a.chain_id AS "chainId",
            a.contract_address AS "contractAddress",
            a.election_id::text AS "electionId",
            a.dni,
            a.wallet_address AS "walletAddress",
            a.enrollment_request_id AS "enrollmentRequestId",
            a.status,
            a.authorized_by AS "authorizedBy",
            a.authorization_notes AS "authorizationNotes",
            a.metadata_json AS "metadataJson",
            a.authorized_at AS "authorizedAt",
            a.revoked_at AS "revokedAt",
            a.created_at AS "createdAt",
            v.full_name AS "fullName",
            w.verification_method AS "verificationMethod",
            w.link_status AS "walletLinkStatus"
          FROM hn_voter_authorizations a
          LEFT JOIN hn_voter_registry v ON v.dni=a.dni
          LEFT JOIN hn_wallet_links w ON w.dni=a.dni AND w.wallet_address=a.wallet_address
          WHERE a.chain_id=$1 AND a.contract_address=$2 AND a.election_id=$3
          ORDER BY a.authorized_at DESC, a.created_at DESC
          LIMIT 100`,
          [chainId, contractAddress, electionId],
        ),
        pool.query<{
          totalRequests: number;
          pendingReview: number;
          approvedRequests: number;
          rejectedRequests: number;
        }>(
          `SELECT
            COUNT(*)::int AS "totalRequests",
            COUNT(*) FILTER (WHERE status='PENDING_REVIEW')::int AS "pendingReview",
            COUNT(*) FILTER (WHERE status='APPROVED')::int AS "approvedRequests",
            COUNT(*) FILTER (WHERE status='REJECTED')::int AS "rejectedRequests"
          FROM hn_enrollment_requests
          WHERE COALESCE(metadata_json->>'electionId', '') = $1
            AND (
              (COALESCE(metadata_json->>'chainId', '') = '' AND COALESCE(metadata_json->>'contractAddress', '') = '')
              OR (
                COALESCE(metadata_json->>'chainId', '') = $2
                AND LOWER(COALESCE(metadata_json->>'contractAddress', '')) = LOWER($3)
              )
            )`,
          [electionId, chainId, contractAddress],
        ),
      ]);

      const activeAuthorizations = authorizationsRes.rows.filter(
        (row) => String(row.status).toUpperCase() === "AUTHORIZED" && !row.revokedAt,
      );
      const activeWalletCoverage = activeAuthorizations.filter(
        (row) =>
          String(row.walletLinkStatus ?? "").toUpperCase() === "ACTIVE" &&
          typeof row.walletAddress === "string" &&
          row.walletAddress.length > 0,
      ).length;

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        summary: {
          totalRequests: requestCountsRes.rows[0]?.totalRequests ?? 0,
          pendingReview: requestCountsRes.rows[0]?.pendingReview ?? 0,
          approvedRequests: requestCountsRes.rows[0]?.approvedRequests ?? 0,
          rejectedRequests: requestCountsRes.rows[0]?.rejectedRequests ?? 0,
          totalAuthorizations: authorizationsRes.rows.length,
          activeAuthorizations: activeAuthorizations.length,
          activeWalletCoverage,
        },
        requests: requestsRes.rows.map(normalizeElectionEnrollmentRequest),
        authorizations: authorizationsRes.rows.map(normalizeElectionAuthorization),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/results", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const [candidates, resultsRes, summaryItemsRes] = await Promise.all([
        listElectionCandidates(electionId),
        pool.query<ResultPayloadRow>(
          `SELECT
            id,
            tally_job_id AS "tallyJobId",
            result_kind AS "resultKind",
            payload_json AS "payloadJson",
            payload_hash AS "payloadHash",
            publication_status AS "publicationStatus",
            proof_state AS "proofState",
            created_at AS "createdAt",
            published_at AS "publishedAt"
          FROM result_payloads
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
            AND ${verifiedResultPayloadWhereClause()}
          ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        ),
        pool.query<ResultSummaryItemRow>(
          `SELECT
            result_payload_id AS "resultId",
            candidate_id AS "candidateId",
            candidate_code AS "candidateCode",
            display_name AS "displayName",
            party_name AS "partyName",
            votes::int AS "votes",
            NULL::int AS "rank",
            NULL::text AS "unresolvedLabel"
          FROM result_summary_items
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY result_payload_id ASC, votes DESC, display_name ASC`,
          [chainId, contractAddress, electionId],
        ),
      ]);

      const summaryItemsByResult = new Map<string, ResultSummaryItemRow[]>();
      for (const item of summaryItemsRes.rows) {
        const list = summaryItemsByResult.get(item.resultId) ?? [];
        list.push(item);
        summaryItemsByResult.set(item.resultId, list);
      }

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        candidates,
        results: resultsRes.rows.map((r) => {
          const storedSummaryRows = summaryItemsByResult.get(r.id) ?? [];
          const summary = storedSummaryRows.length
            ? resolveStoredResultSummary({ rows: storedSummaryRows, candidates })
            : resolveResultSummary({ payloadJson: r.payloadJson, candidates });

          return {
            ...r,
            resultMode: mapProofStateToResultMode(r.proofState),
            honestyNote: honestyNoteForProofState(r.proofState),
            createdAt: r.createdAt.toISOString(),
            publishedAt: r.publishedAt?.toISOString() ?? null,
            summaryItems: summary.items,
            hasUnresolvedCandidateLabels: summary.hasUnresolvedLabels,
            unresolvedCandidateLabels: summary.unresolvedLabels,
          };
        }),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/audit-window", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query(
        `SELECT
          id,
          status,
          opened_at AS "openedAt",
          closes_at AS "closesAt",
          opened_by AS "openedBy",
          notes,
          created_at AS "createdAt"
        FROM audit_windows
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        LIMIT 1`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        auditWindow: res.rows.length ? {
          ...res.rows[0],
          openedAt: res.rows[0].openedAt?.toISOString() ?? null,
          closesAt: res.rows[0].closesAt?.toISOString() ?? null,
          createdAt: res.rows[0].createdAt.toISOString(),
        } : null,
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  // ── Result detail ──────────────────────────────────────────────────
  app.get<{ Params: { id: string; resultId: string } }>(
    "/v1/elections/:id/results/:resultId",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }
        const resultId = String(req.params.resultId);

        const [candidates, resultRes, summaryItemsRes] = await Promise.all([
          listElectionCandidates(electionId),
          pool.query<ResultPayloadRow>(
            `SELECT
              id,
              tally_job_id AS "tallyJobId",
              result_kind AS "resultKind",
              payload_json AS "payloadJson",
              payload_hash AS "payloadHash",
              publication_status AS "publicationStatus",
              proof_state AS "proofState",
              created_at AS "createdAt",
              published_at AS "publishedAt"
            FROM result_payloads
            WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND id=$4
              AND ${verifiedResultPayloadWhereClause()}
            LIMIT 1`,
            [chainId, contractAddress, electionId, resultId],
          ),
          pool.query<ResultSummaryItemRow>(
            `SELECT
              result_payload_id AS "resultId",
              candidate_id AS "candidateId",
              candidate_code AS "candidateCode",
              display_name AS "displayName",
              party_name AS "partyName",
              votes::int AS "votes",
              NULL::int AS "rank",
              NULL::text AS "unresolvedLabel"
            FROM result_summary_items
            WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND result_payload_id=$4
            ORDER BY votes DESC, display_name ASC`,
            [chainId, contractAddress, electionId, resultId],
          ),
        ]);

        if (resultRes.rows.length === 0) {
          reply.status(404);
          return { ok: false, error: "result_not_found" };
        }

        const r = resultRes.rows[0]!;
        const summary = summaryItemsRes.rows.length
          ? resolveStoredResultSummary({ rows: summaryItemsRes.rows, candidates })
          : resolveResultSummary({ payloadJson: r.payloadJson, candidates });

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          candidates,
          result: {
            ...r,
            resultMode: mapProofStateToResultMode(r.proofState),
            honestyNote: honestyNoteForProofState(r.proofState),
            createdAt: r.createdAt.toISOString(),
            publishedAt: r.publishedAt?.toISOString() ?? null,
            summaryItems: summary.items,
            hasUnresolvedCandidateLabels: summary.hasUnresolvedLabels,
            unresolvedCandidateLabels: summary.unresolvedLabels,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // ── Audit Bundle ───────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/v1/elections/:id/audit-bundle", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      // Collect all evidence in one shot
      const [
        batchesRes, jobsRes, resultsRes, actsRes, anchorsRes,
        auditWindowRes, bundleExportRes, ballotsCountRes, incidentsRes,
      ] = await Promise.all([
        pool.query(
          `SELECT batch_id AS "batchId", batch_index AS "batchIndex", input_count AS "inputCount", status, related_root AS "relatedRoot", created_at AS "createdAt", completed_at AS "completedAt"
           FROM processing_batches WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY batch_index`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT tally_job_id AS "tallyJobId", based_on_batch_set AS "basedOnBatchSet", status, proof_state AS "proofState", result_summary AS "resultSummary", tally_commitment AS "tallyCommitment", created_at AS "createdAt", completed_at AS "completedAt"
           FROM tally_jobs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, tally_job_id AS "tallyJobId", result_kind AS "resultKind", payload_hash AS "payloadHash", proof_state AS "proofState", publication_status AS "publicationStatus", created_at AS "createdAt", published_at AS "publishedAt"
           FROM result_payloads
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
             AND ${verifiedResultPayloadWhereClause()}
           ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT act_id AS "actId", act_type AS "actType", content_hash AS "contentHash", verification_status AS "verificationStatus", signature_scheme AS "signatureScheme", signer_address AS "signerAddress", expected_signer_address AS "expectedSignerAddress", signer_role AS "signerRole", signing_digest AS "signingDigest", created_at AS "createdAt"
           FROM acta_contents WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT kind, snapshot_hash AS "snapshotHash", tx_hash AS "txHash", block_number AS "blockNumber", block_timestamp AS "blockTimestamp"
           FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY block_number`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, status, opened_at AS "openedAt", closes_at AS "closesAt", opened_by AS "openedBy", notes, created_at AS "createdAt"
           FROM audit_windows WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 LIMIT 1`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, bundle_hash AS "bundleHash", bundle_manifest_json AS "bundleManifest", export_status AS "exportStatus", created_at AS "createdAt"
           FROM audit_bundle_exports WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC LIMIT 1`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS c FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT fingerprint, code, severity, message, active, occurrences, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
           FROM incident_logs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY last_seen_at DESC LIMIT 50`,
          [chainId, contractAddress, electionId],
        ),
      ]);

      const bundleExport = bundleExportRes.rows[0] ?? null;

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        generatedAt: new Date().toISOString(),
        bundleHash: bundleExport?.bundleHash ?? null,
        bundleManifest: bundleExport?.bundleManifest ?? null,
        exportStatus: bundleExport?.exportStatus ?? "NOT_MATERIALIZED",
        election: {
          manifestHash: election.manifestHash,
          authority: election.authority,
          registryAuthority: election.registryAuthority,
          phase: election.phase,
        },
        ballotsSummary: { total: ballotsCountRes.rows[0]?.c ?? 0 },
        processingBatches: batchesRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
        tallyJobs: jobsRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
        resultPayloads: resultsRes.rows.map((r: any) => ({
          ...r,
          resultMode: mapProofStateToResultMode(r.proofState),
          createdAt: r.createdAt?.toISOString() ?? null,
          publishedAt: r.publishedAt?.toISOString() ?? null,
        })),
        actas: actsRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
        anchors: anchorsRes.rows.map((r: any) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
        auditWindow: auditWindowRes.rows[0] ? {
          ...auditWindowRes.rows[0],
          openedAt: auditWindowRes.rows[0].openedAt?.toISOString() ?? null,
          closesAt: auditWindowRes.rows[0].closesAt?.toISOString() ?? null,
          createdAt: auditWindowRes.rows[0].createdAt?.toISOString() ?? null,
        } : null,
        incidents: incidentsRes.rows.map((r: any) => ({
          ...r,
          firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        })),
        honesty: (() => {
          const latestProofState = String(resultsRes.rows[0]?.proofState ?? "NOT_IMPLEMENTED");
          return {
            resultMode: mapProofStateToResultMode(latestProofState),
            proofState: latestProofState,
            note: honestyNoteForProofState(latestProofState),
          };
        })(),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });
  // --- Phase 9A: ZK Proof Status ---
  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/zk-proof",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const res = await pool.query<{
          jobId: string;
          tallyJobId: string;
          proofSystem: string;
          circuitId: string;
          status: string;
          merkleRootKeccak: string | null;
          merkleRootPoseidon: string | null;
          merkleInclusionVerified: boolean;
          publicInputs: object;
          verificationKeyHash: string;
          verifiedOffchain: boolean;
          verifiedOnchain: boolean;
          onchainVerifierAddress: string;
          onchainVerificationTx: string;
          errorMessage: string;
          provingStartedAt: Date;
          provingCompletedAt: Date;
          createdAt: Date;
        }>(
          `SELECT
            job_id AS "jobId",
            tally_job_id AS "tallyJobId",
            proof_system AS "proofSystem",
            circuit_id AS "circuitId",
            status,
            merkle_root_keccak AS "merkleRootKeccak",
            merkle_root_poseidon AS "merkleRootPoseidon",
            merkle_inclusion_verified AS "merkleInclusionVerified",
            public_inputs AS "publicInputs",
            verification_key_hash AS "verificationKeyHash",
            verified_offchain AS "verifiedOffchain",
            verified_onchain AS "verifiedOnchain",
            onchain_verifier_address AS "onchainVerifierAddress",
            onchain_verification_tx AS "onchainVerificationTx",
            error_message AS "errorMessage",
            proving_started_at AS "provingStartedAt",
            proving_completed_at AS "provingCompletedAt",
            created_at AS "createdAt"
          FROM zk_proof_jobs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND circuit_id=$4
          ${zkProofJobPriorityOrderSql()}
          LIMIT 1`,
          [chainId, contractAddress, electionId.toString(), "TallyVerifier_4x64"],
        );

        const decryptionRes = await pool.query<{
          jobId: string;
          tallyJobId: string;
          proofSystem: string;
          circuitId: string;
          status: string;
          verificationKeyHash: string;
          verifiedOffchain: boolean;
          verifiedOnchain: boolean;
          errorMessage: string;
          provingStartedAt: Date;
          provingCompletedAt: Date;
          createdAt: Date;
        }>(
          `SELECT
            job_id AS "jobId",
            tally_job_id AS "tallyJobId",
            proof_system AS "proofSystem",
            circuit_id AS "circuitId",
            status,
            verification_key_hash AS "verificationKeyHash",
            verified_offchain AS "verifiedOffchain",
            verified_onchain AS "verifiedOnchain",
            error_message AS "errorMessage",
            proving_started_at AS "provingStartedAt",
            proving_completed_at AS "provingCompletedAt",
            created_at AS "createdAt"
          FROM zk_proof_jobs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND circuit_id=$4
          ${zkProofJobPriorityOrderSql()}
          LIMIT 1`,
          [chainId, contractAddress, electionId.toString(), "DecryptionVerifier_4x64"],
        );

        const job = res.rows[0] ?? null;
        const decryptionJob = decryptionRes.rows[0] ?? null;

        return {
          ok: true,
          electionId: electionId.toString(),
          zkProof: job
            ? {
                jobId: job.jobId,
                tallyJobId: job.tallyJobId,
                proofSystem: job.proofSystem,
                circuitId: job.circuitId,
                status: job.status,
                merkleRootKeccak: job.merkleRootKeccak,
                merkleRootPoseidon: job.merkleRootPoseidon,
                merkleInclusionVerified: job.merkleInclusionVerified,
                publicInputs: job.publicInputs,
                verificationKeyHash: job.verificationKeyHash,
                verifiedOffchain: job.verifiedOffchain,
                verifiedOnchain: job.verifiedOnchain,
                onchainVerifierAddress: job.onchainVerifierAddress,
                onchainVerificationTx: job.onchainVerificationTx,
                errorMessage: job.errorMessage,
                provingStartedAt: job.provingStartedAt?.toISOString(),
                provingCompletedAt: job.provingCompletedAt?.toISOString(),
                createdAt: job.createdAt?.toISOString(),
              }
            : null,
          decryptionProof: decryptionJob
            ? {
                jobId: decryptionJob.jobId,
                tallyJobId: decryptionJob.tallyJobId,
                proofSystem: decryptionJob.proofSystem,
                circuitId: decryptionJob.circuitId,
                status: decryptionJob.status,
                verificationKeyHash: decryptionJob.verificationKeyHash,
                verifiedOffchain: decryptionJob.verifiedOffchain,
                verifiedOnchain: decryptionJob.verifiedOnchain,
                errorMessage: decryptionJob.errorMessage,
                provingStartedAt: decryptionJob.provingStartedAt?.toISOString(),
                provingCompletedAt: decryptionJob.provingCompletedAt?.toISOString(),
                createdAt: decryptionJob.createdAt?.toISOString(),
              }
            : null,
          honesty: {
            whatIsProved: job?.status === "VERIFIED_OFFCHAIN"
              ? "Los conteos publicados son la suma correcta de selecciones individuales y la inclusión de boletas en el árbol Merkle Poseidon (ZK verificada fuera de cadena)"
              : job?.status === "VERIFIED_ONCHAIN"
                ? "Los conteos publicados son la suma correcta de selecciones individuales y la inclusión de boletas en el árbol Merkle Poseidon (ZK verificada en cadena)"
                : "Aún no se completó el paquete ZK obligatorio de tally y descifrado.",
            whatIsNotProved: [
              ...(job?.merkleInclusionVerified ? [] : ["Inclusión de boletas en árbol Merkle"]),
              ...(decryptionJob?.status === "VERIFIED_ONCHAIN"
                ? []
                : ["Descifrado correcto de ciphertexts (proof on-chain de descifrado pendiente)"]),
              ...(job?.verifiedOnchain ? [] : ["Verificación en cadena"]),
            ],
            auditabilityNote: "La publicación final solo es válida cuando tally y descifrado quedan verificados en cadena.",
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
