import { etiquetaEstado, etiquetaCanalSolicitud, etiquetaMetodoBilletera } from "@blockurna/shared";

/* ─── Type definitions ─── */

export type ElectionsApiResponse = {
  ok: boolean;
  chainId: string;
  contractAddress: string;
  elections: Array<{
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel?: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
    counts: { signups: number; ballots: number };
  }>;
};

export type PhaseChangesResponse = {
  ok: boolean;
  phaseChanges: Array<{
    txHash: string; logIndex: number; blockNumber: string; blockTimestamp: string | null;
    previousPhase: number; newPhase: number; previousPhaseLabel: string; newPhaseLabel: string;
  }>;
};

export type ActsResponse = {
  ok: boolean;
  acts: Array<{
    actId: string; actType: string; anchorTxHash: string; blockNumber: string;
    blockTimestamp: string | null; contentHash: string | null; createdAt: string | null;
    verificationStatus?: string | null; signatureScheme?: string | null;
    signerAddress?: string | null; signerRole?: string | null;
    signingDigest?: string | null; expectedSignerAddress?: string | null;
  }>;
};

export type AnchorsResponse = {
  ok: boolean;
  anchors: Array<{
    kind: number; snapshotHash: string; blockNumber: string;
    blockTimestamp: string | null; txHash: string; logIndex: number;
  }>;
};

export type SignupsSummaryResponse = { ok: boolean; summary: { total: number; uniqueNullifiers: number } };
export type BallotsSummaryResponse = { ok: boolean; summary: { total: number; uniqueBallotIndexes: number } };

export type BallotsResponse = {
  ok: boolean;
  ballots: Array<{
    ballotIndex: string; ballotHash: string; ciphertext: string;
    blockNumber: string; blockTimestamp: string | null; txHash: string; logIndex: number;
  }>;
};

export type ConsistencyResponse = {
  ok: boolean;
  consistency: null | { runId: string; dataVersion: string; computedAt: string; ok: boolean; report: any };
};

export type IncidentsResponse = {
  ok: boolean;
  incidents: Array<{
    fingerprint: string; code: string; severity: string; message: string;
    details: any; relatedEntityType?: string | null; relatedEntityId?: string | null;
    evidencePointers?: any; firstSeenAt: string; detectedAt?: string; lastSeenAt: string;
    occurrences: string; relatedTxHash: string | null; relatedBlockNumber: string | null;
    relatedBlockTimestamp: string | null; active?: boolean; resolvedAt?: string | null;
  }>;
};

export type ResultsResponse = {
  ok: boolean;
  candidates?: CandidateCatalogItem[];
  results: Array<{
    id: string; tallyJobId: string; resultKind: string; payloadJson: any; payloadHash: string;
    publicationStatus: string; proofState: string; resultMode: string; honestyNote?: string;
    summaryItems?: Array<{
      candidateId: string | null; candidateCode: string | null; displayName: string;
      partyName: string | null; votes: number; rank?: number | null;
      status?: string | null; unresolvedLabel?: string | null;
    }>;
    hasUnresolvedCandidateLabels?: boolean; unresolvedCandidateLabels?: string[];
    createdAt: string; publishedAt: string | null;
  }>;
};

export type CandidateCatalogItem = {
  id: string; candidateCode: string; displayName: string; shortName: string;
  partyName: string; ballotOrder: number; status: string; colorHex: string | null;
};

export type CandidatesResponse = { ok: boolean; candidates: CandidateCatalogItem[] };

export type ManifestResponse = {
  ok: boolean; source?: string;
  manifest?: { manifestHash: string; manifestJson?: any; generatedAt?: string | null; updatedAt?: string | null; schemaVersion?: string };
};

export type AuditWindowResponse = {
  ok: boolean;
  auditWindow: null | { id: string; status: string; openedAt: string | null; closesAt: string | null; openedBy: string; notes: string; createdAt: string };
};

export type AuditBundleResponse = { ok: boolean; bundleHash: string | null; exportStatus: string };

