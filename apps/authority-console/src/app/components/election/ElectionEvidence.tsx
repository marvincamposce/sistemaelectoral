import React from "react";
import { PendingSubmitButton } from "../PendingSubmitButton";

type ElectionEvidenceProps = {
  electionIdStr: string;
  apiUrl: string;
  consistencyRes: any;
  incidentsRes: any;
  anchorsRes: any;
  actsRes: any;
  activeIncidents: any[];
  criticalActive: number;
  warningActive: number;
  infoActive: number;
  consistencyOk: boolean;
  latestAct: any;
  latestTransition: any;
  phaseChangesRes: any;
  publishActaAction: (formData: FormData) => Promise<void>;
  registerOperationalIncidentAction: (formData: FormData) => Promise<void>;
};

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
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

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function severityBadgeClass(severity: string | undefined | null): string {
  const value = String(severity ?? "INFO").toUpperCase();
  if (value === "CRITICAL") return "admin-badge admin-badge-critical";
  if (value === "WARNING") return "admin-badge admin-badge-warning";
  if (value === "INFO") return "admin-badge admin-badge-info";
  return "admin-badge admin-badge-info";
}

function verificationBadgeClass(status: string | undefined | null): string {
  const value = String(status ?? "").toUpperCase();
  if (value === "VERIFIED" || value === "VALID") return "admin-badge admin-badge-valid";
  if (value === "PENDING" || value === "UNKNOWN") return "admin-badge admin-badge-info";
  if (value === "MISSING") return "admin-badge admin-badge-warning";
  if (value.length > 0) return "admin-badge admin-badge-critical";
  return "admin-badge admin-badge-info";
}

function etiquetaTipoActa(kind: string): string {
  const labels: Record<string, string> = {
    ACTA_APERTURA: "Acta de apertura",
    ACTA_CIERRE: "Acta de cierre",
    ACTA_ESCRUTINIO: "Acta de escrutinio",
    ACTA_RESULTADOS: "Acta de resultados",
  };
  return labels[kind] ?? kind;
}

