import React from "react";
import Link from "next/link";
import {
  phaseLabelEs, fullHash, formatTimestamp, actaLabel, severityBadgeClass,
  verificationBadgeClass, normalizeSeverityLabel, isCriticalSeverity, isWarningSeverity,
  ACTA_TYPE_ICONS, etiquetaEstado, etiquetaCanalSolicitud, etiquetaMetodoBilletera,
} from "../../lib/types";

/* ─── Inline SVG Icons (kept minimal) ─── */
function IconCheck() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>);
}
function IconAlert() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>);
}
function IconExternalLink() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>);
}
function IconChevronDown() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>);
}
function IconGitCommit() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6366f1" }}><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></svg>);
}
function IconHash() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>);
}
function IconClock() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);
}

type ElectionData = {
  electionId: string; manifestHash: string; authority: string; registryAuthority: string;
  coordinatorPubKey: string; phase: number; phaseLabel?: string; createdAtBlock: string;
  createdAtTimestamp: string | null; createdTxHash: string;
  counts: { signups: number; ballots: number };
  phaseChanges: any[]; acts: any[]; anchors: any[]; candidates: any[];
  manifest: any; manifestSource: string | null;
  signupsSummary: { total: number; uniqueNullifiers: number };
  ballotsSummary: { total: number; uniqueBallotIndexes: number };
  ballots: any[]; consistency: any; incidents: any[];
  results: any[]; enrollment: any; auditWindow: any;
  bundleHash: string | null; bundleExportStatus: string;
  zkProof: any; decryptionProof: any; zkProofHonesty: any;
  unavailableSources: string[];
};

