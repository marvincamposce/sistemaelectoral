export function DashboardStats({
  electionsTotal,
  electionsActive,
  totalSignups,
  totalBallots,
}: {
  electionsTotal: number;
  electionsActive: number;
  totalSignups: number;
  totalBallots: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="stat-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Elecciones totales</div>
        <div className="text-2xl font-bold text-slate-900">{electionsTotal}</div>
      </div>
      <div className="stat-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Elecciones activas</div>
        <div className="text-2xl font-bold text-indigo-600">{electionsActive}</div>
      </div>
      <div className="stat-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ciudadanos inscritos</div>
        <div className="text-2xl font-bold text-slate-900">{totalSignups}</div>
      </div>
      <div className="stat-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Votos recibidos</div>
        <div className="text-2xl font-bold text-emerald-600">{totalBallots}</div>
      </div>
    </div>
  );
}
