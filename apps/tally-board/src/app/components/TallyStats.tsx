export function TallyStats({
  relevantElectionsCount,
}: {
  relevantElectionsCount: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 mt-8">
      <article className="stat-card">
        <div className="admin-stat-label">Elecciones en Cola</div>
        <div className="admin-stat-value">{relevantElectionsCount}</div>
      </article>
      <article className="stat-card">
        <div className="admin-stat-label">Fases Habilitadas</div>
        <div className="admin-stat-value font-mono text-indigo-600">5 ➔ 7</div>
      </article>
      <article className="stat-card">
        <div className="admin-stat-label">Protocolo</div>
        <div className="admin-stat-value text-lg mt-1 font-mono tracking-widest text-indigo-600">ZK-TALLY</div>
      </article>
    </div>
  );
}
