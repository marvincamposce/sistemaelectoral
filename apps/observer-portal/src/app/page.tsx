import Link from "next/link";
import { getPublicEnv } from "./../lib/env";
import { LiveRefresh } from "./components/LiveRefresh";
import { ElectionDetail } from "./components/ElectionDetail";
import {
  type ElectionsApiResponse, type PhaseChangesResponse, type ActsResponse, type AnchorsResponse,
  type CandidatesResponse, type ManifestResponse, type SignupsSummaryResponse, type BallotsSummaryResponse,
  type BallotsResponse, type ConsistencyResponse, type IncidentsResponse, type ResultsResponse,
  type ElectionEnrollmentResponse, type AuditWindowResponse, type AuditBundleResponse, type ZkProofResponse,
  fetchJsonOrNull, phaseLabelEs, isCriticalSeverity, isWarningSeverity,
} from "../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadElections(apiBase: string) {
  const electionsRes = await fetchJsonOrNull<ElectionsApiResponse>(`${apiBase}/v1/elections`);
  const elections = electionsRes?.elections ?? [];

  const electionsDetailed = await Promise.all(
    elections.map(async (e) => {
      const id = String(e.electionId);
      const [pcR, acR, anR, caR, maR, suR, baR, blR, coR, inR, reR, enR, awR, abR, zkR] = await Promise.all([
        fetchJsonOrNull<PhaseChangesResponse>(`${apiBase}/v1/elections/${id}/phase-changes`),
        fetchJsonOrNull<ActsResponse>(`${apiBase}/v1/elections/${id}/acts`),
        fetchJsonOrNull<AnchorsResponse>(`${apiBase}/v1/elections/${id}/anchors`),
        fetchJsonOrNull<CandidatesResponse>(`${apiBase}/v1/elections/${id}/candidates`),
        fetchJsonOrNull<ManifestResponse>(`${apiBase}/v1/elections/${id}/manifest`),
        fetchJsonOrNull<SignupsSummaryResponse>(`${apiBase}/v1/elections/${id}/signups/summary`),
        fetchJsonOrNull<BallotsSummaryResponse>(`${apiBase}/v1/elections/${id}/ballots/summary`),
        fetchJsonOrNull<BallotsResponse>(`${apiBase}/v1/elections/${id}/ballots`),
        fetchJsonOrNull<ConsistencyResponse>(`${apiBase}/v1/elections/${id}/consistency`),
        fetchJsonOrNull<IncidentsResponse>(`${apiBase}/v1/elections/${id}/incidents`),
        fetchJsonOrNull<ResultsResponse>(`${apiBase}/v1/elections/${id}/results`),
        fetchJsonOrNull<ElectionEnrollmentResponse>(`${apiBase}/v1/elections/${id}/enrollment`),
        fetchJsonOrNull<AuditWindowResponse>(`${apiBase}/v1/elections/${id}/audit-window`),
        fetchJsonOrNull<AuditBundleResponse>(`${apiBase}/v1/elections/${id}/audit-bundle`),
        fetchJsonOrNull<ZkProofResponse>(`${apiBase}/v1/elections/${id}/zk-proof`),
      ]);

      const unavailableSources = [
        pcR ? null : "phase-changes", acR ? null : "acts", anR ? null : "anchors",
        caR ? null : "candidates", maR ? null : "manifest", suR ? null : "signups-summary",
        baR ? null : "ballots-summary", blR ? null : "ballots", coR ? null : "consistency",
        inR ? null : "incidents", reR ? null : "results", enR ? null : "enrollment",
        awR ? null : "audit-window", abR ? null : "audit-bundle", zkR ? null : "zk-proof",
      ].filter((v): v is string => v != null);

      return {
        ...e, phaseChanges: pcR?.phaseChanges ?? [], acts: acR?.acts ?? [],
        anchors: anR?.anchors ?? [], candidates: caR?.candidates ?? [],
        manifest: maR?.manifest ?? null, manifestSource: maR?.source ?? null,
        signupsSummary: suR?.summary ?? { total: 0, uniqueNullifiers: 0 },
        ballotsSummary: baR?.summary ?? { total: 0, uniqueBallotIndexes: 0 },
        ballots: blR?.ballots ?? [], consistency: coR?.consistency ?? null,
        incidents: inR?.incidents ?? [], results: reR?.results ?? [],
        enrollment: enR ?? null, auditWindow: awR?.auditWindow ?? null,
        bundleHash: abR?.bundleHash ?? null, bundleExportStatus: abR?.exportStatus ?? "UNAVAILABLE",
        zkProof: zkR?.zkProof ?? null, decryptionProof: zkR?.decryptionProof ?? null,
        zkProofHonesty: zkR?.honesty ?? null, unavailableSources,
      };
    }),
  );
  return { electionsRes, electionsDetailed };
}

export default async function Page() {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");
  const { electionsRes, electionsDetailed } = await loadElections(apiBase);

  const globalElectionCount = electionsDetailed.length;
  const globalActiveIncidents = electionsDetailed.reduce((acc, el) => acc + (el.incidents ?? []).filter((i) => i.active !== false).length, 0);
  const globalAuditOpen = electionsDetailed.filter((el) => el.auditWindow?.status === "OPEN").length;
  const globalZkVerified = electionsDetailed.filter((el) => el.zkProof?.verifiedOnchain && el.decryptionProof?.verifiedOnchain).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <div className="flex items-center justify-between">
        <LiveRefresh label="En vivo" intervalMs={15000} />
        <div style={{ fontSize: "0.6875rem", color: "#94a3b8", background: "#f8fafc", padding: "0.25rem 0.625rem", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
          API: {apiBase.replace(/^https?:\/\//, "")}
        </div>
      </div>

      {electionsRes === null ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>No se pudo conectar con la API de evidencias.</p>
        </div>
      ) : electionsDetailed.length === 0 ? (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.875rem", color: "#64748b" }}>No hay elecciones registradas todavía.</p>
        </div>
      ) : (
        <>
          {/* Executive Summary */}
          <section className="card" style={{ padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6366f1" }}>Resumen ejecutivo</div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#0f172a", marginTop: "0.35rem" }}>Estado general del sistema observado</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.875rem", marginTop: "1rem" }}>
              <div className="stat-card">
                <span style={{ fontSize: "0.6875rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Elecciones</span>
                <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{globalElectionCount}</span>
              </div>
              <div className="stat-card">
                <span style={{ fontSize: "0.6875rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Incidentes activos</span>
                <span style={{ fontSize: "1.5rem", fontWeight: 800, color: globalActiveIncidents > 0 ? "#b91c1c" : "#0f172a" }}>{globalActiveIncidents}</span>
              </div>
              <div className="stat-card">
                <span style={{ fontSize: "0.6875rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Auditorías abiertas</span>
                <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{globalAuditOpen}</span>
              </div>
              <div className="stat-card">
                <span style={{ fontSize: "0.6875rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Cierre ZK completo</span>
                <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>{globalZkVerified}</span>
              </div>
            </div>
          </section>

          {/* Election Cards */}
          {electionsDetailed.map((e) => (
            <ElectionDetail key={e.electionId} election={e} />
          ))}
        </>
      )}

      <footer style={{ borderTop: "1px solid #e2e8f0", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>BlockUrna · Observatorio Electoral BU‑PVP‑1 · Evidencia verificable</p>
      </footer>
    </div>
  );
}
