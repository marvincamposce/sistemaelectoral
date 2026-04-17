import Link from "next/link";

import { getPublicEnv } from "../../../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SignupEvidenceResponse =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      chainId: string;
      contractAddress: string;
      electionId: string;
      signup: {
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
      };
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
    const text = await res.text().catch(() => "");
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
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

export default async function SignupEvidencePage({
  params,
}: {
  params: Promise<{ id: string; txHash: string; logIndex: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const electionId = String(resolvedParams.id);
  const txHash = String(resolvedParams.txHash).toLowerCase();
  const logIndex = String(resolvedParams.logIndex);

  const evidence = await fetchJsonOrNull<SignupEvidenceResponse>(`${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(txHash)}/${encodeURIComponent(logIndex)}`);

  if (!evidence || !evidence.ok) {
    return (
      <main className="min-h-screen" style={{ background: "#f8fafc" }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem" }}>
          <nav style={{ marginBottom: "1.5rem" }}>
            <Link href={`/elections/${encodeURIComponent(electionId)}/signups`} className="btn-subtle">← Volver a registros</Link>
          </nav>
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <span style={{ fontSize: "2rem", marginBottom: "1rem", display: "block" }}>🔍</span>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#0f172a", marginBottom: "0.5rem" }}>
              Registro no encontrado
            </h1>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
              tx: <span className="hash-display">{txHash}</span> · logIndex: {logIndex}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const s = evidence.signup;
  const badge = validityBadge(s.validity?.status);

  return (
    <main className="min-h-screen" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <header style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 50 }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "1rem 1.5rem" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ fontSize: "1.5rem" }}>🔐</span>
              <div>
                <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
                  Evidencia de registro
                </h1>
                <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                  Elección #{electionId}
                </p>
              </div>
            </div>
            <span className={badge.className}>{badge.label}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem 4rem" }}>
        <nav style={{ marginBottom: "1.5rem" }}>
          <Link href={`/elections/${encodeURIComponent(electionId)}/signups`} className="btn-subtle">← Volver a registros</Link>
        </nav>

        {/* On-chain data */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "1rem" }}>Datos on-chain (evento indexado)</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.75rem" }}>
            <MetaRow label="Tx Hash" value={s.txHash} mono />
            <MetaRow label="Log Index" value={String(s.logIndex)} />
            <MetaRow label="Bloque" value={s.blockNumber} />
            <MetaRow label="Timestamp" value={formatTimestamp(s.blockTimestamp)} />
            <MetaRow label="Registry Nullifier" value={s.registryNullifier} mono />
            <MetaRow label="Voting PubKey" value={s.votingPubKey} mono />
          </div>
        </div>

        {/* Validity */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "1rem" }}>Verificación de validez</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <div>
              <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Estado</span>
              <div style={{ marginTop: "0.375rem" }}>
                <span className={badge.className}>{badge.label}</span>
              </div>
            </div>
            <div>
              <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Motivo</span>
              <div style={{ marginTop: "0.375rem", fontSize: "0.8125rem", color: "#475569" }}>
                {s.validity.reason ?? "(ninguno)"}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Issuer recuperado</span>
              <div style={{ marginTop: "0.375rem" }}>
                <span className="hash-display">{s.validity.recoveredIssuerAddress ?? "(ninguno)"}</span>
              </div>
            </div>
            {s.validity.error && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Error</span>
                <div style={{ marginTop: "0.375rem", fontSize: "0.75rem", color: "#be123c" }}>
                  {s.validity.error}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Permit (REA Log) */}
        <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "1rem" }}>Bitácora REA (permit emitido)</h2>
          {s.permit ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.75rem" }}>
              <MetaRow label="Credential ID" value={s.permit.credentialId ?? "(desconocido)"} mono />
              <MetaRow label="Issuer Address" value={s.permit.issuerAddress ?? "(desconocido)"} mono />
              <MetaRow label="Emitido" value={formatTimestamp(s.permit.issuedAt)} />
              <MetaRow label="Registrado" value={formatTimestamp(s.permit.recordedAt)} />
              <MetaRow label="Permit Sig" value={s.permit.permitSig} mono />
            </div>
          ) : (
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
              Sin registro de emisión (el permit no fue registrado en la bitácora de la REA).
            </p>
          )}
        </div>
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

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
      <span style={{ color: "#94a3b8", fontWeight: 500, minWidth: "140px", flexShrink: 0 }}>{label}</span>
      {mono ? (
        <span className="hash-display">{value}</span>
      ) : (
        <span style={{ color: "#334155" }}>{value}</span>
      )}
    </div>
  );
}
