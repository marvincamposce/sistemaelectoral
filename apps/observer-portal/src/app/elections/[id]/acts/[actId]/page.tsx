import Link from "next/link";

import { getPublicEnv } from "../../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActMetaResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  act: {
    actId: string;
    electionId: string;
    actType: string;
    canonicalJson: any | null;
    signature: string | null;
    signerKeyId: string | null;
    signerPublicKey: string | null;
    contentHash: string | null;
    anchorTxHash: string | null;
    blockNumber: string | null;
    blockTimestamp: string | null;
    createdAt: string | null;
  };
};

type ActContentResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  signedJson: unknown;
};

type ActVerifyResponse = {
  ok: boolean;
  electionId: string;
  actId: string;
  signatureValid: boolean;
  hashMatchesAnchor: boolean;
  anchorFoundOnChain: boolean;
  consistencyStatus: string;
  verificationStatus?: string;
  signatureScheme?: string | null;
  errorDetails?: string | null;
  recoveredSignerAddress?: string | null;
  expectedSignerAddress?: string | null;
  signerRole?: string | null;
  contentHash?: string | null;
  signingDigest?: string | null;
};

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

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ts; }
}

export default async function ActPage({
  params,
}: {
  params: Promise<{ id: string; actId: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const electionId = String(resolvedParams.id);
  const actId = String(resolvedParams.actId).toLowerCase();

  const meta = await safeFetchJson<ActMetaResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}`,
    null,
  );

  if (!meta || !meta.ok) {
    return (
      <main className="min-h-screen" style={{ background: "#f8fafc" }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem" }}>
          <nav style={{ marginBottom: "1.5rem" }}>
            <Link href="/" className="btn-subtle">← Volver al observatorio</Link>
          </nav>
          <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
            <span style={{ fontSize: "2rem", marginBottom: "1rem", display: "block" }}>🔍</span>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#0f172a", marginBottom: "0.5rem" }}>
              Acta no encontrada
            </h1>
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>
              La Evidence API no tiene un anchor ni contenido para este <code style={{ background: "#f1f5f9", padding: "0.125rem 0.375rem", borderRadius: "4px", fontSize: "0.75rem" }}>actId</code>.
            </p>
            <p className="hash-display" style={{ marginTop: "0.75rem" }}>{actId}</p>
          </div>
        </div>
      </main>
    );
  }

  const verify = await safeFetchJson<ActVerifyResponse>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/verify`,
    {
      ok: true, electionId, actId,
      signatureValid: false, hashMatchesAnchor: false,
      anchorFoundOnChain: false, consistencyStatus: "UNKNOWN",
    },
  );

  const content = await safeFetchJson<ActContentResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/content`,
    null,
  );

  const contentAvailable = Boolean(content && content.ok);

  const isLegacyScheme = verify.signatureScheme != null &&
    verify.signatureScheme !== "ECDSA_SECP256K1_ETH_V1";

  const badge = (() => {
    if (verify.verificationStatus === "VALID") return "VÁLIDA";
    if (!contentAvailable) return "INCOMPLETA";
    if (isLegacyScheme) return "LEGACY";
    if (!verify.anchorFoundOnChain) return "SIN ANCHOR";
    if (verify.signatureValid && verify.hashMatchesAnchor && verify.consistencyStatus === "OK") {
      return "VÁLIDA";
    }
    return "INVÁLIDA";
  })();

  const badgeClass =
    badge === "VÁLIDA" ? "badge badge-valid"
    : badge === "LEGACY" ? "badge badge-info"
    : badge === "INCOMPLETA" || badge === "SIN ANCHOR" ? "badge badge-warning"
    : "badge badge-critical";

  const downloadUrl = `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/acts/${encodeURIComponent(actId)}/content`;

  const actType = meta.act.actType;

  return (
    <main className="min-h-screen" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <header style={{ background: "white", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 50 }}>
        <div className="mx-auto" style={{ maxWidth: "960px", padding: "1rem 1.5rem" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ fontSize: "1.5rem" }}>{ACTA_TYPE_ICONS[actType] ?? "📄"}</span>
              <div>
                <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
                  {ACTA_TYPE_LABELS[actType] ?? actType}
                </h1>
                <p style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>
                  Elección #{electionId}
                </p>
              </div>
            </div>
            <span className={badgeClass}>{badge}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto" style={{ maxWidth: "960px", padding: "2rem 1.5rem 4rem" }}>
        <nav style={{ marginBottom: "1.5rem" }}>
          <Link href="/" className="btn-subtle">← Volver al observatorio</Link>
        </nav>

        {/* Legacy scheme notice */}
        {isLegacyScheme && (
          <div className="info-note" style={{ marginBottom: "1.5rem", borderLeft: "3px solid #6366f1" }}>
            <p style={{ fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
              Esquema de firma legacy: {verify.signatureScheme}
            </p>
            <p>
              Esta acta fue firmada con un esquema anterior (Ed25519) que no es verificable por el motor ECDSA actual.
              Para obtener actas con verificación completa, crea una nueva elección — las actas generadas ahora usarán ECDSA SECP256K1.
            </p>
          </div>
        )}

        {/* Verification Summary */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "1rem" }}>Verificación criptográfica</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <VerifyItem label="Firma" value={verify.signatureValid} scheme={verify.signatureScheme} />
            <VerifyItem label="Hash coincide con anchor" value={verify.hashMatchesAnchor} />
            <VerifyItem label="Anchor en la cadena" value={verify.anchorFoundOnChain} />
            <div>
              <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Consistencia</span>
              <div style={{ marginTop: "0.25rem" }}>
                <span className={`badge ${verify.consistencyStatus === "OK" ? "badge-valid" : verify.consistencyStatus === "UNKNOWN" ? "badge-neutral" : "badge-warning"}`}>
                  {verify.consistencyStatus}
                </span>
              </div>
            </div>
          </div>
          {verify.errorDetails && (
            <div className="info-note" style={{ marginTop: "1rem" }}>
              <span style={{ fontWeight: 500 }}>Detalle: </span>{verify.errorDetails}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 className="section-title" style={{ marginBottom: "1rem" }}>Metadatos del acta</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.75rem" }}>
            <MetaRow label="Tipo" value={ACTA_TYPE_LABELS[actType] ?? actType} />
            <MetaRow label="Act ID" value={meta.act.actId} mono />
            <MetaRow label="Content Hash" value={meta.act.contentHash ?? "(sin contenido)"} mono />
            <MetaRow label="Firma" value={meta.act.signature ?? "(sin contenido)"} mono />
            <MetaRow label="Signer Public Key" value={meta.act.signerPublicKey ?? "(sin contenido)"} mono />
            <MetaRow label="Signer Key ID" value={meta.act.signerKeyId ?? "(sin contenido)"} mono />
            <MetaRow label="Anchor Tx" value={meta.act.anchorTxHash ?? "(sin anchor)"} mono />
            <MetaRow label="Bloque" value={meta.act.blockNumber ?? "(sin anchor)"} />
            <MetaRow label="Timestamp" value={formatTimestamp(meta.act.blockTimestamp)} />
            <MetaRow label="Creado" value={formatTimestamp(meta.act.createdAt)} />
          </div>
        </div>

        {/* Signed JSON */}
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: "1rem" }}>
            <h2 className="section-title" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>JSON firmado</h2>
            <a className="btn-subtle" href={downloadUrl} target="_blank" rel="noreferrer">
              Descargar JSON ↗
            </a>
          </div>
          {contentAvailable ? (
            <pre
              style={{
                fontSize: "0.6875rem",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "1rem",
                color: "#334155",
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                maxHeight: "500px",
                overflow: "auto",
              }}
            >
              {JSON.stringify(content!.signedJson, null, 2)}
            </pre>
          ) : (
            <p style={{ fontSize: "0.8125rem", color: "#94a3b8" }}>Sin contenido firmado disponible.</p>
          )}
        </div>

        {/* Canonical JSON */}
        {meta.act.canonicalJson && (
          <div className="card" style={{ padding: "1.25rem 1.5rem" }}>
            <h2 className="section-title" style={{ marginBottom: "1rem" }}>Canonical JSON (snapshot)</h2>
            <pre
              style={{
                fontSize: "0.6875rem",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "1rem",
                color: "#334155",
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                maxHeight: "500px",
                overflow: "auto",
              }}
            >
              {JSON.stringify(meta.act.canonicalJson, null, 2)}
            </pre>
          </div>
        )}
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

function VerifyItem({ label, value, scheme }: { label: string; value: boolean; scheme?: string | null }) {
  const isLegacy = scheme != null && scheme !== "ECDSA_SECP256K1_ETH_V1";
  return (
    <div>
      <span style={{ fontSize: "0.6875rem", color: "#94a3b8", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {scheme && <div style={{ fontSize: "0.6rem", color: "#94a3b8", marginTop: "0.125rem" }}>{scheme}</div>}
      <div style={{ marginTop: "0.25rem" }}>
        {isLegacy ? (
          <span className="badge badge-neutral">N/A (legacy)</span>
        ) : (
          <span className={`badge ${value ? "badge-valid" : "badge-critical"}`}>
            {value ? "✓ Válido" : "✗ Inválido"}
          </span>
        )}
      </div>
    </div>
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