export function ElectionDetail({ election: e }: { election: ElectionData }) {
  const activeIncidents = (e.incidents ?? []).filter((i: any) => i.active !== false);
  const resolvedIncidents = (e.incidents ?? []).filter((i: any) => i.active === false);
  const criticalCount = activeIncidents.filter((i: any) => isCriticalSeverity(i.severity)).length;
  const warningCount = activeIncidents.filter((i: any) => isWarningSeverity(i.severity)).length;
  const globalConsistency = criticalCount > 0 ? "CRITICAL" : warningCount > 0 ? "WARNING" : "OK";
  const candidatesCatalog = (e.candidates ?? []).slice().sort((a: any, b: any) => a.ballotOrder - b.ballotOrder);
  const activeCandidatesCount = candidatesCatalog.filter((c: any) => String(c.status).toUpperCase() === "ACTIVE").length;
  const latestResult = e.results?.[0] ?? null;
  const latestSummaryItems = (latestResult?.summaryItems ?? []).slice().sort((a: any, b: any) => (b.votes ?? 0) - (a.votes ?? 0));

  const timeline = [
    { key: `created:${e.electionId}`, blockNumber: e.createdAtBlock, blockTimestamp: e.createdAtTimestamp, txHash: e.createdTxHash, logIndex: -1, label: "Elección creada", detail: null as string | null, type: "creation" },
    ...e.phaseChanges.map((pc: any) => ({ key: `phase:${pc.txHash}:${pc.logIndex}`, blockNumber: pc.blockNumber, blockTimestamp: pc.blockTimestamp, txHash: pc.txHash, logIndex: pc.logIndex, label: "Cambio de fase", detail: `${pc.previousPhaseLabel} → ${pc.newPhaseLabel}`, type: "phase" })),
    ...e.anchors.map((a: any) => ({ key: `anchor:${a.txHash}:${a.logIndex}`, blockNumber: a.blockNumber, blockTimestamp: a.blockTimestamp, txHash: a.txHash, logIndex: a.logIndex, label: "Acta anclada", detail: `Tipo ${a.kind}`, type: "anchor" })),
    ...e.ballots.map((b: any) => ({ key: `ballot:${b.txHash}:${b.logIndex}`, blockNumber: b.blockNumber, blockTimestamp: b.blockTimestamp, txHash: b.txHash, logIndex: b.logIndex, label: `Boleta #${b.ballotIndex}`, detail: null as string | null, type: "ballot" })),
  ].sort((a, b) => { const bnA = BigInt(a.blockNumber); const bnB = BigInt(b.blockNumber); if (bnA < bnB) return -1; if (bnA > bnB) return 1; return a.logIndex - b.logIndex; });

  return (
    <article className="card" style={{ padding: "1.5rem", borderColor: globalConsistency === "CRITICAL" ? "#fecaca" : "#e2e8f0" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div className="flex items-center gap-3" style={{ marginBottom: "0.5rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>Elección #{e.electionId}</h2>
          <span className="phase-pill"><span className="phase-dot" />{phaseLabelEs(e.phaseLabel, e.phase)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3" style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
          <span>Manifiesto: <span className="hash-display" title={e.manifestHash}>{fullHash(e.manifestHash)}</span></span>
          <span style={{ color: "#cbd5e1" }}>·</span>
          <span>Creada: {formatTimestamp(e.createdAtTimestamp)}</span>
        </div>
        {e.unavailableSources.length > 0 && (
          <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.75rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", fontSize: "0.6875rem", color: "#92400e" }}>
            Evidencia no disponible: {e.unavailableSources.join(", ")}.
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.875rem", marginBottom: "2rem" }}>
        <div className="stat-card">
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Fase actual</span>
          <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a" }}>{phaseLabelEs(e.phaseLabel, e.phase)}</span>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #10b981" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Registros</span>
          <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{e.counts.signups}</span>
          <span className="badge" style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", alignSelf: "flex-start", marginTop: "0.25rem", fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>{e.signupsSummary.uniqueNullifiers} identidades únicas</span>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #3b82f6" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Boletas</span>
          <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{e.counts.ballots}</span>
          <span className="badge" style={{ background: "#eff6ff", color: "#1e3a8a", border: "1px solid #bfdbfe", alignSelf: "flex-start", marginTop: "0.25rem", fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>{e.ballotsSummary.uniqueBallotIndexes} pruebas zk únicas</span>
        </div>
        <div className="stat-card">
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Integridad</span>
          <div className="flex items-center gap-2" style={{ marginTop: "0.25rem" }}>
            {globalConsistency === "OK" ? (<span className="badge badge-valid"><IconCheck /> Consistente</span>) : globalConsistency === "CRITICAL" ? (<span className="badge badge-critical"><IconAlert /> {criticalCount} crít.</span>) : (<span className="badge badge-warning"><IconAlert /> {warningCount} alerta{warningCount !== 1 ? "s" : ""}</span>)}
          </div>
        </div>
      </div>

      {/* Candidate Catalog */}
      <section style={{ marginBottom: "2rem" }}>
        <h3 className="section-title">Catálogo de candidaturas</h3>
        <div className="card" style={{ padding: "1rem 1.25rem" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.75rem", color: "#475569" }}>{candidatesCatalog.length} candidatura{candidatesCatalog.length !== 1 ? "s" : ""} · {activeCandidatesCount} activa{activeCandidatesCount !== 1 ? "s" : ""}</div>
            <span className="badge badge-neutral">Manifiesto: {e.manifestSource ?? "desconocido"}</span>
          </div>
          {candidatesCatalog.length === 0 ? (
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>No hay candidaturas registradas.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {candidatesCatalog.map((c: any) => (
                <div key={c.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.625rem 0.75rem", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "0.75rem", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "999px", background: c.colorHex ?? "#94a3b8", display: "inline-block" }} />
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8", minWidth: "2rem" }}>#{c.ballotOrder}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>{c.displayName}</div>
                    <div style={{ fontSize: "0.6875rem", color: "#64748b" }}>{c.partyName || "Sin partido"} · {c.candidateCode}</div>
                  </div>
                  <span className={`badge ${String(c.status).toUpperCase() === "ACTIVE" ? "badge-valid" : "badge-neutral"}`}>{etiquetaEstado(c.status)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Results */}
      {e.results && e.results.length > 0 && latestResult && (
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "2rem", borderLeft: "3px solid #6366f1" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>Resultados publicados</h3>
            <span className="badge badge-info">{etiquetaEstado(latestResult.resultMode)}</span>
          </div>
          {latestSummaryItems.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {latestSummaryItems.map((item: any) => (
                <div key={`${latestResult.id}:${item.candidateId ?? item.displayName}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", alignItems: "center", fontSize: "0.75rem" }}>
                  <div style={{ color: "#0f172a", fontWeight: 500 }}>{item.displayName}{item.partyName ? ` · ${item.partyName}` : ""}</div>
                  <div style={{ color: "#334155", fontWeight: 700 }}>{item.votes}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ZK Proof */}
      <section style={{ marginBottom: "2rem" }}>
        <h3 className="section-title">Prueba ZK</h3>
        <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
          {e.zkProof ? (
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: "0.75rem" }}>
                <div>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>{e.zkProof.circuitId}</span>
                  <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: "0.125rem" }}>{e.zkProof.proofSystem} · Job {e.zkProof.jobId}</div>
                </div>
                <span className={`badge ${e.zkProof.status === "VERIFIED_OFFCHAIN" || e.zkProof.status === "VERIFIED_ONCHAIN" ? "badge-valid" : e.zkProof.status === "FAILED" ? "badge-critical" : "badge-warning"}`}>
                  {e.zkProof.status === "VERIFIED_OFFCHAIN" ? "✓ Verificada fuera de cadena" : e.zkProof.status === "VERIFIED_ONCHAIN" ? "✓ Verificada en cadena" : e.zkProof.status}
                </span>
              </div>
              {e.zkProofHonesty?.whatIsProved && <div style={{ fontSize: "0.75rem", color: "#475569" }}><strong>Qué prueba:</strong> {e.zkProofHonesty.whatIsProved}</div>}
              {e.decryptionProof && (
                <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px dashed #e2e8f0" }}>
                  <div style={{ fontSize: "0.75rem", color: "#334155", fontWeight: 600 }}>Prueba de descifrado: {e.decryptionProof.status}</div>
                  {e.decryptionProof.errorMessage && <div style={{ marginTop: "0.5rem", fontSize: "0.6875rem", color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "0.375rem 0.5rem" }}>{e.decryptionProof.errorMessage}</div>}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>No se ha generado prueba ZK para esta elección.</div>
          )}
        </div>
      </section>

      {/* Actas */}
      <section style={{ marginBottom: "2rem" }}>
        <h3 className="section-title">Actas electorales</h3>
        {e.acts.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin actas publicadas.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            {e.acts.map((a: any) => (
              <div key={`${a.actId}-${a.anchorTxHash}`} className="acta-card">
                <div className="acta-card-header">
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: "1.25rem" }}>{ACTA_TYPE_ICONS[a.actType] ?? "📄"}</span>
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>{actaLabel(a.actType)}</div>
                      <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>{formatTimestamp(a.blockTimestamp)} · Bloque {a.blockNumber}</div>
                    </div>
                  </div>
                  <span className={verificationBadgeClass(a.verificationStatus)}>
                    {a.verificationStatus === "VALID" && <IconCheck />} {a.verificationStatus || "PENDIENTE"}
                  </span>
                </div>
                <div style={{ padding: "1rem 1.25rem" }}>
                  <details>
                    <summary className="details-trigger"><IconChevronDown /> Detalles técnicos</summary>
                    <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9", fontSize: "0.6875rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div className="flex justify-between items-center"><span style={{ color: "#94a3b8" }}>Content hash</span><span className="hash-display" title={a.contentHash ?? ""}>{fullHash(a.contentHash)}</span></div>
                      <div className="flex justify-between items-center"><span style={{ color: "#94a3b8" }}>Anchor tx</span><span className="hash-display" title={a.anchorTxHash}>{fullHash(a.anchorTxHash)}</span></div>
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timeline */}
      <section style={{ marginBottom: "2rem" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: "1rem" }}>
          <IconGitCommit />
          <h3 className="section-title" style={{ marginBottom: 0, border: "none" }}>Línea de Tiempo</h3>
        </div>
        {timeline.length === 0 ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "0.8125rem" }}>Sin eventos registrados.</div>
        ) : (
          <div className="card" style={{ padding: "1.5rem" }}>
            {timeline.map((ev) => (
              <div key={ev.key} className="timeline-item group" style={{ paddingBottom: "1rem" }}>
                <Link 
                  href={`/elections/${e.electionId}/tx/${ev.txHash}`}
                  className="flex flex-col gap-2 p-3 rounded-lg transition-all cursor-pointer hover:bg-slate-50 border border-transparent hover:border-slate-100"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        {ev.label}
                      </div>
                      {ev.detail && <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "0.25rem" }}>{ev.detail}</div>}
                      {ev.txHash && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <span className="hash-display" title={ev.txHash} style={{ background: "#f8fafc", color: "#3b82f6", border: "1px solid #bfdbfe", padding: "0.25rem 0.5rem" }}>{fullHash(ev.txHash)}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6366f1" }}>Block {ev.blockNumber}</div>
                      {ev.blockTimestamp && <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "0.2rem" }}>{formatTimestamp(ev.blockTimestamp)}</div>}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Incidents */}
      {e.incidents.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h3 className="section-title">Incidentes ({activeIncidents.length} activos)</h3>
          {activeIncidents.map((i: any) => (
            <div key={i.fingerprint} className="incident-row">
              <span className={severityBadgeClass(i.severity)}>{normalizeSeverityLabel(i.severity)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1e293b" }}>{i.code}</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{i.message}</div>
              </div>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
