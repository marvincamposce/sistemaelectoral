"use client";

import { useState } from "react";
import { Settings, Shield, Edit3, Key, FileJson, Users } from "lucide-react";

export function CreateElectionForm({
  createElectionAction,
}: {
  createElectionAction: (formData: FormData) => void;
}) {
  const [candidatesMode, setCandidatesMode] = useState<"visual" | "raw">("visual");

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
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800" htmlFor="title">
            <Edit3 className="w-4 h-4 text-indigo-500" /> Título Público de la Elección
          </label>
          <input
            id="title"
            name="title"
            required
            className="w-full rounded-md border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all"
            placeholder="Ej: Elección General Presidencial 2026..."
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-800 pl-6" htmlFor="notes">
            Descripción Institucional (opcional)
          </label>
          <textarea
            id="notes"
            name="notes"
            className="w-full rounded-md border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all"
            rows={2}
            placeholder="Notas de contexto para el documento constitutivo..."
          />
        </div>
      </div>

      <div className="w-full h-px bg-slate-200 my-4" />

      {/* Criptografía */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <Shield className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Configuración Criptográfica Base</h3>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800" htmlFor="registryAuthority">
              <Key className="w-4 h-4 text-slate-500" />
              Llave de la Autoridad de Registro (REA)
            </label>
            <p className="text-xs text-slate-500 ml-6">Dirección pública (0x) del organismo que firmará la matriz de electores (Permits).</p>
            <input
              id="registryAuthority"
              name="registryAuthority"
              required
              className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-mono bg-white shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="0x..."
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800" htmlFor="coordinatorPubKey">
              <Key className="w-4 h-4 text-slate-500" />
              Llave Abierta del Coordinador (PubKey)
            </label>
            <p className="text-xs text-slate-500 ml-6">Llave criptográfica de 32 bytes utilizada por la JED para cifrar las boletas de forma anónima.</p>
            <input
              id="coordinatorPubKey"
              name="coordinatorPubKey"
              required
              className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-mono bg-white shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="0x1111111111111111111111111111111111111111111111111111111111111111"
            />
          </div>
        </div>
      </div>

      <div className="w-full h-px bg-slate-200 my-4" />

      {/* Catálogo */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Padrón de Candidatos</h3>
              <p className="text-xs text-slate-500 font-normal">Define a los candidatos que el contrato ZK validará.</p>
            </div>
          </div>
          <div className="flex bg-slate-200 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setCandidatesMode("visual")}
              className={`text-xs px-3 py-1.5 rounded-md transition-all font-semibold ${
                candidatesMode === "visual"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-800"
              }`}
            >
              Auditoría Visual
            </button>
            <button
              type="button"
              onClick={() => setCandidatesMode("raw")}
              className={`text-xs px-3 py-1.5 rounded-md transition-all font-semibold flex items-center gap-1 ${
                candidatesMode === "raw"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-800"
              }`}
            >
              <FileJson className="w-3 h-3" />
              Editor JSON
            </button>
          </div>
        </div>

        <div className="p-5">
          <textarea
            id="candidatesJson"
            name="candidatesJson"
            className={`${
              candidatesMode === "raw" ? "block" : "hidden"
            } w-full rounded-md border border-slate-300 px-4 py-3 text-xs font-mono bg-white shadow-inner focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500`}
            rows={12}
            value={candidatesVal}
            onChange={(e) => setCandidatesVal(e.target.value)}
          />

          {candidatesMode === "visual" && (
            <div className="space-y-3">
              {parsedCandidates.length > 0 ? (
                parsedCandidates.map((c, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:border-indigo-200 transition-colors">
                    <div className="flex items-center gap-4">
                      <div
                        className="w-6 h-6 rounded-full flex-shrink-0 shadow-sm border border-slate-100"
                        style={{ backgroundColor: c.colorHex || "#ccc" }}
                      />
                      <div className="flex flex-col">
                        <span className="text-base font-bold text-slate-900">{c.displayName}</span>
                        <span className="text-xs font-medium text-slate-500">{c.partyName}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">ID del Contrato</div>
                      <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-700 font-semibold border border-slate-200">
                        {c.candidateCode}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500 text-center py-8 font-medium">No se detectó un JSON válido para candidatos.</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pt-6">
        <button
          type="submit"
          className="w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg focus:ring-4 focus:ring-indigo-200 px-4 py-4 text-sm font-extrabold tracking-wide uppercase transition-all"
        >
          Comprometer Manifiesto On-Chain
        </button>
        <p className="text-center text-xs text-slate-500 mt-3 font-medium">Instanciará el Smart Contract TallyVerifier derivando un manifestHash criptográfico.</p>
      </div>
    </form>
  );
}
