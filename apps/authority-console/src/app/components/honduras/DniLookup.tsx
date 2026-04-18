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

function phaseLabelEs(label: string | undefined, phase: number): string {
  const PHASE_LABELS_ES: Record<string, string> = {
    SETUP: "Preparacion",
    REGISTRY_OPEN: "Registro abierto",
    REGISTRY_CLOSED: "Registro cerrado",
    VOTING_OPEN: "Votacion abierta",
    VOTING_CLOSED: "Votacion cerrada",
    PROCESSING: "Procesamiento",
    TALLYING: "Escrutinio",
    RESULTS_PUBLISHED: "Resultados publicados",
    AUDIT_WINDOW: "Ventana de auditoria",
    AUDIT_WINDOW_OPEN: "Ventana de auditoria",
    ARCHIVED: "Archivada",
  };
  const key = String(label ?? "").toUpperCase();
  return PHASE_LABELS_ES[key] ?? `Fase ${phase}`;
}

export function DniLookup({
  lookupDniAction,
  authorizeVoterAction,
  dniQuery,
  selectedRecord,
  selectedLinks,
  selectedAuthorizations,
  elections,
  defaultElectionId,
  electionById,
}: {
  lookupDniAction: (formData: FormData) => Promise<void>;
  authorizeVoterAction: (formData: FormData) => Promise<void>;
  dniQuery: string | null;
  selectedRecord: any;
  selectedLinks: any[];
  selectedAuthorizations: any[];
  elections: any[];
  defaultElectionId: string;
  electionById: Map<string, any>;
}) {
  const selectedHasCitizenCode = selectedRecord?.metadataJson?.citizenAccessCodeHash ? true : false;
  const selectedCodeRotatedAt = selectedRecord?.metadataJson?.citizenAccessCodeRotatedAt ?? null;

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <div>
          <h2 className="admin-section-title m-0">Buscar y validar DNI</h2>
          <p className="text-xs text-slate-500 mt-1">
            Consulta expediente, estado de habilitación, billeteras y autorizaciones por elección.
          </p>
        </div>
      </div>
      <div className="admin-card-body">
        <form action={lookupDniAction} className="flex flex-col gap-3 sm:flex-row">
          <input
            className="admin-input flex-1"
            name="dni"
            placeholder="0801199912345"
            defaultValue={dniQuery ?? ""}
            required
          />
          <button className="admin-btn-primary" type="submit">
            Consultar expediente
          </button>
        </form>

        {dniQuery && selectedRecord && (
          <div className="mt-6 space-y-6">
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{selectedRecord.fullName}</h3>
                  <div className="text-sm text-slate-500 font-mono">DNI {selectedRecord.dni}</div>
                </div>
                <span className={statusBadgeClass(selectedRecord.habilitationStatus)}>
                  {etiquetaEstado(selectedRecord.habilitationStatus)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-sm mb-4">
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <span className="text-slate-500 block text-xs uppercase mb-1">Fuente</span>
                  <span className="font-medium">{selectedRecord.source}</span>
                </div>
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <span className="text-slate-500 block text-xs uppercase mb-1">Actualizado</span>
                  <span className="font-medium">{formatTimestamp(selectedRecord.updatedAt)}</span>
                </div>
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <span className="text-slate-500 block text-xs uppercase mb-1">Código ciudadano</span>
                  <span className="font-medium">{selectedHasCitizenCode ? "Configurado" : "No configurado"}</span>
                </div>
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <span className="text-slate-500 block text-xs uppercase mb-1">Rotación código</span>
                  <span className="font-medium">{formatTimestamp(selectedCodeRotatedAt)}</span>
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 border border-slate-100 text-sm text-slate-700 italic">
                {selectedRecord.statusReason || "Sin observaciones registradas."}
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-5 border border-blue-100">
              <h4 className="text-sm font-bold text-blue-900 mb-2">Autorizar para elección</h4>
              <p className="text-xs text-blue-800 mb-4">
                Esta acción crea o actualiza la autorización del DNI en la elección seleccionada y provisiona una billetera gestionada si no existe una activa.
              </p>

              {selectedRecord.habilitationStatus !== "HABILITADO" ? (
                <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-3 text-sm">
                  Este expediente no está habilitado. Actualiza su estado a HABILITADO para autorizarlo.
                </div>
              ) : (
                <form action={authorizeVoterAction} className="flex flex-col sm:flex-row gap-3">
                  <input type="hidden" name="dni" value={selectedRecord.dni} />
                  {elections.length > 0 ? (
                    <select
                      className="admin-input flex-1"
                      name="electionId"
                      defaultValue={defaultElectionId}
                      required
                    >
                      {elections.map((election) => {
                        const phase = phaseLabelEs(election.phaseLabel, election.phase);
                        const label = `#${election.electionId} - ${phase} - insc. ${election.counts?.signups ?? 0}`;
                        return (
                          <option key={election.electionId} value={election.electionId}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input className="admin-input flex-1" name="electionId" placeholder="ID de elección" required />
                  )}
                  <input
                    className="admin-input flex-1"
                    name="authorizationNotes"
                    placeholder="Notas de autorización"
                  />
                  <button className="admin-btn-primary bg-blue-600 hover:bg-blue-700" type="submit">
                    Autorizar DNI
                  </button>
                </form>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Autorizaciones del DNI</h4>
                {selectedAuthorizations.length === 0 ? (
                  <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-100">
                    Sin autorizaciones registradas.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedAuthorizations.map((row) => {
                      const electionMeta = electionById.get(row.electionId);
                      return (
                        <div key={row.authorizationId} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-slate-900">Elección #{row.electionId}</span>
                            <span className={statusBadgeClass(row.status)}>{etiquetaEstado(row.status)}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Fase: {electionMeta ? phaseLabelEs(electionMeta.phaseLabel, electionMeta.phase) : "sin índice"}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Billetera: <span className="admin-hash">{row.walletAddress}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Autorizado: {formatTimestamp(row.authorizedAt)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Billeteras vinculadas</h4>
                {selectedLinks.length === 0 ? (
                  <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-100">
                    Sin billeteras vinculadas.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedLinks.map((link) => (
                      <div key={`${link.dni}-${link.walletAddress}`} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <span className="admin-hash">{link.walletAddress}</span>
                          <span className={statusBadgeClass(link.linkStatus)}>{link.linkStatus}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Método: {link.verificationMethod}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Vinculado: {formatTimestamp(link.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