export type ZkProofResponse = {
  ok: boolean; electionId: string;
  zkProof: null | {
    jobId: string; tallyJobId: string; proofSystem: string; circuitId: string; status: string;
    merkleRootKeccak: string | null; merkleRootPoseidon: string | null; merkleInclusionVerified: boolean;
    publicInputs: { signals?: string[]; candidateOrder?: string[] } | null;
    verificationKeyHash: string | null; verifiedOffchain: boolean; verifiedOnchain: boolean;
    onchainVerifierAddress: string | null; onchainVerificationTx: string | null;
    errorMessage: string | null; provingStartedAt: string | null; provingCompletedAt: string | null;
    createdAt: string | null;
  };
  decryptionProof?: null | {
    jobId: string; tallyJobId: string; proofSystem: string; circuitId: string; status: string;
    verificationKeyHash: string | null; verifiedOffchain: boolean; verifiedOnchain: boolean;
    errorMessage: string | null; provingStartedAt: string | null; provingCompletedAt: string | null;
    createdAt: string | null;
  };
  honesty: { whatIsProved: string; whatIsNotProved: string[]; auditabilityNote: string };
};

export type ElectionEnrollmentResponse = {
  ok: boolean;
  summary: {
    totalRequests: number; pendingReview: number; approvedRequests: number; rejectedRequests: number;
    totalAuthorizations: number; activeAuthorizations: number; activeWalletCoverage: number;
  };
  requests: Array<{
    requestId: string; dni: string; fullName: string | null; status: string;
    requestedAt: string; reviewedAt: string | null; requestChannel: string;
  }>;
  authorizations: Array<{
    authorizationId: string; dni: string; fullName: string | null; electionId: string;
    walletAddress: string; status: string; verificationMethod: string | null;
    walletLinkStatus: string | null; authorizedAt: string;
  }>;
};

/* ─── Helpers ─── */

export function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

export function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

export function normalizeSeverityLabel(severity: string): string {
  const s = String(severity ?? "").toUpperCase();
  if (s === "ERROR") return "CRITICAL";
  if (s === "WARN") return "WARNING";
  return s.length > 0 ? s : "DESCONOCIDO";
}

export function severityBadgeClass(severity: string): string {
  if (isCriticalSeverity(severity)) return "badge badge-critical";
  if (isWarningSeverity(severity)) return "badge badge-warning";
  return "badge badge-neutral";
}

export function verificationBadgeClass(status: string | null | undefined): string {
  if (status === "VALID") return "badge badge-valid";
  if (["INVALID_SIGNATURE", "SIGNER_ROLE_MISMATCH", "CONTENT_HASH_MISMATCH", "ANCHORED_HASH_MISMATCH", "ANCHOR_MISSING"].includes(status || ""))
    return "badge badge-critical";
  return "badge badge-warning";
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try { return await fetchJson<T>(url); } catch { return null; }
}

export function fullHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash;
}

export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString("es-MX", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

export const ACTA_TYPE_LABELS: Record<string, string> = {
  ACTA_APERTURA: "Acta de Apertura", ACTA_CIERRE: "Acta de Cierre",
  ACTA_ESCRUTINIO: "Acta de Escrutinio", ACTA_RESULTADOS: "Acta de Resultados",
};

export const ACTA_TYPE_ICONS: Record<string, string> = {
  ACTA_APERTURA: "📋", ACTA_CIERRE: "🔒", ACTA_ESCRUTINIO: "📊", ACTA_RESULTADOS: "📜",
};

export const PHASE_LABELS_ES: Record<string, string> = {
  SETUP: "Preparación", REGISTRY_OPEN: "Registro abierto", REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votación abierta", VOTING_CLOSED: "Votación cerrada", PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio", RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW_OPEN: "Auditoría abierta", ARCHIVED: "Archivada",
};

export function phaseLabelEs(label: string | undefined, phase: number): string {
  const key = String(label ?? "").toUpperCase();
  return PHASE_LABELS_ES[key] ?? `Fase ${phase}`;
}

export function actaLabel(type: string): string {
  return ACTA_TYPE_LABELS[type] ?? type;
}

export { etiquetaEstado, etiquetaCanalSolicitud, etiquetaMetodoBilletera };
