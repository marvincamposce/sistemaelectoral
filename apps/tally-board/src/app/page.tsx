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
      <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-4">Elecciones Pendientes de Escrutinio</h2>
        {relevantElections.length === 0 ? (
          <p className="text-sm text-neutral-400">No hay elecciones en fase de Tally / Procesamiento asíncrono.</p>
        ) : (
          <div className="space-y-4">
            {relevantElections.map((election: any) => (
              <div key={election.electionId} className="border border-neutral-700 rounded-md p-4 bg-neutral-900 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-200">Elección #{election.electionId}</div>
                  <div className="text-xs text-neutral-400 mt-1">Fase Actual: {election.phaseLabel} ({election.phase})</div>
                  <div className="text-[10px] text-neutral-500 font-mono mt-1 break-all">Manifest: {election.manifestHash}</div>
                </div>
                <div>
                  <Link 
                    href={`/tally/${election.electionId}`} 
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-2 rounded-md font-semibold transition"
                  >
                    Operar Tally
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
