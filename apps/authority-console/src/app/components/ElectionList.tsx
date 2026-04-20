import Link from "next/link";

export type ElectionListProps = {
  elections: Array<{
    electionId: string;
    phase: number;
    phaseLabel?: string;
    counts?: { signups: number; ballots: number };
  }>;
  phaseLabelEs: (label: string | undefined, phase: number) => string;
};

export function ElectionList({ elections, phaseLabelEs }: ElectionListProps) {
  return (
    <div className="card">
      <div className="admin-card-header">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Elecciones recientes</h2>
        <Link href="/honduras" className="btn-subtle">Ver todas</Link>
      </div>
      <div className="p-0">
        {elections.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No hay elecciones registradas aún.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {elections.map(e => (
              <Link
                key={e.electionId}
                href={`/elections/${encodeURIComponent(e.electionId)}/dashboard`}
                className="block px-5 py-4 hover:bg-slate-50/50 transition-colors group"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <div className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    Elección #{e.electionId}
                  </div>
                  <span className={`badge ${e.phase >= 5 ? 'badge-valid' : 'badge-info'}`}>
                    {phaseLabelEs(e.phaseLabel, e.phase)}
                  </span>
                </div>
                <div className="flex gap-3">
                  <span className="text-xs text-slate-400">{e.counts?.signups ?? 0} inscritos</span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs text-slate-400">{e.counts?.ballots ?? 0} boletas</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