export function ElectionEvidence({
  electionIdStr,
  apiUrl,
  consistencyRes,
  incidentsRes,
  anchorsRes,
  actsRes,
  activeIncidents,
  criticalActive,
  warningActive,
  infoActive,
  consistencyOk,
  latestAct,
  latestTransition,
  phaseChangesRes,
  publishActaAction,
  registerOperationalIncidentAction,
}: ElectionEvidenceProps) {
  return (
    <div className="space-y-6">
      <section className="admin-card p-4 space-y-4">
        <div className="admin-section-title m-0">Publicar acta digital</div>
        <form action={publishActaAction} className="space-y-3">
          <input type="hidden" name="electionId" value={electionIdStr} />
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Elige un tipo de acta entendible y coherente con la fase actual. Si la cadena acepta la transacción pero la evidencia tarda en verse, la pantalla se actualizará sola en unos segundos.
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="kind">
              Tipo
            </label>
            <select id="kind" name="kind" className="admin-input">
              <option value="ACTA_APERTURA">{etiquetaTipoActa("ACTA_APERTURA")}</option>
              <option value="ACTA_CIERRE">{etiquetaTipoActa("ACTA_CIERRE")}</option>
              <option value="ACTA_ESCRUTINIO">{etiquetaTipoActa("ACTA_ESCRUTINIO")}</option>
              <option value="ACTA_RESULTADOS">{etiquetaTipoActa("ACTA_RESULTADOS")}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="notes">
              Notas (opcional)
            </label>
            <textarea
              id="notes"
              name="notes"
              className="admin-input"
              rows={3}
              placeholder="Contexto de la publicación del acta"
            />
          </div>
          <PendingSubmitButton
            idleLabel="Firmar acta y anclar en cadena"
            pendingLabel="Firmando y enviando acta..."
            className="admin-btn-primary"
          />
        </form>
        <div className="text-xs text-slate-500">
          El JSON firmado se escribe en <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">ACTA_OUTPUT_DIR</span> para que el evidence-indexer lo materialice en Postgres.
        </div>
      </section>

      <section className="admin-card p-4 space-y-4">
        <div className="admin-section-title m-0">Consistencia e incidentes (lectura Evidence API)</div>
        <div className="flex flex-wrap gap-2">
          <span className="admin-badge admin-badge-critical">CRITICAL: {criticalActive}</span>
          <span className="admin-badge admin-badge-warning">WARNING: {warningActive}</span>
          <span className="admin-badge admin-badge-info">INFO: {infoActive}</span>
          <span className={consistencyOk ? "admin-badge admin-badge-valid" : "admin-badge admin-badge-warning"}>
            consistencia: {consistencyOk ? "ok" : "pendiente/revisión"}
          </span>
        </div>
        <div className="text-xs text-slate-600">
          Última corrida: {formatTimestamp(consistencyRes?.consistency?.computedAt)}
        </div>
        <div className="text-[11px] text-slate-500 font-mono break-all bg-slate-50 p-2 rounded-md border border-slate-100">
          <div>{apiUrl}/v1/elections/{electionIdStr}/consistency</div>
          <div>{apiUrl}/v1/elections/{electionIdStr}/incidents</div>
        </div>
        
        {activeIncidents.length > 0 ? (
          <div className="space-y-2">
            {activeIncidents.slice(0, 5).map((incident) => (
              <div key={incident.fingerprint} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{incident.code}</div>
                  <span className={severityBadgeClass(incident.severity)}>{incident.severity}</span>
                </div>
                <div className="mt-2 text-xs text-slate-700 bg-white p-2 border border-slate-100 rounded-md">{incident.message}</div>
                <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
                  último evento: {formatTimestamp(incident.lastSeenAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-lg border border-slate-100">
            Sin incidentes activos
          </div>
        )}
      </section>

      <section className="admin-card p-4 space-y-4">
        <div className="admin-section-title m-0">Anchors y actas</div>
        <div className="text-xs text-slate-600">
          Anchors: {anchorsRes?.anchors.length ?? "N/D"} · Actas (referencias): {actsRes?.acts.length ?? "N/D"}
        </div>
        {latestAct ? (
          <div className="text-xs text-slate-700 font-medium">
            Última acta: {latestAct.actType} · {formatTimestamp(latestAct.blockTimestamp ?? latestAct.createdAt)}
          </div>
        ) : null}
        
        <div className="text-[11px] text-slate-500 font-mono break-all bg-slate-50 p-2 rounded-md border border-slate-100">
          <div>{apiUrl}/v1/elections/{electionIdStr}/anchors</div>
          <div>{apiUrl}/v1/elections/{electionIdStr}/acts</div>
        </div>
        
        {(actsRes?.acts.length ?? 0) > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
            {actsRes?.acts.slice(0, 10).map((a: any) => (
              <div key={a.actId} className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{a.actType}</div>
                  <span className={verificationBadgeClass(a.verificationStatus)}>
                    {a.verificationStatus ?? "SIN_VERIFICAR"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-600">
                  <div><span className="font-medium">actId:</span> <span className="font-mono">{a.actId}</span></div>
                  <div><span className="font-medium">createdAt:</span> {formatTimestamp(a.createdAt)}</div>
                  <div className="hash-display" title={a.anchorTxHash}>
                    <span className="font-medium">anchorTx:</span> {shortHash(a.anchorTxHash)}
                  </div>
                  {a.contentHash ? (
                    <div className="hash-display" title={a.contentHash}>
                      <span className="font-medium">content:</span> {shortHash(a.contentHash)}
                    </div>
                  ) : <div></div>}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100 text-xs">
                  <a
                    className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium flex items-center gap-1"
                    href={`${apiUrl}/v1/elections/${encodeURIComponent(electionIdStr)}/acts/${encodeURIComponent(a.actId)}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Descargar contenido firmado
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      
      <section className="admin-card p-4 space-y-4">
        <div className="admin-section-title m-0">Registrar incidente operativo (bitácora)</div>
        <form action={registerOperationalIncidentAction} className="space-y-3">
          <input type="hidden" name="electionId" value={electionIdStr} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700" htmlFor="severity">
                Severidad
              </label>
              <select
                id="severity"
                name="severity"
                className="admin-input"
              >
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700" htmlFor="code">
                Código
              </label>
              <input
                id="code"
                name="code"
                className="admin-input"
                placeholder="ej: OPERATOR_NOTE"
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="message">
              Mensaje
            </label>
            <input
              id="message"
              name="message"
              className="admin-input"
              placeholder="Descripción del incidente operativo"
              required
            />
          </div>
          <PendingSubmitButton
            idleLabel="Registrar en bitácora"
            pendingLabel="Registrando incidente..."
            className="admin-btn-primary"
          />
        </form>
        <div className="text-[11px] text-slate-500 uppercase tracking-wide">
          Registro off-chain en Postgres. No se interpreta como evidencia on-chain.
        </div>
      </section>

      <section className="admin-card p-4 space-y-4">
        <div className="admin-section-title m-0">Timeline de transiciones</div>
        {latestTransition ? (
          <div className="text-xs font-medium text-slate-700 bg-slate-50 p-2 rounded-md border border-slate-100">
            Última transición: <span className="text-indigo-600">{latestTransition.previousPhaseLabel} → {latestTransition.newPhaseLabel}</span> · {formatTimestamp(latestTransition.blockTimestamp)}
          </div>
        ) : null}
        
        {(phaseChangesRes?.phaseChanges.length ?? 0) === 0 ? (
          <div className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-lg border border-slate-100">
            Sin phase-changes indexados
          </div>
        ) : (
          <div className="space-y-2">
            {phaseChangesRes?.phaseChanges.map((p: any) => (
              <div key={`${p.txHash}:${p.logIndex}`} className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900">
                    {p.previousPhaseLabel} <span className="text-slate-400">→</span> {p.newPhaseLabel}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{formatTimestamp(p.blockTimestamp)}</div>
                </div>
                <div className="hash-display mt-2 pt-2 border-t border-slate-100 text-[11px]" title={p.txHash}>
                  <span className="font-medium">txHash:</span> {shortHash(p.txHash)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
