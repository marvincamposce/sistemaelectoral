import Link from "next/link";
import { getEnv } from "@/lib/env";
import { Database, Activity, Calculator, ShieldCheck, ChevronRight } from "lucide-react";

type ElectionRow = {
  electionId: string;
  manifestHash: string;
  phase: number;
  phaseLabel?: string;
};

const PHASE_LABELS_ES: Record<string, string> = {
  SETUP: "Preparación",
  REGISTRY_OPEN: "Registro abierto",
  REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votación abierta",
  VOTING_CLOSED: "Votación cerrada",
  PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio",
  RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW_OPEN: "Auditoría abierta",
  ARCHIVED: "Archivada",
};

function phaseLabelEs(label: string | undefined, phase: number): string {
  const key = String(label ?? "").toUpperCase();
  return PHASE_LABELS_ES[key] ?? `Fase ${phase}`;
}

async function getElections() {
  const env = getEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${apiBase}/v1/elections`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.elections || []) as ElectionRow[];
  } catch {
    return [];
  }
}

export default async function TallyBoardHome() {
  const elections = await getElections();

  const relevantElections = elections.filter((e) => e.phase >= 5 && e.phase <= 7);

  return (
    <main className="max-w-4xl mx-auto py-10 space-y-6">
      <section className="card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              <Calculator className="w-7 h-7 text-indigo-600" />
              Centro de escrutinio criptográfico
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Ejecuta el conteo con una guía clara, evidencia trazable y verificación matemática.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">
            <Activity className="w-3.5 h-3.5" />
            Servicio disponible
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Elecciones en escrutinio</div>
            <div className="text-2xl font-bold text-slate-900">{relevantElections.length}</div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Rango de fases observado</div>
            <div className="text-lg font-semibold text-slate-900">5 a 7</div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Flujo actual</div>
            <div className="text-lg font-semibold text-slate-900">Descifrado y publicación</div>
          </article>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500" />
            Elecciones listas para escrutinio
          </h2>
          <span className="text-xs text-slate-500">
            Se muestran fases 5, 6 y 7
          </span>
        </div>

        <div className="p-6">
          {relevantElections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50">
              <ShieldCheck className="w-12 h-12 text-slate-400 mb-4" />
              <p className="text-slate-700 font-semibold text-lg">No hay elecciones pendientes</p>
              <p className="text-slate-500 text-sm mt-1">Cuando una elección entre en fase de escrutinio aparecerá aquí.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {relevantElections.map((election) => (
                <div key={election.electionId} className="group flex flex-col md:flex-row items-start md:items-center justify-between p-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors gap-4">
                  <div className="space-y-2 w-full overflow-hidden">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-bold text-slate-900">Elección #{election.electionId}</div>
                      <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {phaseLabelEs(election.phaseLabel, election.phase)} ({election.phase})
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
                      <span className="font-medium">Huella de manifiesto (hash):</span>
                      <span className="font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 truncate" title={election.manifestHash}>
                        {election.manifestHash}
                      </span>
                    </div>
                  </div>

                  <div className="flex-shrink-0 w-full md:w-auto">
                    <Link
                      href={`/tally/${election.electionId}`}
                      className="w-full md:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-6 py-3 rounded-lg font-semibold transition-all shadow-sm"
                    >
                      Abrir proceso
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
