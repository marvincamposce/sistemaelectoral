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
    <div className="admin-stat-grid">
      <div className="admin-stat-card">
        <div className="admin-stat-label">Elecciones Totales</div>
        <div className="admin-stat-value">{electionsTotal}</div>
      </div>
      <div className="admin-stat-card border-l-4 border-l-blue-500">
        <div className="admin-stat-label">Elecciones Activas</div>
        <div className="admin-stat-value text-blue-600">{electionsActive}</div>
      </div>
      <div className="admin-stat-card">
        <div className="admin-stat-label">Ciudadanos Inscritos</div>
        <div className="admin-stat-value">{totalSignups}</div>
      </div>
      <div className="admin-stat-card border-l-4 border-l-emerald-500">
        <div className="admin-stat-label">Votos Recibidos</div>
        <div className="admin-stat-value text-emerald-600">{totalBallots}</div>
      </div>
    </div>
  );
}
