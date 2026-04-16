import Link from "next/link";
import { getEnv } from "@/lib/env";

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
    <main className="space-y-6">
      <section className="card p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Elecciones Pendientes de Escrutinio</h2>
          <span className="badge badge-info">Tally Queue</span>
        </div>
        {relevantElections.length === 0 ? (
          <p className="text-sm text-slate-500">No hay elecciones en fase de Tally / Procesamiento asíncrono.</p>
        ) : (
          <div className="space-y-4">
            {relevantElections.map((election: any) => (
              <div key={election.electionId} className="rounded-md border border-slate-200 p-4 bg-white flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Elección #{election.electionId}</div>
                  <div className="text-xs text-slate-500 mt-1">Fase Actual: {election.phaseLabel} ({election.phase})</div>
                  <div className="hash-display mt-2">Manifest: {election.manifestHash}</div>
                </div>
                <div>
                  <Link 
                    href={`/tally/${election.electionId}`} 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-md font-semibold transition"
                  >
                    Operar Tally
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
