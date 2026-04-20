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
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ts; }
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const ACTA_LABELS: Record<string, string> = {
  ACTA_APERTURA: "Acta de apertura",
  ACTA_CIERRE: "Acta de cierre",
  ACTA_ESCRUTINIO: "Acta de escrutinio",
  ACTA_RESULTADOS: "Acta de resultados",
};

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Crítico", WARNING: "Advertencia", INFO: "Información",
};

const VERIFICATION_LABELS: Record<string, { label: string; cls: string }> = {
  VALID: { label: "✓ Verificada", cls: "admin-badge admin-badge-valid" },
  VERIFIED: { label: "✓ Verificada", cls: "admin-badge admin-badge-valid" },
  PENDING: { label: "⏳ Pendiente", cls: "admin-badge admin-badge-info" },
  UNKNOWN: { label: "⏳ Pendiente", cls: "admin-badge admin-badge-info" },
  SIN_VERIFICAR: { label: "⏳ Sin verificar", cls: "admin-badge admin-badge-info" },
  MISSING: { label: "⚠ Faltante", cls: "admin-badge admin-badge-warning" },
};

function verificationBadge(status: string | null | undefined) {
  const key = String(status ?? "SIN_VERIFICAR").toUpperCase();
  const entry = VERIFICATION_LABELS[key] ?? { label: key, cls: "admin-badge admin-badge-critical" };
  return <span className={entry.cls}>{entry.label}</span>;
}

const INCIDENT_TYPES = [
  { value: "OPERATOR_NOTE", label: "Nota del operador" },
  { value: "SYSTEM_ANOMALY", label: "Anomalía del sistema" },
  { value: "VOTER_COMPLAINT", label: "Queja de votante" },
  { value: "SECURITY_ALERT", label: "Alerta de seguridad" },
  { value: "HARDWARE_FAILURE", label: "Falla de hardware" },
  { value: "NETWORK_ISSUE", label: "Problema de red" },
  { value: "PROCEDURE_DEVIATION", label: "Desviación de procedimiento" },
  { value: "OTHER", label: "Otro" },
];

