import Link from "next/link";

type ElectionHeaderProps = {
  electionIdStr: string;
  chainId: string;
  contractAddress: string;
  apiUrl: string;
  phasesRes: any;
  phaseChangesRes: any;
  anchorsRes: any;
  actsRes: any;
  activeIncidents: any[];
  evidenceApiUnavailable: boolean;
};

function phaseBadgeClass(label: string | undefined): string {
  const value = String(label ?? "").toUpperCase();
  if (value.includes("RESULTS") || value.includes("AUDIT") || value.includes("ARCHIVE")) {
    return "admin-badge admin-badge-valid";
  }
  if (value.includes("VOTING") || value.includes("REGISTRY") || value.includes("PROCESSING") || value.includes("TALLY")) {
    return "admin-badge admin-badge-warning";
  }
  return "admin-badge admin-badge-info";
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export function ElectionHeader({
  electionIdStr,
  chainId,
  contractAddress,
  apiUrl,
  phasesRes,
  phaseChangesRes,
  anchorsRes,
  actsRes,
  activeIncidents,
  evidenceApiUnavailable,
}: ElectionHeaderProps) {
  return (
    <div className="space-y-6">
      <header className="admin-card surface-noise overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">Elección #{electionIdStr}</h1>
                <span className={phasesRes?.ok ? phaseBadgeClass(phasesRes.election.phaseLabel) : "admin-badge admin-badge-critical"}>
                  {phasesRes?.ok ? phasesRes.election.phaseLabel : "PHASE N/A"}
                </span>
              </div>
              <p className="max-w-3xl text-sm text-slate-300">
                Consola operativa de la elección, con evidencia materializada y controles administrativos.
              </p>
            </div>
            <Link className="admin-btn-outline border-white/20 text-white hover:bg-white/10" href="/">
              Volver a consola
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">chainId={chainId}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 break-all">contract={contractAddress}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 break-all">API={apiUrl}</span>
          </div>
        </div>

        {evidenceApiUnavailable ? (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-900">
            Algunas vistas de evidencia no están disponibles. La consola no está sustituyendo ese fallo por contadores o listas vacías.
          </div>
        ) : null}

        <div className="grid gap-3 border-t border-slate-200 bg-white/95 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="admin-stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Transiciones</span>
            <span className="text-2xl font-semibold text-slate-900">{phaseChangesRes?.phaseChanges?.length ?? "N/D"}</span>
          </article>
          <article className="admin-stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Anchors</span>
            <span className="text-2xl font-semibold text-slate-900">{anchorsRes?.anchors?.length ?? "N/D"}</span>
          </article>
          <article className="admin-stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Actas</span>
            <span className="text-2xl font-semibold text-slate-900">{actsRes?.acts?.length ?? "N/D"}</span>
          </article>
          <article className="admin-stat-card">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Incidentes activos</span>
            <span className="text-2xl font-semibold text-slate-900">{activeIncidents.length}</span>
          </article>
        </div>
      </header>

      {phasesRes?.ok && (
        <section className="admin-card p-4 space-y-3">
          <div className="admin-section-title">Estado On-Chain</div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">manifestHash</div>
                <div className="hash-display" title={phasesRes.election.manifestHash}>{shortHash(phasesRes.election.manifestHash)}</div>
              </div>
              <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">coordinatorPubKey</div>
                <div className="hash-display" title={phasesRes.election.coordinatorPubKey}>{shortHash(phasesRes.election.coordinatorPubKey)}</div>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="text-xs text-slate-700 break-all">Autoridad AEA: {phasesRes.election.authority}</div>
              <div className="text-xs text-slate-700 break-all">Autoridad REA: {phasesRes.election.registryAuthority}</div>
              <div className="text-xs text-slate-700">creada: {formatTimestamp(phasesRes.election.createdAtTimestamp)}</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
