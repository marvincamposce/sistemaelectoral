import Link from "next/link";
import { LiveRefresh } from "../LiveRefresh";

export function HondurasHeader({
  chainId,
  contractAddress,
  apiUrl,
  electionsCount,
  recentEligibleCount,
  pendingEnrollments,
  activeRecentAuthorizations,
}: {
  chainId: string;
  contractAddress: string;
  apiUrl: string;
  electionsCount: number;
  recentEligibleCount: number;
  pendingEnrollments: number;
  activeRecentAuthorizations: number;
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="admin-page-title m-0">Honduras: Autorización Electoral</h1>
          <p className="admin-page-subtitle">
            Flujo operativo para consultar DNI, administrar expedientes y autorizar ciudadanía por elección de forma trazable.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link
            className="admin-btn-outline text-xs py-1.5 px-3"
            href="/"
          >
            Volver a consola
          </Link>
          <LiveRefresh label="Panel en vivo" intervalMs={15000} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <span className="admin-hash">chainId={chainId}</span>
        <span className="admin-hash">contract={contractAddress}</span>
        <span className="admin-hash">API={apiUrl}/v1/hn/eligibility/:dni</span>
      </div>

      <div className="admin-stat-grid">
        <article className="admin-stat-card border-t-4 border-t-cyan-500">
          <div className="admin-stat-label text-cyan-600">Elecciones indexadas</div>
          <div className="admin-stat-value">{electionsCount}</div>
          <div className="text-xs text-slate-500 mt-2">desde Evidence API</div>
        </article>

        <article className="admin-stat-card border-t-4 border-t-emerald-500">
          <div className="admin-stat-label text-emerald-600">Expedientes habilitados</div>
          <div className="admin-stat-value">{recentEligibleCount}</div>
          <div className="text-xs text-slate-500 mt-2">en últimos registros</div>
        </article>

        <article className="admin-stat-card border-t-4 border-t-amber-500">
          <div className="admin-stat-label text-amber-600">Pendientes de revisión</div>
          <div className="admin-stat-value">{pendingEnrollments}</div>
          <div className="text-xs text-slate-500 mt-2">solicitudes de enrolamiento</div>
        </article>

        <article className="admin-stat-card border-t-4 border-t-indigo-500">
          <div className="admin-stat-label text-indigo-600">Autorizaciones activas</div>
          <div className="admin-stat-value">{activeRecentAuthorizations}</div>
          <div className="text-xs text-slate-500 mt-2">en ventana reciente</div>
        </article>
      </div>
    </div>
  );
}
