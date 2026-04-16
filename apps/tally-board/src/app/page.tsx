import Link from "next/link";
import { getEnv } from "@/lib/env";
import { Database, Activity, Calculator, ShieldCheck, ChevronRight } from "lucide-react";

async function getElections() {
  const env = getEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${apiBase}/v1/elections`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.elections || [];
  } catch {
    return [];
  }
}

export default async function TallyBoardHome() {
  const elections = await getElections();

  // We primarily care about elections in Processing, Tallying, or Results Published phases (Phases 5, 6, 7)
  const relevantElections = elections.filter((e: any) => e.phase >= 5 && e.phase <= 7);

  return (
    <main className="max-w-4xl mx-auto py-10 space-y-8">
      <div className="flex items-center justify-between pb-6 border-b-2 border-slate-200">
         <div>
           <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
             <Calculator className="w-8 h-8 text-indigo-600" />
             Centro de Escrutinio Criptográfico
           </h1>
           <p className="mt-2 text-sm text-slate-500 font-mono">zk-SNARK PROVER QUEUE / BLOCKURNA SYSTEM</p>
         </div>
         <div className="flex items-center gap-3">
           <span className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200">
             <Activity className="w-3 h-3" />
             ONLINE
           </span>
         </div>
      </div>

      <section className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 bg-black/40 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500" />
            Cola de Tareas de Escrutinio Abiertas
          </h2>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700 font-mono">
            Mostrando Fases 5 - 7
          </span>
        </div>
        
        <div className="p-6">
          {relevantElections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-700 rounded-xl bg-slate-800/30">
              <ShieldCheck className="w-12 h-12 text-slate-600 mb-4" />
              <p className="text-slate-400 font-medium text-lg">Cola de procesamiento vacía</p>
              <p className="text-slate-500 text-sm mt-2">No hay elecciones en fase de Tally esperando descifrado.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {relevantElections.map((election: any) => (
                <div key={election.electionId} className="group flex flex-col md:flex-row items-start md:items-center justify-between p-5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 transition-colors gap-4">
                  <div className="space-y-1 w-full overflow-hidden">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-bold text-white">Elección #{election.electionId}</div>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {election.phaseLabel} ({election.phase})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 flex items-center gap-2 truncate">
                      <span className="text-slate-500 font-mono">MANIFEST:</span>
                      <span className="font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-700 truncate" title={election.manifestHash}>
                        {election.manifestHash}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex-shrink-0 w-full md:w-auto">
                    <Link 
                      href={`/tally/${election.electionId}`} 
                      className="w-full md:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-6 py-3 rounded-lg font-bold transition-all shadow-lg shadow-indigo-900/20 hover:shadow-indigo-900/40"
                    >
                      Ejecutar Job
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
