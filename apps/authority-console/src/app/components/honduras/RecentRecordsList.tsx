import { etiquetaEstado } from "@blockurna/shared";

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("es-HN", {
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

function statusBadgeClass(status: string): string {
  const value = String(status).toUpperCase();
  if (value === "HABILITADO" || value === "ACTIVE" || value === "AUTHORIZED") return "admin-badge admin-badge-success";
  if (value === "INHABILITADO" || value === "SUSPENDIDO" || value === "REVOKED" || value === "REJECTED") {
    return "admin-badge admin-badge-error";
  }
  if (value === "APPROVED") return "admin-badge admin-badge-info";
  return "admin-badge admin-badge-warning";
}

export function RecentRecordsList({
  recentRecords,
}: {
  recentRecords: any[];
}) {
  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h2 className="admin-section-title m-0">Últimos expedientes cargados</h2>
      </div>
      <div className="admin-card-body p-0">
        <div className="divide-y divide-slate-100">
          {recentRecords.map((row) => (
            <div key={row.dni} className="p-4 hover:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start mb-1">
                <div>
                  <div className="font-semibold text-slate-900">{row.fullName}</div>
                  <div className="text-xs text-slate-500 font-mono">{row.dni}</div>
                </div>
                <span className={statusBadgeClass(row.habilitationStatus)}>
                  {etiquetaEstado(row.habilitationStatus)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">
                fuente={row.source} · actualizado={formatTimestamp(row.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
