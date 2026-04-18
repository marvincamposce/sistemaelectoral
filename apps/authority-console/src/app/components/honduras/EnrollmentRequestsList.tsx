import { etiquetaCanalSolicitud } from "@blockurna/shared";

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

export function EnrollmentRequestsList({
  enrollmentRequests,
  reviewEnrollmentRequestAction,
  createCensusFromEnrollmentRequestAction,
}: {
  enrollmentRequests: any[];
  reviewEnrollmentRequestAction: (formData: FormData) => Promise<void>;
  createCensusFromEnrollmentRequestAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h2 className="admin-section-title m-0">Solicitudes de enrolamiento</h2>
      </div>
      <div className="admin-card-body p-0">
        <div className="divide-y divide-slate-100">
          {enrollmentRequests.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No hay solicitudes pendientes.
            </div>
          ) : (
            enrollmentRequests.map((req) => (
              <div key={req.requestId} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="mb-2">
                  <div className="font-semibold text-slate-900">DNI {req.dni}</div>
                  <div className="text-[11px] text-slate-500">
                    canal={etiquetaCanalSolicitud(req.channel)} · solicitado={formatTimestamp(req.requestedAt)}
                  </div>
                </div>

                <div className="mb-3">
                  <span className={statusBadgeClass(req.status)}>
                    {req.status === "PENDING_REVIEW"
                      ? "Pendiente revisión"
                      : req.status === "APPROVED"
                      ? "Aprobada"
                      : "Rechazada"}
                  </span>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-3 text-xs text-slate-700 mb-3">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <span className="font-semibold">Nombre reportado:</span> {req.reportedFullName}
                    </div>
                    {req.contactEmail && (
                      <div>
                        <span className="font-semibold">Correo:</span> {req.contactEmail}
                      </div>
                    )}
                    {req.contactPhone && (
                      <div>
                        <span className="font-semibold">Teléfono:</span> {req.contactPhone}
                      </div>
                    )}
                    {req.electionId && (
                      <div>
                        <span className="font-semibold">Elección solicitada:</span> #{req.electionId}
                      </div>
                    )}
                  </div>
                </div>

                {req.status === "PENDING_REVIEW" ? (
                  <form action={reviewEnrollmentRequestAction} className="flex flex-col sm:flex-row gap-2 mt-3">
                    <input type="hidden" name="requestId" value={req.requestId} />
                    <input
                      className="admin-input flex-1 py-1.5 text-xs"
                      name="reviewNotes"
                      placeholder="Notas de revisión (opcional)"
                    />
                    <div className="flex gap-2">
                      <button
                        className="admin-btn-outline bg-green-50 text-green-700 border-green-200 hover:bg-green-100 py-1.5 px-3 text-xs"
                        name="decision"
                        value="APPROVED"
                        type="submit"
                      >
                        Aprobar
                      </button>
                      <button
                        className="admin-btn-outline bg-red-50 text-red-700 border-red-200 hover:bg-red-100 py-1.5 px-3 text-xs"
                        name="decision"
                        value="REJECTED"
                        type="submit"
                      >
                        Rechazar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="text-[11px] text-slate-500 bg-slate-100 rounded p-2">
                    revisado por {req.reviewedBy} · {formatTimestamp(req.reviewedAt)}
                    {req.reviewNotes && ` · notas: ${req.reviewNotes}`}
                  </div>
                )}

                {req.status === "APPROVED" && (
                  <form action={createCensusFromEnrollmentRequestAction} className="mt-3">
                    <input type="hidden" name="requestId" value={req.requestId} />
                    <input type="hidden" name="dni" value={req.dni} />
                    <input type="hidden" name="fullName" value={req.reportedFullName} />
                    <input type="hidden" name="habilitationStatus" value="HABILITADO" />
                    <input type="hidden" name="statusReason" value="Aprobado vía solicitud de enrolamiento público" />
                    <button
                      className="admin-btn-primary w-full py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
                      type="submit"
                    >
                      Proyectar como expediente habilitado
                    </button>
                  </form>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
