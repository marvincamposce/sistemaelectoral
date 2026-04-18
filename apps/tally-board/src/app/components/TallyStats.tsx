export function TallyStats({
  relevantElectionsCount,
}: {
  relevantElectionsCount: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 mt-8">
      <article className="tb-stat-box">
        <div className="tb-stat-label">Elecciones en Cola</div>
        <div className="tb-stat-value">{relevantElectionsCount}</div>
      </article>
      <article className="tb-stat-box">
        <div className="tb-stat-label">Fases Habilitadas</div>
        <div className="tb-stat-value font-mono text-[var(--color-neon-blue)]">5 ➔ 7</div>
      </article>
      <article className="tb-stat-box">
        <div className="tb-stat-label">Protocolo</div>
        <div className="tb-stat-value text-lg mt-1 font-mono tracking-widest text-[var(--color-neon-purple)]">ZK-TALLY</div>
      </article>
    </div>
  );
}
