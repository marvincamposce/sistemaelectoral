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
    <main className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-50 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
        <svg className="absolute left-[10%] top-[20%] w-32 h-32 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>

      <div className="max-w-md w-full space-y-8 z-10">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-slate-900 px-6 py-8 text-center relative border-b-4 border-indigo-500">
            <Lock className="mx-auto h-12 w-12 text-indigo-400 mb-4 animate-pulse opacity-80" />
            <h2 className="text-2xl font-black text-white tracking-tight uppercase">Autenticación de Red</h2>
            <p className="mt-2 text-xs text-indigo-200 font-mono">PROTOCOLO BU-PVP-1 / ENLACE SEGURO</p>
          </div>
          
          <div className="px-8 py-8 bg-white">
            <div className="flex items-start gap-4 p-4 mb-6 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
               <Fingerprint className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
               <p>
                 Para solicitar tu boleta cifrada, debes conectarte al canal seguro de la elección. 
                 <br/><br/><strong>Requisito:</strong> Necesitarás tu <code>Permit JSON</code> (Credencial Anónima) validado por la Autoridad de Registro (REA).
               </p>
            </div>

            <form onSubmit={handleStart} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="electionId" className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <Network className="w-4 h-4 text-slate-500" />
                  Identificador de Elección On-Chain
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-slate-400 font-mono text-sm">ID:</span>
                  </div>
                  <input
                    id="electionId"
                    type="text"
                    required
                    value={electionId}
                    onChange={(e) => setElectionId(e.target.value)}
                    disabled={isAttempting}
                    className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono tracking-wider transition-all disabled:opacity-50 disabled:bg-slate-100"
                    placeholder="Ej. 1"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!electionId.trim() || isAttempting}
                className="group relative w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden shadow-md"
              >
                {isAttempting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Estableciendo conexión túnel...</span>
                  </>
                ) : (
                  <>
                    <span>APERTURA DE CANAL CRIPTOGRÁFICO</span>
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
