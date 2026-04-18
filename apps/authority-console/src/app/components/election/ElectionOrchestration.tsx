import React from "react";
import { PendingSubmitButton } from "../PendingSubmitButton";
import { ElectoralEventType } from "@blockurna/shared";

type ElectionOrchestrationProps = {
  electionIdStr: string;
  availableEvents: ElectoralEventType[];
  currentPhaseLabel: string;
  transitionPhaseAction: (formData: FormData) => Promise<void>;
};

function eventLabel(e: ElectoralEventType): string {
  const map: Record<ElectoralEventType, string> = {
    OPEN_REGISTRY: "Abrir registro (REA)",
    CLOSE_REGISTRY: "Cerrar registro",
    OPEN_VOTING: "Abrir votación",
    CLOSE_VOTING: "Cerrar votación",
    START_PROCESSING: "Iniciar processing",
    FINALIZE_PROCESSING: "Finalizar processing",
    PUBLISH_RESULTS: "Publicar resultados",
    OPEN_AUDIT_WINDOW: "Abrir ventana de auditoría",
    ARCHIVE_ELECTION: "Archivar elección",
  };
  return map[e] ?? e;
}

export function ElectionOrchestration({
  electionIdStr,
  availableEvents,
  currentPhaseLabel,
  transitionPhaseAction,
}: ElectionOrchestrationProps) {
  return (
    <section className="admin-card p-6 space-y-4 border-indigo-100/50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Orquestación de Fases</h3>
      </div>
      
      {availableEvents.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 text-center">
          <p className="text-sm font-medium text-slate-600">
            Ningún cambio de estado disponible desde <span className="font-bold text-indigo-700">{currentPhaseLabel}</span>.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {availableEvents.map((event) => (
            <form key={event} action={transitionPhaseAction} className="w-full">
              <input type="hidden" name="electionId" value={electionIdStr} />
              <input type="hidden" name="event" value={event} />
              <PendingSubmitButton
                idleLabel={`EJECUTAR: ${eventLabel(event)}`}
                pendingLabel={`Ejecutando ${eventLabel(event)}...`}
                className="w-full flex items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-black transition-all px-5 py-4 text-sm font-extrabold tracking-wide shadow-md hover:shadow-lg focus:ring-4 focus:ring-indigo-100 group"
              />
            </form>
          ))}
        </div>
      )}
      
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-3">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-xs text-amber-800 font-medium leading-relaxed">
          <strong>Atención:</strong> Solo se permite avanzar a fases válidas para el estado real de la elección. Si la red rechaza la transición, la consola mostrará un aviso operativo claro en vez de dejar un error crudo.
        </p>
      </div>
    </section>
  );
}
