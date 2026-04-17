import Link from "next/link";

import { getPublicEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PhasesResponse = {
  ok: boolean;
  election: {
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
  };
};

type SignupsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueNullifiers: number };
};

type SignupsListResponse = {
  ok: boolean;
  electionId: string;
  page: null | { limit: number; order: "asc" | "desc"; nextCursor: string | null };
  signups: Array<{
    registryNullifier: string;
    votingPubKey: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
    permit:
      | null
      | {
          credentialId: string | null;
          issuerAddress: string | null;
          permitSig: string;
          issuedAt: string | null;
          recordedAt: string | null;
        };
    validity: {
      status: "VALID" | "UNVERIFIED" | "INVALID";
      reason: string | null;
      recoveredIssuerAddress: string | null;
      error?: string;
    };
  }>;
};

function validityBadge(status: string): { label: string; className: string } {
  const s = String(status ?? "").toUpperCase();
  if (s === "VALID") return { label: "VÁLIDA", className: "badge badge-valid" };
  if (s === "UNVERIFIED") return { label: "SIN BITÁCORA", className: "badge badge-neutral" };
  return { label: "INVÁLIDA", className: "badge badge-critical" };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return null;
  }
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ts; }
}

export default async function SignupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  const electionId = String(resolvedParams.id);
  const cursor = typeof resolvedSearchParams.cursor === "string" ? resolvedSearchParams.cursor : null;

  const election = await fetchJsonOrNull<PhasesResponse>(`${apiBase}/v1/elections/${encodeURIComponent(electionId)}/phases`);

  if (!election || !election.ok) {
    return (
      <main className="min-h-screen" style={{ background: "#f8fafc" }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem" }}>
          <nav style={{ marginBottom: "1.5rem" }}>
            <Link href="/" className="btn-subtle">← Volver al observatorio</Link>
          </nav>
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#0f172a" }}>Elección no encontrada</h1>
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8", marginTop: "0.5rem" }}>
              La Evidence API no tiene metadatos para esta elección.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const [summary, list] = await Promise.all([
    fetchJsonOrNull<SignupsSummaryResponse>(`${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups/summary`),
    fetchJsonOrNull<SignupsListResponse>(`${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups?order=desc&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  ]);

  const dataUnavailable = summary == null || list == null;
  const page = list?.page ?? null;
  const nextCursor = page?.nextCursor ?? null;
  const recent = (list?.signups ?? []).slice(0, 10);

  return (
    <main className="min-h-screen" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <header style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 50 }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "1rem 1.5rem" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ fontSize: "1.5rem" }}>📝</span>
              <div>
                <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
                  Registros electorales
                </h1>
                <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                  Elección #{electionId}
                </p>
              </div>
            </div>
            <span className="phase-pill">
              <span className="phase-dot" />
              {election.election.phaseLabel}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem 4rem" }}>
        <nav style={{ marginBottom: "1.5rem" }}>
          <Link href="/" className="btn-subtle">← Volver al observatorio</Link>
        </nav>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.875rem", marginBottom: "2rem" }}>
          <div className="stat-card">
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total registros
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a" }}>
              {summary?.summary.total ?? "N/D"}
            </span>
          </div>
          <div className="stat-card">
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Nullifiers únicos
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a" }}>
              {summary?.summary.uniqueNullifiers ?? "N/D"}
            </span>
          </div>
          <div className="stat-card">
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Autoridad REA
            </span>
            <span className="hash-display" style={{ marginTop: "0.25rem", fontSize: "0.625rem" }}>
              {election.election.registryAuthority}
            </span>
          </div>
        </div>

        {/* Recent signups timeline */}
        {dataUnavailable ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center", marginBottom: "2.5rem" }}>
            <p style={{ fontSize: "0.8125rem", color: "#b45309" }}>
              La evidencia de registros no está disponible. Esta vista no interpreta el error como ausencia de signups.
            </p>
          </div>
        ) : recent.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <h2 className="section-title">Últimos registros</h2>
            <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {recent.map((s) => {
                  const badge = validityBadge(s.validity?.status);
                  return (
                    <div key={`${s.txHash}:${s.logIndex}`} className="timeline-item phase" style={{ paddingBottom: "1rem" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                            Bloque {s.blockNumber} {s.blockTimestamp ? `· ${formatTimestamp(s.blockTimestamp)}` : ""}
                          </div>
                          <div style={{ marginTop: "0.25rem" }}>
                            <span style={{ fontSize: "0.6875rem", color: "#64748b" }}>Nullifier: </span>
                            <span className="hash-display">{s.registryNullifier}</span>
                          </div>
                          <div style={{ marginTop: "0.25rem" }}>
                            <span className="hash-display" style={{ fontSize: "0.625rem" }}>{s.txHash}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                          <span className={badge.className}>{badge.label}</span>
                          <Link
                            className="btn-subtle"
                            href={`/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(s.txHash)}/${encodeURIComponent(String(s.logIndex))}`}
                          >
                            Ver ↗
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Full table */}
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 className="section-title">Tabla completa (paginada)</h2>
          {dataUnavailable ? null : list.signups.length === 0 ? (
            <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
              <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin registros.</p>
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {list.signups.map((s) => {
                const badge = validityBadge(s.validity?.status);
                const evidenceUrl = `/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(s.txHash)}/${encodeURIComponent(String(s.logIndex))}`;
                return (
                  <div key={`${s.txHash}:${s.logIndex}`} className="incident-row" style={{ flexDirection: "column", gap: "0.5rem" }}>
                    <div className="flex items-center justify-between" style={{ width: "100%" }}>
                      <div className="flex items-center gap-2">
                        <span className={badge.className}>{badge.label}</span>
                        <span style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                          Bloque {s.blockNumber} · {formatTimestamp(s.blockTimestamp)}
                        </span>
                      </div>
                      <Link className="btn-subtle" href={evidenceUrl}>Ver evidencia ↗</Link>
                    </div>
                    <div style={{ fontSize: "0.6875rem" }}>
                      <span style={{ color: "#94a3b8", fontWeight: 500 }}>Nullifier: </span>
                      <span className="hash-display">{s.registryNullifier}</span>
                    </div>
                    <div style={{ fontSize: "0.6875rem" }}>
                      <span style={{ color: "#94a3b8", fontWeight: 500 }}>Voting PubKey: </span>
                      <span className="hash-display">{s.votingPubKey}</span>
                    </div>
                    <div style={{ fontSize: "0.6875rem" }}>
                      <span style={{ color: "#94a3b8", fontWeight: 500 }}>Tx: </span>
                      <span className="hash-display">{s.txHash}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between" style={{ marginTop: "1rem", fontSize: "0.75rem" }}>
            <div style={{ color: "#94a3b8" }}>
              {cursor && <span className="hash-display" style={{ fontSize: "0.625rem" }}>cursor: {cursor}</span>}
            </div>
            <div className="flex items-center gap-3">
            {cursor && !dataUnavailable && (
              <Link className="btn-subtle" href={`/elections/${encodeURIComponent(electionId)}/signups`}>
                ← Inicio
              </Link>
            )}
            {nextCursor && !dataUnavailable ? (
              <Link className="btn-subtle" href={`/elections/${encodeURIComponent(electionId)}/signups?cursor=${encodeURIComponent(nextCursor)}`}>
                Siguiente →
              </Link>
            ) : (
                <span style={{ color: "#94a3b8" }}>(Fin)</span>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #e2e8f0", background: "white", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
          BlockUrna · Observatorio Electoral BU‑PVP‑1 · Evidencia verificable
        </p>
      </footer>
    </main>
  );
}
