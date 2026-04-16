import Link from "next/link";
import { getPublicEnv } from "./../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ─── Type definitions (unchanged from original) ─── */

type ElectionsApiResponse = {
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

type PhaseChangesResponse = {
  ok: boolean;
  phaseChanges: Array<{
    txHash: string;
    logIndex: number;
    blockNumber: string;
    blockTimestamp: string | null;
    previousPhase: number;
    newPhase: number;
    previousPhaseLabel: string;
    newPhaseLabel: string;
  }>;
};

type ActsResponse = {
  ok: boolean;
  acts: Array<{
    actId: string;
    actType: string;
    anchorTxHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    contentHash: string | null;
    createdAt: string | null;
    verificationStatus?: string | null;
    signatureScheme?: string | null;
    signerAddress?: string | null;
    signerRole?: string | null;
    signingDigest?: string | null;
    expectedSignerAddress?: string | null;
  }>;
};

type AnchorsResponse = {
  ok: boolean;
  anchors: Array<{
    kind: number;
    snapshotHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

type SignupsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueNullifiers: number };
};

type BallotsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueBallotIndexes: number };
};

type BallotsResponse = {
  ok: boolean;
  ballots: Array<{
    ballotIndex: string;
    ballotHash: string;
    ciphertext: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

type ConsistencyResponse = {
  ok: boolean;
  consistency:
    | null
    | {
        runId: string;
        dataVersion: string;
        computedAt: string;
        ok: boolean;
        report: any;
      };
};

type IncidentsResponse = {
  ok: boolean;
  incidents: Array<{
    fingerprint: string;
    code: string;
    severity: string;
    message: string;
    details: any;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    evidencePointers?: any;
    firstSeenAt: string;
    detectedAt?: string;
    lastSeenAt: string;
    occurrences: string;
    relatedTxHash: string | null;
    relatedBlockNumber: string | null;
    relatedBlockTimestamp: string | null;
    active?: boolean;
    resolvedAt?: string | null;
  }>;
};

type ResultsResponse = {
  ok: boolean;
  candidates?: CandidateCatalogItem[];
  results: Array<{
    id: string;
    tallyJobId: string;
    resultKind: string;
    payloadJson: any;
    payloadHash: string;
    publicationStatus: string;
    proofState: string;
    resultMode: string;
    honestyNote?: string;
    summaryItems?: Array<{
      candidateId: string | null;
      candidateCode: string | null;
      displayName: string;
      partyName: string | null;
      votes: number;
      rank?: number | null;
      status?: string | null;
      unresolvedLabel?: string | null;
    }>;
    hasUnresolvedCandidateLabels?: boolean;
    unresolvedCandidateLabels?: string[];
    createdAt: string;
    publishedAt: string | null;
  }>;
};

type CandidateCatalogItem = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: string;
  colorHex: string | null;
};

type CandidatesResponse = {
  ok: boolean;
  candidates: CandidateCatalogItem[];
};

type ManifestResponse = {
  ok: boolean;
  source?: string;
  manifest?: {
    manifestHash: string;
    manifestJson?: any;
    generatedAt?: string | null;
    updatedAt?: string | null;
    schemaVersion?: string;
  };
};

type AuditWindowResponse = {
  ok: boolean;
  auditWindow: null | {
    id: string;
    status: string;
    openedAt: string | null;
    closesAt: string | null;
    openedBy: string;
    notes: string;
    createdAt: string;
  };
};

type AuditBundleResponse = {
  ok: boolean;
  bundleHash: string | null;
  exportStatus: string;
};

type ZkProofResponse = {
  ok: boolean;
  electionId: string;
  zkProof: null | {
    jobId: string;
    tallyJobId: string;
    proofSystem: string;
    circuitId: string;
    status: string;
    merkleRootKeccak: string | null;
    merkleRootPoseidon: string | null;
    merkleInclusionVerified: boolean;
    publicInputs: { signals?: string[]; candidateOrder?: string[] } | null;
    verificationKeyHash: string | null;
    verifiedOffchain: boolean;
    verifiedOnchain: boolean;
    onchainVerifierAddress: string | null;
    onchainVerificationTx: string | null;
    errorMessage: string | null;
    provingStartedAt: string | null;
    provingCompletedAt: string | null;
    createdAt: string | null;
  };
  honesty: {
    whatIsProved: string;
    whatIsNotProved: string[];
    auditabilityNote: string;
  };
};

/* ─── Helpers (logic unchanged) ─── */

function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

function normalizeSeverityLabel(severity: string): string {
  const s = String(severity ?? "").toUpperCase();
  if (s === "ERROR") return "CRITICAL";
  if (s === "WARN") return "WARNING";
  return s.length > 0 ? s : "UNKNOWN";
}

function severityBadgeClass(severity: string): string {
  if (isCriticalSeverity(severity)) return "badge badge-critical";
  if (isWarningSeverity(severity)) return "badge badge-warning";
  return "badge badge-neutral";
}

function verificationBadgeClass(status: string | null | undefined): string {
  if (status === "VALID") return "badge badge-valid";
  if (
    [
      "INVALID_SIGNATURE",
      "SIGNER_ROLE_MISMATCH",
      "CONTENT_HASH_MISMATCH",
      "ANCHORED_HASH_MISMATCH",
      "ANCHOR_MISSING",
    ].includes(status || "")
  )
    return "badge badge-critical";
  return "badge badge-warning";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

function fullHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

const ACTA_TYPE_LABELS: Record<string, string> = {
  ACTA_APERTURA: "Acta de Apertura",
  ACTA_CIERRE: "Acta de Cierre",
  ACTA_ESCRUTINIO: "Acta de Escrutinio",
  ACTA_RESULTADOS: "Acta de Resultados",
};

const ACTA_TYPE_ICONS: Record<string, string> = {
  ACTA_APERTURA: "📋",
  ACTA_CIERRE: "🔒",
  ACTA_ESCRUTINIO: "📊",
  ACTA_RESULTADOS: "📜",
};

function actaLabel(type: string): string {
  return ACTA_TYPE_LABELS[type] ?? type;
}

/* ─── SVG Icons ─── */

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
}

function IconExternalLink() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

/* ─── Page Component ─── */

export default async function Page() {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const electionsRes = await safeFetchJson<ElectionsApiResponse | null>(
    `${apiBase}/v1/elections`,
    null,
  );
  const elections = electionsRes?.elections ?? [];

  const electionsDetailed = await Promise.all(
    elections.map(async (e) => {
      const id = String(e.electionId);
      const [
        phaseChangesRes,
        actsRes,
        anchorsRes,
        candidatesRes,
        manifestRes,
        signupsSummaryRes,
        ballotsSummaryRes,
        ballotsRes,
        consistencyRes,
        incidentsRes,
        resultsRes,
        auditWindowRes,
        auditBundleRes,
        zkProofRes,
      ] = await Promise.all([
        safeFetchJson<PhaseChangesResponse>(
          `${apiBase}/v1/elections/${id}/phase-changes`,
          { ok: true, phaseChanges: [] },
        ),
        safeFetchJson<ActsResponse>(`${apiBase}/v1/elections/${id}/acts`, { ok: true, acts: [] }),
        safeFetchJson<AnchorsResponse>(
          `${apiBase}/v1/elections/${id}/anchors`,
          { ok: true, anchors: [] },
        ),
        safeFetchJson<CandidatesResponse>(`${apiBase}/v1/elections/${id}/candidates`, {
          ok: true,
          candidates: [],
        }),
        safeFetchJson<ManifestResponse>(`${apiBase}/v1/elections/${id}/manifest`, {
          ok: true,
          manifest: undefined,
          source: "unknown",
        }),
        safeFetchJson<SignupsSummaryResponse>(
          `${apiBase}/v1/elections/${id}/signups/summary`,
          { ok: true, summary: { total: 0, uniqueNullifiers: 0 } },
        ),
        safeFetchJson<BallotsSummaryResponse>(
          `${apiBase}/v1/elections/${id}/ballots/summary`,
          { ok: true, summary: { total: 0, uniqueBallotIndexes: 0 } },
        ),
        safeFetchJson<BallotsResponse>(`${apiBase}/v1/elections/${id}/ballots`, {
          ok: true,
          ballots: [],
        }),
        safeFetchJson<ConsistencyResponse>(
          `${apiBase}/v1/elections/${id}/consistency`,
          { ok: true, consistency: null },
        ),
        safeFetchJson<IncidentsResponse>(`${apiBase}/v1/elections/${id}/incidents`, {
          ok: true,
          incidents: [],
        }),
        safeFetchJson<ResultsResponse>(`${apiBase}/v1/elections/${id}/results`, {
          ok: true,
          results: [],
        }),
        safeFetchJson<AuditWindowResponse>(`${apiBase}/v1/elections/${id}/audit-window`, {
          ok: true,
          auditWindow: null,
        }),
        safeFetchJson<AuditBundleResponse>(`${apiBase}/v1/elections/${id}/audit-bundle`, {
          ok: true,
          bundleHash: null,
          exportStatus: "NOT_MATERIALIZED",
        }),
        safeFetchJson<ZkProofResponse>(`${apiBase}/v1/elections/${id}/zk-proof`, {
          ok: true,
          electionId: id,
          zkProof: null,
          honesty: {
            whatIsProved: "No ZK proof endpoint available",
            whatIsNotProved: [],
            auditabilityNote: "",
          },
        }),
      ]);

      return {
        ...e,
        phaseChanges: phaseChangesRes.phaseChanges,
        acts: actsRes.acts,
        anchors: anchorsRes.anchors,
        candidates: candidatesRes.candidates,
        manifest: manifestRes.manifest ?? null,
        manifestSource: manifestRes.source ?? null,
        signupsSummary: signupsSummaryRes.summary,
        ballotsSummary: ballotsSummaryRes.summary,
        ballots: ballotsRes.ballots,
        consistency: consistencyRes.consistency,
        incidents: incidentsRes.incidents,
        results: resultsRes.results,
        auditWindow: auditWindowRes.auditWindow,
        bundleHash: auditBundleRes.bundleHash,
        bundleExportStatus: auditBundleRes.exportStatus,
        zkProof: zkProofRes.zkProof,
        zkProofHonesty: zkProofRes.honesty,
      };
    }),
  );

  return (
    <main className="min-h-screen" style={{ background: "#f8fafc" }}>
      {/* ─── Top Bar ─── */}
      <header
        style={{
          background: "white",
          borderBottom: "1px solid #e2e8f0",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "1rem 1.5rem" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                }}
              >
                <IconShield />
              </div>
              <div>
                <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>
                  Observatorio Electoral
                </h1>
                <p style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 400 }}>
                  BlockUrna · Protocolo BU‑PVP‑1
                </p>
              </div>
            </div>
            <div
              style={{
                fontSize: "0.6875rem",
                color: "#94a3b8",
                background: "#f8fafc",
                padding: "0.25rem 0.625rem",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
              }}
            >
              API: {apiBase.replace(/^https?:\/\//, "")}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Content ─── */}
      <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem 4rem" }}>
        {electionsRes === null ? (
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
              No se pudo conectar con la Evidence API.
            </p>
          </div>
        ) : electionsDetailed.length === 0 ? (
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.875rem", color: "#64748b" }}>
              No hay elecciones registradas todavía.
            </p>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.5rem" }}>
              Crea una elección desde la Consola AEA para comenzar la observación.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
            {electionsDetailed.map((e) => {
              const activeIncidents = (e.incidents ?? []).filter((i) => i.active !== false);
              const resolvedIncidents = (e.incidents ?? []).filter((i) => i.active === false);
              const criticalCount = activeIncidents.filter((i) =>
                isCriticalSeverity(i.severity),
              ).length;
              const warningCount = activeIncidents.filter((i) =>
                isWarningSeverity(i.severity),
              ).length;

              const globalConsistency = criticalCount > 0
                ? "CRITICAL"
                : warningCount > 0
                  ? "WARNING"
                  : "OK";

              const candidatesCatalog = (e.candidates ?? [])
                .slice()
                .sort((a, b) => a.ballotOrder - b.ballotOrder);
              const activeCandidatesCount = candidatesCatalog.filter(
                (candidate) => String(candidate.status).toUpperCase() === "ACTIVE",
              ).length;
              const latestResult = e.results?.[0] ?? null;
              const latestSummaryItems = (latestResult?.summaryItems ?? [])
                .slice()
                .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

              const timeline = [
                {
                  key: `created:${e.electionId}`,
                  blockNumber: e.createdAtBlock,
                  blockTimestamp: e.createdAtTimestamp,
                  txHash: e.createdTxHash,
                  logIndex: -1,
                  label: "Elección creada",
                  detail: null as string | null,
                  type: "creation",
                },
                ...e.phaseChanges.map((pc) => ({
                  key: `phase:${pc.txHash}:${pc.logIndex}`,
                  blockNumber: pc.blockNumber,
                  blockTimestamp: pc.blockTimestamp,
                  txHash: pc.txHash,
                  logIndex: pc.logIndex,
                  label: "Cambio de fase",
                  detail: `${pc.previousPhaseLabel} → ${pc.newPhaseLabel}`,
                  type: "phase",
                })),
                ...e.anchors.map((a) => ({
                  key: `anchor:${a.txHash}:${a.logIndex}`,
                  blockNumber: a.blockNumber,
                  blockTimestamp: a.blockTimestamp,
                  txHash: a.txHash,
                  logIndex: a.logIndex,
                  label: "Acta anclada",
                  detail: `Tipo ${a.kind}`,
                  type: "anchor",
                })),
                ...e.ballots.map((b) => ({
                  key: `ballot:${b.txHash}:${b.logIndex}`,
                  blockNumber: b.blockNumber,
                  blockTimestamp: b.blockTimestamp,
                  txHash: b.txHash,
                  logIndex: b.logIndex,
                  label: `Boleta #${b.ballotIndex}`,
                  detail: null as string | null,
                  type: "ballot",
                })),
              ].sort((a, b) => {
                const bnA = BigInt(a.blockNumber);
                const bnB = BigInt(b.blockNumber);
                if (bnA < bnB) return -1;
                if (bnA > bnB) return 1;
                return a.logIndex - b.logIndex;
              });

              return (
                <article key={e.electionId}>
                  {/* ─── Election Header ─── */}
                  <div style={{ marginBottom: "1.5rem" }}>
                    <div className="flex items-center gap-3" style={{ marginBottom: "0.5rem" }}>
                      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        Elección #{e.electionId}
                      </h2>
                      <span className="phase-pill">
                        <span className="phase-dot" />
                        {e.phaseLabel ?? `Fase ${e.phase}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3" style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                      <span>Manifiesto: <span className="hash-display" title={e.manifestHash}>{fullHash(e.manifestHash)}</span></span>
                      <span style={{ color: "#cbd5e1" }}>·</span>
                      <span>Creada: {formatTimestamp(e.createdAtTimestamp)}</span>
                    </div>
                  </div>

                  {/* ─── Stat Cards ─── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                      gap: "0.875rem",
                      marginBottom: "2rem",
                    }}
                  >
                    <div className="stat-card">
                      <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Fase actual
                      </span>
                      <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        {e.phaseLabel ?? String(e.phase)}
                      </span>
                    </div>

                    <div className="stat-card">
                      <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Registros
                      </span>
                      <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        {e.counts.signups}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                        {e.signupsSummary.uniqueNullifiers} únicos
                      </span>
                      <a
                        className="btn-subtle"
                        href={`/elections/${encodeURIComponent(String(e.electionId))}/signups`}
                        style={{ marginTop: "0.5rem", alignSelf: "flex-start" }}
                      >
                        Ver registros <IconExternalLink />
                      </a>
                    </div>

                    <div className="stat-card">
                      <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Boletas
                      </span>
                      <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>
                        {e.counts.ballots}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                        {e.ballotsSummary.uniqueBallotIndexes} índices únicos
                      </span>
                    </div>

                    <div className="stat-card">
                      <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Integridad
                      </span>
                      <div className="flex items-center gap-2" style={{ marginTop: "0.25rem" }}>
                        {globalConsistency === "OK" ? (
                          <span className="badge badge-valid"><IconCheck /> Consistente</span>
                        ) : globalConsistency === "CRITICAL" ? (
                          <span className="badge badge-critical"><IconAlert /> {criticalCount} crít.</span>
                        ) : (
                          <span className="badge badge-warning"><IconAlert /> {warningCount} alerta{warningCount !== 1 ? "s" : ""}</span>
                        )}
                      </div>
                      <span style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.25rem" }}>
                        {activeIncidents.length} activo{activeIncidents.length !== 1 ? "s" : ""} · {resolvedIncidents.length} resuelto{resolvedIncidents.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {e.auditWindow && (
                      <div className="stat-card" style={{ borderColor: e.auditWindow.status === "OPEN" ? "#d1fae5" : "#e2e8f0" }}>
                        <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Auditoría
                        </span>
                        <span className={`badge ${e.auditWindow.status === "OPEN" ? "badge-valid" : "badge-neutral"}`} style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}>
                          {e.auditWindow.status === "OPEN" ? "Ventana abierta" : e.auditWindow.status}
                        </span>
                        {e.auditWindow.openedAt && (
                          <span style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                            Desde: {formatTimestamp(e.auditWindow.openedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ─── Candidate Catalog ─── */}
                  <section style={{ marginBottom: "2rem" }}>
                    <h3 className="section-title">Catálogo de candidaturas</h3>
                    <div className="card" style={{ padding: "1rem 1.25rem" }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
                        <div style={{ fontSize: "0.75rem", color: "#475569" }}>
                          {candidatesCatalog.length} candidatura{candidatesCatalog.length !== 1 ? "s" : ""} · {activeCandidatesCount} activa{activeCandidatesCount !== 1 ? "s" : ""}
                        </div>
                        <span className="badge badge-neutral">
                          Manifiesto: {e.manifestSource ?? "unknown"}
                        </span>
                      </div>

                      {e.manifest?.manifestHash && (
                        <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
                          Hash manifiesto vigente: <span className="hash-display" title={e.manifest.manifestHash}>{fullHash(e.manifest.manifestHash)}</span>
                        </div>
                      )}

                      {candidatesCatalog.length === 0 ? (
                        <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                          No hay candidaturas registradas en el catálogo de esta elección.
                        </p>
                      ) : (
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          {candidatesCatalog.map((candidate) => (
                            <div
                              key={candidate.id}
                              style={{
                                border: "1px solid #e2e8f0",
                                borderRadius: "10px",
                                padding: "0.625rem 0.75rem",
                                display: "grid",
                                gridTemplateColumns: "auto 1fr auto",
                                gap: "0.75rem",
                                alignItems: "center",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span
                                  style={{
                                    width: "10px",
                                    height: "10px",
                                    borderRadius: "999px",
                                    background: candidate.colorHex ?? "#94a3b8",
                                    display: "inline-block",
                                  }}
                                />
                                <span style={{ fontSize: "0.75rem", color: "#94a3b8", minWidth: "2rem" }}>
                                  #{candidate.ballotOrder}
                                </span>
                              </div>
                              <div>
                                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>
                                  {candidate.displayName}
                                </div>
                                <div style={{ fontSize: "0.6875rem", color: "#64748b" }}>
                                  {candidate.partyName || "Sin partido"} · {candidate.candidateCode}
                                </div>
                              </div>
                              <span className={`badge ${String(candidate.status).toUpperCase() === "ACTIVE" ? "badge-valid" : "badge-neutral"}`}>
                                {candidate.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* ─── Results (if available) ─── */}
                  {e.results && e.results.length > 0 && (() => {
                    const r = latestResult!;
                    return (
                      <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "2rem", borderLeft: "3px solid #6366f1" }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
                          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>
                            Resultados experimentales publicados
                          </h3>
                          <span className="badge badge-info">{r.resultMode}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.75rem" }}>
                          <div>
                            <span style={{ color: "#94a3b8" }}>Tally Job:</span>{" "}
                            <span className="hash-display" title={r.tallyJobId}>{fullHash(r.tallyJobId)}</span>
                          </div>
                          <div>
                            <span style={{ color: "#94a3b8" }}>Proof State:</span>{" "}
                            <span style={{ color: "#475569", fontWeight: 500 }}>{r.proofState}</span>
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <span style={{ color: "#94a3b8" }}>Payload Hash:</span>{" "}
                            <span className="hash-display" title={r.payloadHash} style={{ maxWidth: "100%" }}>{fullHash(r.payloadHash)}</span>
                          </div>
                          {r.honestyNote && (
                            <div style={{ gridColumn: "1 / -1", color: "#475569" }}>
                              <span style={{ color: "#94a3b8" }}>Estado:</span> {r.honestyNote}
                            </div>
                          )}
                        </div>

                        {latestSummaryItems.length > 0 && (
                          <div style={{ marginTop: "1rem", borderTop: "1px solid #e2e8f0", paddingTop: "0.75rem" }}>
                            <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "#334155", marginBottom: "0.5rem" }}>
                              Resumen por candidatura
                            </h4>
                            <div style={{ display: "grid", gap: "0.5rem" }}>
                              {latestSummaryItems.map((item) => (
                                <div
                                  key={`${r.id}:${item.candidateId ?? item.candidateCode ?? item.displayName}`}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto",
                                    gap: "0.5rem",
                                    alignItems: "center",
                                    fontSize: "0.75rem",
                                  }}
                                >
                                  <div style={{ color: "#0f172a", fontWeight: 500 }}>
                                    {item.displayName}
                                    {item.partyName ? ` · ${item.partyName}` : ""}
                                  </div>
                                  <div style={{ color: "#334155", fontWeight: 700 }}>{item.votes}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {r.hasUnresolvedCandidateLabels && (
                          <div
                            style={{
                              marginTop: "0.875rem",
                              padding: "0.625rem 0.75rem",
                              borderRadius: "8px",
                              border: "1px solid #fcd34d",
                              background: "#fffbeb",
                              fontSize: "0.75rem",
                              color: "#92400e",
                            }}
                          >
                            Se detectaron etiquetas de resultado no resueltas contra el catálogo oficial: {(r.unresolvedCandidateLabels ?? []).join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ─── Audit Bundle ─── */}
                  {e.bundleHash && (
                    <div className="card" style={{ padding: "1rem 1.5rem", marginBottom: "2rem" }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#475569" }}>Bundle de auditoría</span>
                          <div style={{ marginTop: "0.25rem" }}>
                            <span className="hash-display" title={e.bundleHash}>{fullHash(e.bundleHash)}</span>
                          </div>
                        </div>
                        <span className="badge badge-neutral">{e.bundleExportStatus}</span>
                      </div>
                    </div>
                  )}

                  {/* ─── Timeline ─── */}
                  <section style={{ marginBottom: "2.5rem" }}>
                    <h3 className="section-title">Línea de tiempo</h3>
                    {timeline.length === 0 ? (
                      <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin eventos indexados.</p>
                    ) : (
                      <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                          {timeline.map((ev) => (
                            <div key={ev.key} className={`timeline-item ${ev.type}`} style={{ paddingBottom: "1rem" }}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1e293b" }}>
                                    {ev.label}
                                  </div>
                                  {ev.detail && (
                                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.125rem" }}>
                                      {ev.detail}
                                    </div>
                                  )}
                                </div>
                                <div style={{ textAlign: "right", flexShrink: 0 }}>
                                  <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                                    Bloque {ev.blockNumber}
                                  </div>
                                  {ev.blockTimestamp && (
                                    <div style={{ fontSize: "0.6875rem", color: "#cbd5e1" }}>
                                      {formatTimestamp(ev.blockTimestamp)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {ev.txHash && (
                                <div style={{ marginTop: "0.25rem" }}>
                                  <span className="hash-display" title={ev.txHash}>{fullHash(ev.txHash)}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* ─── Actas (Evidence Cards) ─── */}
                  <section style={{ marginBottom: "2.5rem" }}>
                    <h3 className="section-title">Actas electorales</h3>
                    {e.acts.length === 0 ? (
                      <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin actas publicadas.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                        {e.acts.map((a) => (
                          <div key={`${a.actId}-${a.anchorTxHash}`} className="acta-card">
                            <div className="acta-card-header">
                              <div className="flex items-center gap-3">
                                <span style={{ fontSize: "1.25rem" }}>
                                  {ACTA_TYPE_ICONS[a.actType] ?? "📄"}
                                </span>
                                <div>
                                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>
                                    {actaLabel(a.actType)}
                                  </div>
                                  <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                                    {formatTimestamp(a.blockTimestamp)} · Bloque {a.blockNumber}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={verificationBadgeClass(a.verificationStatus)}>
                                  {a.verificationStatus === "VALID" && <IconCheck />}
                                  {a.verificationStatus || "PENDIENTE"}
                                </span>
                              </div>
                            </div>

                            <div style={{ padding: "1rem 1.25rem" }}>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "0.75rem 1.5rem",
                                  fontSize: "0.75rem",
                                }}
                              >
                                <div>
                                  <span style={{ color: "#94a3b8", fontWeight: 500 }}>Firmante</span>
                                  <div style={{ marginTop: "0.125rem" }}>
                                    <span className="badge badge-info" style={{ fontSize: "0.625rem" }}>
                                      {a.signerRole || "—"}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <span style={{ color: "#94a3b8", fontWeight: 500 }}>Esquema</span>
                                  <div style={{ color: "#475569", marginTop: "0.125rem" }}>
                                    {a.signatureScheme || "—"}
                                  </div>
                                </div>
                                <div>
                                  <span style={{ color: "#94a3b8", fontWeight: 500 }}>Dirección esperada</span>
                                  <div style={{ marginTop: "0.125rem" }}>
                                    <span className="hash-display" title={a.expectedSignerAddress ?? ""}>
                                      {fullHash(a.expectedSignerAddress)}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <span style={{ color: "#94a3b8", fontWeight: 500 }}>Dirección recuperada</span>
                                  <div style={{ marginTop: "0.125rem" }}>
                                    <span className="hash-display" title={a.signerAddress ?? ""}>
                                      {fullHash(a.signerAddress)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Expandable technical details */}
                              <details style={{ marginTop: "1rem" }}>
                                <summary className="details-trigger">
                                  <IconChevronDown /> Detalles técnicos (hashes)
                                </summary>
                                <div
                                  style={{
                                    marginTop: "0.75rem",
                                    padding: "0.75rem",
                                    background: "#f8fafc",
                                    borderRadius: "8px",
                                    border: "1px solid #f1f5f9",
                                    fontSize: "0.6875rem",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem",
                                  }}
                                >
                                  <div className="flex justify-between items-center">
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>Content Hash</span>
                                    <span className="hash-display" title={a.contentHash ?? ""}>{fullHash(a.contentHash)}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>Signing Digest</span>
                                    <span className="hash-display" title={a.signingDigest ?? ""}>{fullHash(a.signingDigest)}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>Anchored Hash</span>
                                    <span className="hash-display" title={a.actId}>{fullHash(a.actId)}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>Anchor Tx</span>
                                    <span className="hash-display" title={a.anchorTxHash}>{fullHash(a.anchorTxHash)}</span>
                                  </div>
                                </div>
                              </details>

                              <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                                <Link
                                  className="btn-subtle"
                                  href={`/elections/${encodeURIComponent(String(e.electionId))}/acts/${encodeURIComponent(String(a.actId))}`}
                                >
                                  Ver acta firmada <IconExternalLink />
                                </Link>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* ─── ZK Proof Status ─── */}
                  <section style={{ marginBottom: "2.5rem" }}>
                    <h3 className="section-title">Prueba ZK</h3>
                    <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
                      {e.zkProof ? (
                        <div>
                          <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
                            <div>
                              <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>
                                {e.zkProof.circuitId}
                              </span>
                              <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.125rem" }}>
                                {e.zkProof.proofSystem} · Job {e.zkProof.jobId}
                              </div>
                            </div>
                            <span className={`badge ${
                              e.zkProof.status === "VERIFIED_OFFCHAIN" ? "badge-valid" :
                              e.zkProof.status === "VERIFIED_ONCHAIN" ? "badge-valid" :
                              e.zkProof.status === "BUILDING" ? "badge-warning" :
                              e.zkProof.status === "FAILED" ? "badge-critical" :
                              "badge-neutral"
                            }`}>
                              {e.zkProof.status === "VERIFIED_OFFCHAIN" ? "✓ Verificada off-chain" :
                               e.zkProof.status === "VERIFIED_ONCHAIN" ? "✓ Verificada on-chain" :
                               e.zkProof.status === "BUILDING" ? "⏳ Generando..." :
                               e.zkProof.status === "FAILED" ? "✗ Fallida" :
                               e.zkProof.status}
                            </span>
                          </div>

                          <div style={{ fontSize: "0.75rem", color: "#475569", marginBottom: "0.5rem" }}>
                            <strong>Qué prueba:</strong> {e.zkProofHonesty?.whatIsProved}
                          </div>

                          {e.zkProof.verificationKeyHash && (
                            <div style={{ fontSize: "0.6875rem", color: "#94a3b8", fontFamily: "monospace", wordBreak: "break-all", marginBottom: "0.5rem" }}>
                              VKey hash: {e.zkProof.verificationKeyHash}
                            </div>
                          )}

                          <div style={{ fontSize: "0.6875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                            Inclusión Merkle 9B: {e.zkProof.merkleInclusionVerified ? "verificada" : "pendiente"}
                          </div>

                          {e.zkProof.merkleRootPoseidon && (
                            <div style={{ fontSize: "0.6875rem", color: "#94a3b8", fontFamily: "monospace", wordBreak: "break-all", marginBottom: "0.5rem" }}>
                              Poseidon root: {e.zkProof.merkleRootPoseidon}
                            </div>
                          )}

                          {e.zkProofHonesty?.whatIsNotProved && e.zkProofHonesty.whatIsNotProved.length > 0 && (
                            <div style={{
                              marginTop: "0.75rem",
                              padding: "0.625rem 0.75rem",
                              background: "#fefce8",
                              border: "1px solid #fef08a",
                              borderRadius: "6px",
                              fontSize: "0.6875rem",
                              color: "#854d0e",
                            }}>
                              <strong>Pendiente de prueba ZK:</strong>
                              <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0 }}>
                                {e.zkProofHonesty.whatIsNotProved.map((item: string, idx: number) => (
                                  <li key={idx}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {e.zkProofHonesty?.auditabilityNote && (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.6875rem", color: "#64748b", fontStyle: "italic" }}>
                              {e.zkProofHonesty.auditabilityNote}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                          No se ha generado prueba ZK para esta elección.
                          <div style={{ marginTop: "0.375rem", fontSize: "0.6875rem", color: "#cbd5e1" }}>
                            La auditabilidad depende actualmente de la verificación del transcript completo.
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* ─── Consistency & Incidents ─── */}
                  <section style={{ marginBottom: "2.5rem" }}>
                    <h3 className="section-title">Consistencia e incidentes</h3>

                    {/* Consistency summary */}
                    {e.consistency && (
                      <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>
                              Verificación de consistencia
                            </span>
                            <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.125rem" }}>
                              {formatTimestamp(e.consistency.computedAt)} · v{e.consistency.dataVersion}
                            </div>
                          </div>
                          <span className={`badge ${globalConsistency === "OK" ? "badge-valid" : globalConsistency === "CRITICAL" ? "badge-critical" : "badge-warning"}`}>
                            {globalConsistency === "OK" ? <><IconCheck /> Consistente</> : <><IconAlert /> {globalConsistency}</>}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Incidents */}
                    {e.incidents.length === 0 ? (
                      <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
                        <div className="flex items-center gap-2" style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>
                          <IconCheck /> Sin incidentes registrados
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                        {/* Active incidents */}
                        {activeIncidents.length > 0 && (
                          <div className="card" style={{ overflow: "hidden" }}>
                            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #f1f5f9", background: "#fffbeb" }}>
                              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#92400e" }}>
                                Activos ({activeIncidents.length})
                              </span>
                            </div>
                            {activeIncidents.map((i) => (
                              <div key={i.fingerprint} className="incident-row">
                                <span className={severityBadgeClass(i.severity)} style={{ flexShrink: 0 }}>
                                  {normalizeSeverityLabel(i.severity)}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1e293b" }}>
                                    {i.code}
                                  </div>
                                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.125rem" }}>
                                    {i.message}
                                  </div>
                                  <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.25rem" }}>
                                    {i.occurrences} ocurrencia{Number(i.occurrences) !== 1 ? "s" : ""} · Último: {formatTimestamp(i.lastSeenAt)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Resolved incidents */}
                        {resolvedIncidents.length > 0 && (
                          <details>
                            <summary className="details-trigger" style={{ marginBottom: "0.5rem" }}>
                              <IconChevronDown /> Resueltos ({resolvedIncidents.length})
                            </summary>
                            <div className="card" style={{ overflow: "hidden" }}>
                              {resolvedIncidents.map((i) => (
                                <div key={i.fingerprint} className="incident-row" style={{ opacity: 0.7 }}>
                                  <span className={severityBadgeClass(i.severity)} style={{ flexShrink: 0 }}>
                                    {normalizeSeverityLabel(i.severity)}
                                  </span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1e293b" }}>
                                      {i.code}
                                    </div>
                                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.125rem" }}>
                                      {i.message}
                                    </div>
                                    <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.25rem" }}>
                                      Resuelto: {formatTimestamp(i.resolvedAt)}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </section>

                  {/* ─── Ballots Table ─── */}
                  {e.ballots.length > 0 && (
                    <section style={{ marginBottom: "2.5rem" }}>
                      <h3 className="section-title">Boletas publicadas</h3>
                      <div className="card" style={{ overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                #
                              </th>
                              <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Ballot Hash
                              </th>
                              <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Bloque
                              </th>
                              <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Tx
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.ballots.map((b) => (
                              <tr
                                key={`${b.txHash}:${b.logIndex}`}
                                style={{ borderBottom: "1px solid #f8fafc" }}
                              >
                                <td style={{ padding: "0.625rem 1rem", color: "#475569", fontWeight: 500 }}>
                                  {b.ballotIndex}
                                </td>
                                <td style={{ padding: "0.625rem 1rem" }}>
                                  <span className="hash-display" title={b.ballotHash}>
                                    {fullHash(b.ballotHash)}
                                  </span>
                                </td>
                                <td style={{ padding: "0.625rem 1rem", color: "#64748b" }}>
                                  {b.blockNumber}
                                </td>
                                <td style={{ padding: "0.625rem 1rem" }}>
                                  <span className="hash-display" title={b.txHash}>
                                    {fullHash(b.txHash)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* ─── Technical notes (discreet accordion) ─── */}
                  <section style={{ marginBottom: "2rem" }}>
                    <details>
                      <summary className="details-trigger" style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
                        <IconChevronDown /> Notas técnicas sobre validación
                      </summary>
                      <div className="info-note" style={{ marginTop: "0.5rem" }}>
                        <p style={{ fontWeight: 600, color: "#475569", marginBottom: "0.5rem" }}>
                          Estado de validación criptográfica
                        </p>
                        <ul style={{ paddingLeft: "1.25rem", listStyle: "disc", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                          <li><strong>Firma ECDSA del acta:</strong> REAL — verificable end-to-end con SECP256K1.</li>
                          <li><strong>Prueba interactiva ZK (JED):</strong> SIMULADA — el kernel ZK aún no está integrado.</li>
                          <li><strong>canonicalJson:</strong> Estructura canónica del contenido del acta.</li>
                          <li><strong>contentHash:</strong> Keccak256 sobre canonicalJson.</li>
                          <li><strong>signingDigest:</strong> Keccak256 sobre el signingPayload (contentHash prefijado).</li>
                          <li><strong>anchoredHash:</strong> Hash anclado públicamente en la blockchain.</li>
                        </ul>
                        <p style={{ marginTop: "0.75rem", color: "#94a3b8", fontStyle: "italic" }}>
                          Autoridad AEA: <span className="hash-display" title={e.authority}>{fullHash(e.authority)}</span>{" · "}
                          REA: <span className="hash-display" title={e.registryAuthority}>{fullHash(e.registryAuthority)}</span>
                        </p>
                      </div>
                    </details>
                  </section>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Footer ─── */}
      <footer
        style={{
          borderTop: "1px solid #e2e8f0",
          background: "white",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
          BlockUrna · Observatorio Electoral BU‑PVP‑1 · Instancia experimental de investigación
        </p>
      </footer>
    </main>
  );
}
