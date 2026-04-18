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
    <div className="admin-card">
      <div className="admin-card-header">
        <h2 className="admin-section-title mb-0">Elecciones Recientes</h2>
        <Link href="/honduras" className="admin-btn-outline !py-1 !px-3 !text-xs">
          Ver Todo
        </Link>
      </div>
      <div className="admin-card-body p-0">
        {elections.length === 0 ? (
          <div className="p-8 text-center text-slate-500 italic">No hay elecciones indexadas.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {elections.map(e => (
              <div key={e.electionId} className="p-5 hover:bg-slate-50 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-lg text-slate-800">Elección #{e.electionId}</div>
                    <div className="text-sm text-slate-500 mt-1">{phaseLabelEs(e.phaseLabel, e.phase)}</div>
                  </div>
                  <span className={`admin-badge ${e.phase >= 5 ? 'admin-badge-success' : 'admin-badge-info'}`}>
                    Fase {e.phase}
                  </span>
                </div>
                <div className="flex gap-4 mb-4">
                  <div className="bg-white border border-slate-200 rounded px-3 py-1.5 text-xs font-semibold text-slate-600">
                    {e.counts?.signups ?? 0} Inscritos
                  </div>
                  <div className="bg-white border border-slate-200 rounded px-3 py-1.5 text-xs font-semibold text-slate-600">
                    {e.counts?.ballots ?? 0} Boletas
                  </div>
                </div>
                <Link href={`/elections/${encodeURIComponent(e.electionId)}`} className="text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center gap-1">
                  Gestionar Operación &rarr;
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
