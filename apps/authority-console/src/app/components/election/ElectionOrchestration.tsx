"use client";

import React, { useState } from "react";
import { PendingSubmitButton } from "../PendingSubmitButton";
import { ElectoralEventType } from "@blockurna/shared";

type ElectionOrchestrationProps = {
  electionIdStr: string;
  availableEvents: ElectoralEventType[];
  currentPhaseLabel: string;
  transitionPhaseAction: (formData: FormData) => Promise<void>;
};

const PHASE_ORDER = [
  "SETUP", "REGISTRY_OPEN", "REGISTRY_CLOSED", "VOTING_OPEN", "VOTING_CLOSED",
  "PROCESSING", "TALLYING", "RESULTS_PUBLISHED", "AUDIT_WINDOW_OPEN", "ARCHIVED",
];

const PHASE_LABELS: Record<string, string> = {
  SETUP: "Preparación", REGISTRY_OPEN: "Registro abierto", REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votación abierta", VOTING_CLOSED: "Votación cerrada", PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio", RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW_OPEN: "Auditoría", ARCHIVED: "Archivada",
};

const PHASE_DESCRIPTIONS: Record<string, { summary: string; details: string[] }> = {
  SETUP: {
    summary: "Configuración inicial del proceso electoral.",
    details: [
      "Se define el catálogo de candidaturas y el manifiesto se publica en cadena.",
      "Se configura la clave criptográfica del coordinador ZK.",
      "El padrón electoral aún no acepta inscripciones.",
    ],
  },
  REGISTRY_OPEN: {
    summary: "Los ciudadanos pueden inscribirse para participar.",
    details: [
      "El padrón electoral acepta nuevas inscripciones.",
      "Los ciudadanos registran su identidad y clave pública.",
      "La autoridad puede verificar y autorizar votantes.",
    ],
  },
  REGISTRY_CLOSED: {
    summary: "El período de inscripción ha finalizado.",
    details: [
      "No se aceptan nuevas inscripciones.",
      "El padrón queda cerrado y firmado criptográficamente.",
      "Se prepara la transición a la fase de votación.",
    ],
  },
  VOTING_OPEN: {
    summary: "Los ciudadanos autorizados pueden emitir su boleta.",
    details: [
      "Los votantes cifran su selección con la clave del coordinador.",
      "Cada boleta se ancla en la blockchain como evidencia inmutable.",
      "El contenido del voto permanece cifrado hasta el escrutinio.",
    ],
  },
  VOTING_CLOSED: {
    summary: "El período de votación ha finalizado.",
    details: [
      "No se aceptan más boletas.",
      "Se inicia la preparación para el procesamiento criptográfico.",
      "Todas las boletas cifradas quedan selladas en cadena.",
    ],
  },
  PROCESSING: {
    summary: "Procesamiento criptográfico de las boletas.",
    details: [
      "Se procesan las boletas cifradas mediante el circuito ZK.",
      "Se genera la prueba de descifrado verificable.",
      "Los resultados permanecen ocultos hasta la publicación.",
    ],
  },
  TALLYING: {
    summary: "Escrutinio y generación de resultados.",
    details: [
      "Se ejecuta el conteo verificable con prueba ZK.",
      "El transcript criptográfico se genera para auditoría.",
      "Los resultados se preparan para publicación oficial.",
    ],
  },
  RESULTS_PUBLISHED: {
    summary: "Resultados oficiales publicados.",
    details: [
      "Los resultados son públicos y verificables por cualquier persona.",
      "Las pruebas criptográficas están disponibles para auditoría.",
      "Se puede abrir una ventana de auditoría pública.",
    ],
  },
  AUDIT_WINDOW_OPEN: {
    summary: "Ventana de auditoría pública abierta.",
    details: [
      "Cualquier persona puede verificar las pruebas ZK.",
      "Los observadores pueden auditar toda la evidencia anclada.",
      "Se acepta la revisión de incidentes y objeciones formales.",
    ],
  },
  ARCHIVED: {
    summary: "Elección archivada de forma permanente.",
    details: [
      "El proceso electoral ha concluido definitivamente.",
      "Toda la evidencia permanece inmutable en cadena.",
      "No se permiten más transiciones de fase.",
    ],
  },
};

const EVENT_INFO: Record<string, { label: string; description: string; icon: string }> = {
  OPEN_REGISTRY: { label: "Abrir registro de votantes", description: "Permite que los ciudadanos se registren para participar en la elección.", icon: "📋" },
  CLOSE_REGISTRY: { label: "Cerrar registro", description: "Finaliza el período de inscripción. No se aceptarán nuevos registros.", icon: "🔒" },
  OPEN_VOTING: { label: "Abrir votación", description: "Inicia el período de votación. Los ciudadanos autorizados podrán emitir su boleta.", icon: "🗳️" },
  CLOSE_VOTING: { label: "Cerrar votación", description: "Finaliza el período de votación. No se aceptarán más boletas.", icon: "⏱️" },
  START_PROCESSING: { label: "Iniciar procesamiento", description: "Comienza el procesamiento criptográfico de las boletas cifradas.", icon: "⚙️" },
  FINALIZE_PROCESSING: { label: "Finalizar procesamiento", description: "Confirma que el procesamiento ha terminado.", icon: "✅" },
  PUBLISH_RESULTS: { label: "Publicar resultados", description: "Hace públicos los resultados oficiales de la elección.", icon: "📊" },
  OPEN_AUDIT_WINDOW: { label: "Abrir ventana de auditoría", description: "Permite la revisión pública de la evidencia criptográfica.", icon: "🔍" },
  ARCHIVE_ELECTION: { label: "Archivar elección", description: "Cierra definitivamente la elección. Esta acción es irreversible.", icon: "📁" },
};

