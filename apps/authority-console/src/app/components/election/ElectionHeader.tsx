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

const PHASE_LABELS_ES: Record<string, string> = {
  SETUP: "Preparación", REGISTRY_OPEN: "Registro abierto", REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votación abierta", VOTING_CLOSED: "Votación cerrada", PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio", RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW_OPEN: "Auditoría abierta", ARCHIVED: "Archivada",
};

function phaseToSpanish(label: string | undefined): string {
  return PHASE_LABELS_ES[String(label ?? "").toUpperCase()] ?? label ?? "Desconocida";
}

function phaseBadgeClass(label: string | undefined): string {
  const value = String(label ?? "").toUpperCase();
  if (value.includes("RESULTS") || value.includes("AUDIT") || value.includes("ARCHIVE"))
    return "badge badge-valid";
  if (value.includes("VOTING") || value.includes("REGISTRY") || value.includes("PROCESSING") || value.includes("TALLY"))
    return "badge badge-warning";
  return "badge badge-info";
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ts; }
}

export function ElectionHeader({
  electionIdStr, chainId, contractAddress, apiUrl,
  phasesRes, phaseChangesRes, anchorsRes, actsRes,
  activeIncidents, evidenceApiUnavailable,
}: ElectionHeaderProps) {
  const election = phasesRes?.ok ? phasesRes.election : null;
  const phaseLabel = election?.phaseLabel;

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <header className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Elección #{electionIdStr}</h1>
              <span className={election ? phaseBadgeClass(phaseLabel) : "badge badge-critical"}>
                {election ? phaseToSpanish(phaseLabel) : "Sin conexión"}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Panel de control operativo — gestiona fases, catálogo, evidencia y auditoría.
            </p>
          </div>
          <Link className="btn-subtle" href="/">
            ← Volver al panel
          </Link>
        </div>
      </header>

      {evidenceApiUnavailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Algunos datos de evidencia no están disponibles en este momento.
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="stat-card">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cambios de fase</span>
          <span className="text-2xl font-bold text-slate-900">{phaseChangesRes?.phaseChanges?.length ?? "—"}</span>
        </article>
        <article className="stat-card">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Evidencias ancladas</span>
          <span className="text-2xl font-bold text-slate-900">{anchorsRes?.anchors?.length ?? "—"}</span>
        </article>
        <article className="stat-card">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actas publicadas</span>
          <span className="text-2xl font-bold text-slate-900">{actsRes?.acts?.length ?? "—"}</span>
        </article>
        <article className="stat-card">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Incidentes activos</span>
          <span className={`text-2xl font-bold ${activeIncidents.length > 0 ? "text-rose-600" : "text-slate-900"}`}>
            {activeIncidents.length}
          </span>
        </article>
      </div>

      {/* On-Chain Details — Collapsible */}
      {election && (
        <details className="card group">
          <summary className="px-5 py-3.5 cursor-pointer flex items-center justify-between hover:bg-slate-50 transition-colors rounded-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Detalles técnicos on-chain</span>
            <svg className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="px-5 pb-5 space-y-3 border-t border-slate-100 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-lg bg-slate-50 p-3 border border-slate-100">
                <div className="text-xs font-semibold text-slate-500">Huella del manifiesto</div>
                <div className="hash-display" title={election.manifestHash}>{shortHash(election.manifestHash)}</div>
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-3 border border-slate-100">
                <div className="text-xs font-semibold text-slate-500">Clave del coordinador ZK</div>
                <div className="hash-display" title={election.coordinatorPubKey}>{shortHash(election.coordinatorPubKey)}</div>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3 text-xs text-slate-500">
              <div><span className="font-semibold">Autoridad AEA:</span> <span className="hash-display">{shortHash(election.authority)}</span></div>
              <div><span className="font-semibold">Autoridad REA:</span> <span className="hash-display">{shortHash(election.registryAuthority)}</span></div>
              <div><span className="font-semibold">Creada:</span> {formatTimestamp(election.createdAtTimestamp)}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400 pt-2 border-t border-slate-100">
              <span className="badge badge-neutral">Red: {chainId}</span>
              <span className="badge badge-neutral font-mono">{shortHash(contractAddress)}</span>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
