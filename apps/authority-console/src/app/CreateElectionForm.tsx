"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { PendingSubmitButton } from "./components/PendingSubmitButton";

type CandidateEntry = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: "ACTIVE" | "INACTIVE" | "WITHDRAWN";
  colorHex: string;
};

type CreateElectionFormDefaults = {
  title: string;
  notes: string;
  registryAuthority: string;
  coordinatorPubKey: string;
};

const FALLBACK_DEFAULTS: CreateElectionFormDefaults = {
  title: "",
  notes: "",
  registryAuthority: "",
  coordinatorPubKey: "",
};

const PARTY_COLORS = [
  "#1D4ED8", "#0F766E", "#B45309", "#7C3AED", "#BE185D",
  "#0369A1", "#15803D", "#A16207", "#4338CA", "#9D174D",
];

function generateId(index: number): string {
  return `cand-${index + 1}`;
}

function generateCode(index: number): string {
  return `CAND_${index + 1}`;
}

export function CreateElectionForm({
  createElectionAction,
  defaults,
}: {
  createElectionAction: (formData: FormData) => void;
  defaults?: Partial<CreateElectionFormDefaults>;
}) {
  const formDefaults: CreateElectionFormDefaults = { ...FALLBACK_DEFAULTS, ...(defaults ?? {}) };
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [candidates, setCandidates] = useState<CandidateEntry[]>([]);

  const addCandidate = () => {
    const nextIndex = candidates.length;
    const newCandidate: CandidateEntry = {
      id: generateId(nextIndex),
      candidateCode: generateCode(nextIndex),
      displayName: "",
      shortName: "",
      partyName: "",
      ballotOrder: nextIndex + 1,
      status: "ACTIVE",
      colorHex: PARTY_COLORS[nextIndex % PARTY_COLORS.length] ?? "#1D4ED8",
    };
    setCandidates([...candidates, newCandidate]);
  };

  const removeCandidate = (index: number) => {
    setCandidates(candidates.filter((_, i) => i !== index));
  };

  const updateCandidate = (index: number, field: keyof CandidateEntry, value: string | number) => {
    setCandidates(candidates.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  // Build the JSON for the hidden field
  const candidatesJson = JSON.stringify(
    candidates.map((c) => ({
      id: c.id,
      candidateCode: c.candidateCode,
      displayName: c.displayName,
      shortName: c.shortName,
      partyName: c.partyName,
      ballotOrder: c.ballotOrder,
      status: c.status,
      colorHex: c.colorHex,
    })),
  );

  return (
    <form action={createElectionAction} className="space-y-8">
      {/* Hidden field for candidates JSON */}
      <input type="hidden" name="candidatesJson" value={candidatesJson} />

      {/* ── Step 1: Basic Info ── */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold">1</div>
          <h3 className="text-base font-bold text-slate-900">Información de la Elección</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="admin-label" htmlFor="title">Título de la elección *</label>
            <input
              id="title" name="title" required className="admin-input"
              placeholder="Ej: Elección General Presidencial 2026"
              defaultValue={formDefaults.title}
            />
            <p className="text-xs text-slate-400">Nombre público que verán todos los participantes.</p>
          </div>
          <div className="space-y-2">
            <label className="admin-label" htmlFor="notes">Descripción (opcional)</label>
            <input
              id="notes" name="notes" className="admin-input"
              placeholder="Notas de contexto institucional..."
              defaultValue={formDefaults.notes}
            />
            <p className="text-xs text-slate-400">Contexto adicional para observadores y auditores.</p>
          </div>
        </div>
      </section>

      {/* ── Step 2: Candidates ── */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold">2</div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Candidaturas</h3>
              <p className="text-xs text-slate-500 mt-0.5">{candidates.length} candidato{candidates.length !== 1 ? "s" : ""} registrado{candidates.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={addCandidate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm hover:shadow-md"
          >
            <Plus size={16} />
            Añadir candidato
          </button>
        </div>

        {candidates.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center justify-center mx-auto mb-4">
              <Plus size={24} className="text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Aún no hay candidatos</p>
            <p className="text-xs text-slate-500 mt-1">Haz clic en "Añadir candidato" para comenzar a definir la papeleta.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {candidates.map((cand, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-4 px-5 py-4 bg-slate-50/50 border-b border-slate-100">
                  <div
                    className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-sm shadow-sm"
                    style={{ backgroundColor: cand.colorHex }}
                  >
                    {cand.displayName ? cand.displayName.charAt(0).toUpperCase() : (i + 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">
                      {cand.displayName || `Candidato #${i + 1}`}
                    </div>
                    <div className="text-xs text-slate-500">
                      Posición {cand.ballotOrder} en la papeleta · {cand.partyName || "Sin partido aún"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCandidate(i)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Eliminar candidato"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="p-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Nombre completo *</label>
                    <input
                      required className="admin-input" placeholder="Ej: Mariana Soto Espinoza"
                      value={cand.displayName}
                      onChange={(e) => {
                        updateCandidate(i, "displayName", e.target.value);
                        if (!cand.shortName || cand.shortName.startsWith(cand.displayName.split(" ")[0]?.charAt(0) ?? "")) {
                          const parts = e.target.value.split(" ");
                          if (parts.length >= 2 && parts[0]) updateCandidate(i, "shortName", `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Nombre corto</label>
                    <input
                      required className="admin-input" placeholder="M. Soto"
                      value={cand.shortName}
                      onChange={(e) => updateCandidate(i, "shortName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Partido o alianza *</label>
                    <input
                      required className="admin-input" placeholder="Ej: Alianza Cívica"
                      value={cand.partyName}
                      onChange={(e) => updateCandidate(i, "partyName", e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Posición</label>
                      <input
                        type="number" min={1} required className="admin-input"
                        value={cand.ballotOrder}
                        onChange={(e) => updateCandidate(i, "ballotOrder", parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-600">Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color" className="w-10 h-10 p-1 bg-white border border-slate-200 rounded-lg cursor-pointer"
                          value={cand.colorHex}
                          onChange={(e) => updateCandidate(i, "colorHex", e.target.value)}
                        />
                        <input
                          className="admin-input flex-1 font-mono text-xs uppercase" placeholder="#1D4ED8"
                          value={cand.colorHex}
                          onChange={(e) => updateCandidate(i, "colorHex", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Advanced Config (collapsible) ── */}
      <section>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors w-full py-3 border-t border-slate-200"
        >
          {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Configuración avanzada (criptografía)
          {!showAdvanced && formDefaults.coordinatorPubKey && (
            <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Auto-configurado ✓</span>
          )}
        </button>

        {showAdvanced && (
          <div className="mt-4 p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-5">
            <p className="text-xs text-slate-500 leading-relaxed">
              Estos valores se pre-configuran automáticamente desde las variables de entorno del servidor.
              Solo modifícalos si necesitas una configuración personalizada.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700" htmlFor="registryAuthority">
                Autoridad de Registro Electoral (REA)
              </label>
              <p className="text-xs text-slate-400">Dirección Ethereum del organismo que gestiona el padrón electoral.</p>
              <input
                id="registryAuthority" name="registryAuthority" required
                className="admin-input font-mono text-xs"
                placeholder="0x..."
                defaultValue={formDefaults.registryAuthority}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700" htmlFor="coordinatorPubKey">
                Clave pública del coordinador ZK
              </label>
              <p className="text-xs text-slate-400">Clave BabyJub comprimida de 32 bytes para cifrar boletas. Se deriva automáticamente.</p>
              <input
                id="coordinatorPubKey" name="coordinatorPubKey" required
                className="admin-input font-mono text-xs"
                placeholder="0x... (32 bytes)"
                defaultValue={formDefaults.coordinatorPubKey}
              />
            </div>
          </div>
        )}

        {/* Hidden inputs when advanced is collapsed (use defaults) */}
        {!showAdvanced && (
          <>
            <input type="hidden" name="registryAuthority" value={formDefaults.registryAuthority} />
            <input type="hidden" name="coordinatorPubKey" value={formDefaults.coordinatorPubKey} />
          </>
        )}
      </section>

      {/* ── Submit ── */}
      <div className="pt-4 border-t border-slate-200">
        <PendingSubmitButton
          idleLabel="Crear Elección"
          pendingLabel="Creando elección en la blockchain..."
          className="admin-btn-primary w-full !py-4 !text-base !font-bold !rounded-xl shadow-md hover:shadow-lg transition-all"
        />
        <p className="text-xs text-slate-400 mt-3 text-center">
          Se creará el manifiesto, se publicará en cadena y se anclará de forma inmutable.
        </p>
      </div>
    </form>
  );
}