export function ElectionOrchestration({
  electionIdStr, availableEvents, currentPhaseLabel, transitionPhaseAction,
}: ElectionOrchestrationProps) {
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [confirmingEvent, setConfirmingEvent] = useState<ElectoralEventType | null>(null);
  const currentIndex = PHASE_ORDER.indexOf(currentPhaseLabel.toUpperCase());

  const activePhase = selectedPhase ?? currentPhaseLabel.toUpperCase();
  const phaseInfo = PHASE_DESCRIPTIONS[activePhase];

  return (
    <section className="space-y-6">
      {/* Phase Timeline */}
      <div className="card p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Progreso del proceso electoral</div>
        <div className="flex items-start gap-0 overflow-x-auto pb-2">
          {PHASE_ORDER.map((phase, i) => {
            const isCurrent = phase === currentPhaseLabel.toUpperCase();
            const isPast = i < currentIndex;
            const isSelected = phase === activePhase;

            return (
              <React.Fragment key={phase}>
                {i > 0 && (
                  <div className={`flex-shrink-0 w-8 h-0.5 mt-4 ${isPast ? "bg-indigo-300" : "bg-slate-200"}`} />
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPhase(phase === selectedPhase ? null : phase)}
                  className={`flex-shrink-0 flex flex-col items-center gap-2 min-w-[72px] group cursor-pointer transition-all duration-200`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                    isSelected
                      ? "bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-lg scale-110"
                      : isCurrent
                        ? "bg-indigo-600 text-white ring-2 ring-indigo-100 shadow-md"
                        : isPast
                          ? "bg-indigo-400 text-white"
                          : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"
                  }`}>
                    {isPast ? "✓" : i + 1}
                  </div>
                  <span className={`text-[10px] text-center leading-tight font-medium transition-colors ${
                    isSelected ? "text-indigo-700 font-bold" :
                    isCurrent ? "text-indigo-600 font-bold" :
                    isPast ? "text-slate-600" : "text-slate-400 group-hover:text-slate-600"
                  }`}>
                    {PHASE_LABELS[phase] ?? phase}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Phase Detail Panel */}
      {phaseInfo && (
        <div className={`card overflow-hidden transition-all duration-200 ${
          activePhase === currentPhaseLabel.toUpperCase()
            ? "border-indigo-200"
            : "border-slate-200"
        }`}>
          <div className={`px-5 py-4 flex items-center justify-between ${
            activePhase === currentPhaseLabel.toUpperCase()
              ? "bg-indigo-50 border-b border-indigo-100"
              : "bg-slate-50 border-b border-slate-100"
          }`}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">
                  {PHASE_LABELS[activePhase] ?? activePhase}
                </span>
                {activePhase === currentPhaseLabel.toUpperCase() && (
                  <span className="badge badge-info">Fase actual</span>
                )}
                {PHASE_ORDER.indexOf(activePhase) < currentIndex && (
                  <span className="badge badge-valid">Completada</span>
                )}
                {PHASE_ORDER.indexOf(activePhase) > currentIndex && (
                  <span className="badge badge-neutral">Pendiente</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">{phaseInfo.summary}</p>
            </div>
            {selectedPhase && (
              <button
                type="button"
                onClick={() => setSelectedPhase(null)}
                className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
              >
                ✕ Cerrar
              </button>
            )}
          </div>
          <div className="p-5">
            <ul className="space-y-2">
              {phaseInfo.details.map((detail, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Available Transitions */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Acciones disponibles</div>
          <p className="text-xs text-slate-500">
            Fase actual: <span className="font-bold text-indigo-600">{PHASE_LABELS[currentPhaseLabel.toUpperCase()] ?? currentPhaseLabel}</span>
          </p>
        </div>

        {availableEvents.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
            <p className="text-sm text-slate-600">No hay transiciones disponibles desde esta fase.</p>
            <p className="text-xs text-slate-400 mt-1">La elección puede haber llegado a su estado final.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {availableEvents.map((event) => {
              const info = EVENT_INFO[event] ?? { label: event, description: "", icon: "▶" };
              const isConfirming = confirmingEvent === event;
              const isDangerous = event === "ARCHIVE_ELECTION" || event === "CLOSE_VOTING";

              return (
                <div key={event} className={`rounded-xl border transition-all ${
                  isConfirming
                    ? isDangerous ? "border-rose-300 bg-rose-50" : "border-indigo-200 bg-indigo-50/50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}>
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{info.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900">{info.label}</div>
                        <p className="text-xs text-slate-500 mt-0.5">{info.description}</p>
                      </div>
                      {!isConfirming && (
                        <button
                          type="button"
                          onClick={() => setConfirmingEvent(event)}
                          className={`flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            isDangerous
                              ? "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                          }`}
                        >
                          Ejecutar
                        </button>
                      )}
                    </div>

                    {isConfirming && (
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <p className={`text-xs font-bold mb-3 ${isDangerous ? "text-rose-700" : "text-indigo-700"}`}>
                          {isDangerous ? "⚠️ Esta acción puede ser irreversible. ¿Confirmas?" : "¿Confirmas esta transición de fase?"}
                        </p>
                        <div className="flex items-center gap-3">
                          <form action={transitionPhaseAction} className="flex-1">
                            <input type="hidden" name="electionId" value={electionIdStr} />
                            <input type="hidden" name="event" value={event} />
                            <PendingSubmitButton
                              idleLabel={`Confirmar: ${info.label}`}
                              pendingLabel="Ejecutando transición..."
                              className={`w-full rounded-lg px-4 py-2.5 text-xs font-bold text-white transition-all ${
                                isDangerous ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"
                              }`}
                            />
                          </form>
                          <button
                            type="button"
                            onClick={() => setConfirmingEvent(null)}
                            className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
