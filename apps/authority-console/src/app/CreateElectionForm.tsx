"use client";

import { useState } from "react";
import { Settings, Shield, Edit3, Key, FileJson, Users } from "lucide-react";
import { PendingSubmitButton } from "./components/PendingSubmitButton";

type CreateElectionFormDefaults = {
  title: string;
  notes: string;
  registryAuthority: string;
  coordinatorPubKey: string;
};

const FALLBACK_DEFAULTS: CreateElectionFormDefaults = {
  title: "Elección Local Reproducible BU-PVP-1",
  notes: "Configuración local reproducible para pruebas de flujo electoral y auditoría.",
  registryAuthority: "",
  coordinatorPubKey: "",
};

export function CreateElectionForm({
  createElectionAction,
  defaults,
}: {
  createElectionAction: (formData: FormData) => void;
  defaults?: Partial<CreateElectionFormDefaults>;
}) {
  const [candidatesMode, setCandidatesMode] = useState<"visual" | "raw">("visual");
  const formDefaults: CreateElectionFormDefaults = {
    ...FALLBACK_DEFAULTS,
    ...(defaults ?? {}),
  };

  const defaultCandidatesJson = [
    "[",
    "  {",
    '    "id": "cand-1",',
    '    "candidateCode": "CAND_1",',
    '    "displayName": "Mariana Soto",',
    '    "shortName": "M. Soto",',
    '    "partyName": "Alianza Cívica",',
    '    "ballotOrder": 1,',
    '    "status": "ACTIVE",',
    '    "colorHex": "#1D4ED8"',
    "  },",
    "  {",
    '    "id": "cand-2",',
    '    "candidateCode": "CAND_2",',
    '    "displayName": "Tomás Rivas",',
    '    "shortName": "T. Rivas",',
    '    "partyName": "Movimiento Federal",',
    '    "ballotOrder": 2,',
    '    "status": "ACTIVE",',
    '    "colorHex": "#0F766E"',
    "  },",
    "  {",
    '    "id": "cand-3",',
    '    "candidateCode": "CAND_3",',
    '    "displayName": "Lucía Peña",',
    '    "shortName": "L. Peña",',
    '    "partyName": "Pacto Social",',
    '    "ballotOrder": 3,',
    '    "status": "ACTIVE",',
    '    "colorHex": "#B45309"',
    "  }",
    "]",
  ].join("\n");

  const [candidatesVal, setCandidatesVal] = useState(defaultCandidatesJson);

  const parsedCandidates = (() => {
    try {
      return JSON.parse(candidatesVal) as any[];
    } catch {
      return [];
    }
  })();

  return (
    <form action={createElectionAction} className="space-y-6">
      
      {/* Título y Notas */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="admin-label flex items-center gap-2" htmlFor="title">
            <Edit3 className="w-4 h-4 text-brand-500" /> Título Público de la Elección
          </label>
          <input
            id="title"
            name="title"
            required
            className="admin-input"
            placeholder="Ej: Elección General Presidencial 2026..."
            defaultValue={formDefaults.title}
          />
        </div>

        <div className="space-y-2">
          <label className="admin-label" htmlFor="notes">
            Descripción Institucional (opcional)
          </label>
          <input
            id="notes"
            name="notes"
            className="admin-input"
            placeholder="Notas de contexto..."
            defaultValue={formDefaults.notes}
          />
        </div>
      </div>

      {/* Criptografía */}
      <div className="admin-card mt-6">
        <div className="admin-card-header bg-slate-50">
          <h3 className="admin-section-title mb-0">
            <Shield className="w-5 h-5 text-emerald-600" />
            Configuración Criptográfica
          </h3>
        </div>
        
        <div className="admin-card-body space-y-5">
          <div className="space-y-2">
            <label className="admin-label flex items-center gap-2" htmlFor="registryAuthority">
              <Key className="w-4 h-4 text-slate-500" />
              Autoridad de Registro (REA)
            </label>
            <p className="text-xs text-slate-500 mb-2">Dirección pública (0x) del organismo que firmará la matriz de electores.</p>
            <input
              id="registryAuthority"
              name="registryAuthority"
              required
              className="admin-input font-mono text-xs"
              placeholder="0x..."
              defaultValue={formDefaults.registryAuthority}
            />
          </div>

          <div className="space-y-2">
            <label className="admin-label flex items-center gap-2" htmlFor="coordinatorPubKey">
              <Key className="w-4 h-4 text-slate-500" />
              Clave Pública del Coordinador
            </label>
            <p className="text-xs text-slate-500 mb-2">Clave BabyJub comprimida de 32 bytes para cifrar las boletas.</p>
            <input
              id="coordinatorPubKey"
              name="coordinatorPubKey"
              required
              className="admin-input font-mono text-xs"
              placeholder="0x... (32 bytes BabyJub)"
              defaultValue={formDefaults.coordinatorPubKey}
            />
          </div>
        </div>
      </div>

      {/* Catálogo */}
      <div className="admin-card mt-6">
        <div className="admin-card-header bg-slate-50 flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-600"><Users size={20} /></div>
            <div>
              <h3 className="admin-section-title mb-0">Catálogo de Candidaturas</h3>
              <p className="text-xs text-slate-500 font-normal mt-1">Define los candidatos que el circuito ZK validará.</p>
            </div>
          </div>
          <div className="flex bg-slate-200 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setCandidatesMode("visual")}
              className={`text-xs px-3 py-1.5 rounded-md transition-all font-semibold ${
                candidatesMode === "visual"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Visual
            </button>
            <button
              type="button"
              onClick={() => setCandidatesMode("raw")}
              className={`text-xs px-3 py-1.5 rounded-md transition-all font-semibold flex items-center gap-1 ${
                candidatesMode === "raw"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileJson className="w-3 h-3" />
              JSON
            </button>
          </div>
        </div>

        <div className="admin-card-body">
          <textarea
            id="candidatesJson"
            name="candidatesJson"
            className={`${
              candidatesMode === "raw" ? "block" : "hidden"
            } w-full rounded-md border border-slate-300 p-4 text-xs font-mono bg-slate-50 shadow-inner focus:border-blue-500 outline-none`}
            rows={10}
            value={candidatesVal}
            onChange={(e) => setCandidatesVal(e.target.value)}
          />

          {candidatesMode === "visual" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {parsedCandidates.length > 0 ? (
                parsedCandidates.map((c, i) => (
                  <div key={i} className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex-shrink-0 shadow-sm border border-slate-100 flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: c.colorHex || "#cbd5e1" }}
                      >
                        {c.displayName?.charAt(0)}
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-sm font-bold text-slate-900 truncate">{c.displayName}</span>
                        <span className="text-xs font-medium text-slate-500 truncate">{c.partyName}</span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-slate-100 flex justify-between items-center mt-auto">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Código</div>
                      <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-700 font-semibold border border-slate-200">
                        {c.candidateCode}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full text-sm text-slate-500 text-center py-8 font-medium bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  No se detectó un JSON válido para candidatos.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pt-6 flex flex-col items-end">
        <PendingSubmitButton
          idleLabel="Crear Elección y Anclar Manifiesto"
          pendingLabel="Creando elección..."
          className="admin-btn-primary !px-8 !py-3 !text-base"
        />
        <p className="text-xs text-slate-500 mt-2 text-right">Esta acción publicará el manifiesto en cadena inmutablemente.</p>
      </div>
    </form>
  );
}
