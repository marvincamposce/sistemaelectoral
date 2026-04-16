"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Fingerprint, Network, ChevronRight } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [electionId, setElectionId] = useState("");
  const [isAttempting, setIsAttempting] = useState(false);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (electionId.trim()) {
      setIsAttempting(true);
      setTimeout(() => {
        router.push(`/vote/${encodeURIComponent(electionId.trim())}`);
      }, 500); // Slight delay for the authentication effect
    }
  };

  return (
    <main className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
        <svg className="absolute -left-8 top-8 h-56 w-56 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4v16m8-8H4" />
        </svg>
      </div>

      <div className="max-w-lg w-full z-10">
        <div className="card p-8 sm:p-9 space-y-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Lock className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Ingreso al proceso de votación</h2>
              <p className="mt-1 text-sm text-slate-600">
                Continúa con una experiencia guiada para emitir tu boleta cifrada de forma segura.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl border border-indigo-100 bg-indigo-50/60 text-sm text-slate-700">
            <Fingerprint className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
            <p>
              Necesitarás tu permiso digital en formato JSON, emitido por la Autoridad de Registro (REA),
              para habilitar tu inscripción y votar.
            </p>
          </div>

          <form onSubmit={handleStart} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="electionId" className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Network className="w-4 h-4 text-slate-500" />
                Identificador de la elección
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-slate-400 text-sm font-semibold">ID</span>
                </div>
                <input
                  id="electionId"
                  type="text"
                  required
                  value={electionId}
                  onChange={(e) => setElectionId(e.target.value)}
                  disabled={isAttempting}
                  className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-all disabled:opacity-50 disabled:bg-slate-100"
                  placeholder="Ejemplo: 1"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!electionId.trim() || isAttempting}
              className="group w-full flex justify-center items-center gap-2 py-3.5 px-4 text-sm font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isAttempting ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Validando acceso a la elección...</span>
                </>
              ) : (
                <>
                  <span>Continuar a votación</span>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <p className="text-xs text-slate-500">
            Si no conoces el identificador de elección, solicítalo a tu autoridad electoral antes de continuar.
          </p>
        </div>
      </div>
    </main>
  );
}
