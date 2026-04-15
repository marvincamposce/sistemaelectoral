import Link from "next/link";
import { getPublicEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PhasesResponse = {
  ok: boolean;
  election: {
    electionId: string;
    phaseLabel: string;
    registryAuthority: string;
  };
};

type BallotsSummaryResponse = {
  ok: boolean;
  summary: { total: number };
};

type BallotsListResponse = {
  ok: boolean;
  electionId: string;
  page: null | { limit: number; order: "asc" | "desc"; nextCursor: string | null };
  ballots: Array<{
    index: number;
    ballotHash: string;
    ciphertext: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Evidence API error: ${res.status}`);
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
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

export default async function BallotsPage({
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

  const election = await safeFetchJson<PhasesResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/phases`,
    null,
  );

  if (!election || !election.ok) {
    return (
      <main className="min-h-screen" style={{ background: "#f8fafc" }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem" }}>
          <nav style={{ marginBottom: "1.5rem" }}>
            <Link href="/" className="btn-subtle">← Volver al observatorio</Link>
          </nav>
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#0f172a" }}>Elección no encontrada</h1>
          </div>
        </div>
      </main>
    );
  }

  const [summary, list] = await Promise.all([
    safeFetchJson<BallotsSummaryResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/ballots/summary`,
      { ok: true, summary: { total: 0 } },
    ),
    safeFetchJson<BallotsListResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/ballots?order=desc&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { ok: true, electionId, page: { limit: 50, order: "desc", nextCursor: null }, ballots: [] },
    ),
  ]);

  const page = list.page;
  const nextCursor = page?.nextCursor ?? null;

  return (
    <main className="min-h-screen" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <header style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 50 }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "1rem 1.5rem" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ fontSize: "1.5rem" }}>🗳️</span>
              <div>
                <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
                  Urna Virtual — Boletas
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

        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.875rem", marginBottom: "2rem" }}>
          <div className="stat-card">
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total publicadas
            </span>
            <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a" }}>
              {summary.summary.total}
            </span>
          </div>
          {page && (
            <div className="stat-card">
              <span style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Página actual
              </span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#475569" }}>
                Orden: {page.order} · Límite: {page.limit}
              </span>
            </div>
          )}
        </div>

        {/* Ballots Table */}
        <h2 className="section-title">Evidencia pública de publicación</h2>
        {list.ballots.length === 0 ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin boletas publicadas.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden", marginBottom: "1.5rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>#</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ballot Hash</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bloque</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Timestamp</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", color: "#94a3b8", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {list.ballots.map((b) => (
                  <tr key={`${b.txHash}:${b.logIndex}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.75rem 1rem", color: "#0f172a", fontWeight: 600 }}>{b.index}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span className="hash-display">{b.ballotHash}</span>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "#64748b" }}>{b.blockNumber}</td>
                    <td style={{ padding: "0.75rem 1rem", color: "#64748b", fontSize: "0.6875rem" }}>{formatTimestamp(b.blockTimestamp)}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span className="hash-display">{b.txHash}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Ciphertext expandable per ballot */}
            {list.ballots.map((b) => (
              <details key={`cipher-${b.txHash}:${b.logIndex}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                <summary style={{ padding: "0.5rem 1rem", fontSize: "0.6875rem", color: "#6366f1", fontWeight: 500, cursor: "pointer" }}>
                  Ciphertext boleta #{b.index}
                </summary>
                <div style={{ padding: "0.5rem 1rem 1rem", fontSize: "0.625rem", fontFamily: "monospace", color: "#64748b", wordBreak: "break-all", lineHeight: 1.6 }}>
                  {b.ciphertext}
                </div>
              </details>
            ))}
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between" style={{ fontSize: "0.75rem" }}>
          <div style={{ color: "#94a3b8" }}>
            {cursor && <span className="hash-display" style={{ fontSize: "0.625rem" }}>cursor: {cursor}</span>}
          </div>
          <div className="flex items-center gap-3">
            {cursor && (
              <Link className="btn-subtle" href={`/elections/${encodeURIComponent(electionId)}/ballots`}>
                ← Inicio
              </Link>
            )}
            {nextCursor ? (
              <Link className="btn-subtle" href={`/elections/${encodeURIComponent(electionId)}/ballots?cursor=${encodeURIComponent(nextCursor)}`}>
                Siguiente →
              </Link>
            ) : (
              <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>(Fin)</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #e2e8f0", background: "white", padding: "1.5rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
          BlockUrna · Observatorio Electoral BU‑PVP‑1 · Instancia experimental de investigación
        </p>
      </footer>
    </main>
  );
}