export function ElectionEvidence({
  electionIdStr, apiUrl,
  consistencyRes, incidentsRes, anchorsRes, actsRes,
  activeIncidents, criticalActive, warningActive, infoActive,
  consistencyOk, latestAct, latestTransition, phaseChangesRes,
  publishActaAction, registerOperationalIncidentAction,
}: ElectionEvidenceProps) {
  return (
    <div className="space-y-6">
      {/* ── Publish Act ── */}
      <section className="admin-card p-5 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Publicar acta digital</h3>
          <p className="text-xs text-slate-500 mt-1">Firma y ancla un acta electoral en la blockchain. El acta queda como evidencia inmutable.</p>
        </div>
        <form action={publishActaAction} className="space-y-4">
          <input type="hidden" name="electionId" value={electionIdStr} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700" htmlFor="kind">Tipo de acta</label>
              <select id="kind" name="kind" className="admin-input">
                {Object.entries(ACTA_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700" htmlFor="notes">Notas (opcional)</label>
              <textarea id="notes" name="notes" className="admin-input" rows={2} placeholder="Contexto adicional sobre la publicación..." />
            </div>
          </div>
          <PendingSubmitButton
            idleLabel="Firmar y publicar acta"
            pendingLabel="Firmando y enviando a la blockchain..."
            className="admin-btn-primary"
          />
        </form>
      </section>

      {/* ── Consistency & Incidents Summary ── */}
      <section className="admin-card p-5 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Estado de integridad</h3>
          <p className="text-xs text-slate-500 mt-1">Verificación automática de consistencia y registro de incidentes activos.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`rounded-xl p-4 border ${consistencyOk ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Consistencia</div>
            <div className={`text-sm font-bold mt-1 ${consistencyOk ? "text-emerald-700" : "text-amber-700"}`}>
              {consistencyOk ? "✓ Verificada" : "⏳ Pendiente de revisión"}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {formatTimestamp(consistencyRes?.consistency?.computedAt)}
            </div>
          </div>
          <div className={`rounded-xl p-4 border ${criticalActive > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Críticos</div>
            <div className={`text-2xl font-bold mt-1 ${criticalActive > 0 ? "text-red-700" : "text-slate-900"}`}>{criticalActive}</div>
          </div>
          <div className={`rounded-xl p-4 border ${warningActive > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Advertencias</div>
            <div className={`text-2xl font-bold mt-1 ${warningActive > 0 ? "text-amber-700" : "text-slate-900"}`}>{warningActive}</div>
          </div>
          <div className="rounded-xl p-4 border bg-slate-50 border-slate-200">
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Informativos</div>
            <div className="text-2xl font-bold mt-1 text-slate-900">{infoActive}</div>
          </div>
        </div>

        {activeIncidents.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">Incidentes activos</div>
            {activeIncidents.slice(0, 5).map((incident) => (
              <div key={incident.fingerprint} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">{incident.code}</div>
                  <span className={`admin-badge ${
                    String(incident.severity).toUpperCase() === "CRITICAL" ? "admin-badge-critical" :
                    String(incident.severity).toUpperCase() === "WARNING" ? "admin-badge-warning" : "admin-badge-info"
                  }`}>
                    {SEVERITY_LABELS[String(incident.severity).toUpperCase()] ?? incident.severity}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-600">{incident.message}</div>
                <div className="mt-2 text-xs text-slate-400">Último evento: {formatTimestamp(incident.lastSeenAt)}</div>
              </div>
            ))}
          </div>
        )}

        {activeIncidents.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><polyline points="20 6 9 17 4 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Sin incidentes activos
          </div>
        )}
      </section>

      {/* ── Published Acts ── */}
      <section className="admin-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Actas publicadas</h3>
            <p className="text-xs text-slate-500 mt-1">{anchorsRes?.anchors?.length ?? 0} evidencias ancladas · {actsRes?.acts?.length ?? 0} actas registradas</p>
          </div>
          {latestAct && (
            <span className="text-xs text-slate-500">
              Última: {ACTA_LABELS[latestAct.actType] ?? latestAct.actType} · {formatTimestamp(latestAct.blockTimestamp ?? latestAct.createdAt)}
            </span>
          )}
        </div>

        {(actsRes?.acts?.length ?? 0) > 0 ? (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {actsRes?.acts.slice(0, 10).map((a: any) => (
              <div key={a.actId} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {ACTA_LABELS[a.actType] ?? a.actType}
                  </div>
                  {verificationBadge(a.verificationStatus)}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs text-slate-600">
                  <div><span className="font-semibold">Identificador:</span> <span className="font-mono">{shortHash(a.actId)}</span></div>
                  <div><span className="font-semibold">Fecha:</span> {formatTimestamp(a.createdAt)}</div>
                  <div><span className="font-semibold">Transacción:</span> <span className="font-mono">{shortHash(a.anchorTxHash)}</span></div>
                  {a.contentHash && <div><span className="font-semibold">Contenido:</span> <span className="font-mono">{shortHash(a.contentHash)}</span></div>}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100">
                  <a
                    className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline font-medium flex items-center gap-1"
                    href={`${apiUrl}/v1/elections/${encodeURIComponent(electionIdStr)}/acts/${encodeURIComponent(a.actId)}/content`}
                    target="_blank" rel="noreferrer"
                  >
                    Descargar acta firmada ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            No se han publicado actas aún
          </div>
        )}
      </section>

      {/* ── Register Incident ── */}
      <section className="admin-card p-5 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Registrar incidente</h3>
          <p className="text-xs text-slate-500 mt-1">Documenta eventos operativos relevantes en la bitácora administrativa.</p>
        </div>
        <form action={registerOperationalIncidentAction} className="space-y-4">
          <input type="hidden" name="electionId" value={electionIdStr} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700" htmlFor="severity">Nivel de severidad</label>
              <select id="severity" name="severity" className="admin-input">
                <option value="INFO">📋 Información</option>
                <option value="WARNING">⚠️ Advertencia</option>
                <option value="CRITICAL">🚨 Crítico</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700" htmlFor="code">Tipo de incidente</label>
              <select id="code" name="code" className="admin-input" required>
                <option value="">Selecciona un tipo...</option>
                {INCIDENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700" htmlFor="message">Descripción del incidente</label>
            <textarea id="message" name="message" className="admin-input" rows={2} placeholder="Describe lo ocurrido con detalle suficiente para la auditoría..." required />
          </div>
          <PendingSubmitButton
            idleLabel="Registrar incidente"
            pendingLabel="Registrando..."
            className="admin-btn-primary"
          />
        </form>
      </section>

      {/* ── Phase Transitions Timeline ── */}
      <section className="admin-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Historial de cambios de fase</h3>
          {latestTransition && (
            <p className="text-xs text-slate-500 mt-1">
              Última transición: <span className="font-semibold text-indigo-600">{latestTransition.previousPhaseLabel} → {latestTransition.newPhaseLabel}</span> · {formatTimestamp(latestTransition.blockTimestamp)}
            </p>
          )}
        </div>

        {(phaseChangesRes?.phaseChanges?.length ?? 0) === 0 ? (
          <div className="text-sm text-slate-500 text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            No se han registrado cambios de fase
          </div>
        ) : (
          <div className="space-y-2">
            {phaseChangesRes?.phaseChanges.map((p: any) => (
              <div key={`${p.txHash}:${p.logIndex}`} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {p.previousPhaseLabel} <span className="text-slate-400">→</span> {p.newPhaseLabel}
                  </div>
                  <div className="text-xs text-slate-500">{formatTimestamp(p.blockTimestamp)}</div>
                </div>
                <div className="mt-2 text-xs text-slate-400 font-mono">Tx: {shortHash(p.txHash)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
