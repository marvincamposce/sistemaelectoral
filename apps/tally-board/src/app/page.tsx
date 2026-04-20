import { getEnv } from "@/lib/env";
import { Database, Activity, Calculator } from "lucide-react";
import { LiveRefresh } from "./components/LiveRefresh";
import { TallyStats } from "./components/TallyStats";
import { ElectionGrid } from "./components/ElectionGrid";

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
    <div className="space-y-6">
      <div className="flex justify-end">
        <LiveRefresh label="En vivo" intervalMs={12000} />
      </div>

      <section className="card p-6">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="admin-page-title flex items-center gap-2">
                <Calculator className="w-6 h-6 text-indigo-600" />
                Centro de Escrutinio Criptográfico
              </h1>
              <p className="admin-page-subtitle m-0 mt-1">
                Ejecución de conteo ZK con evidencia trazable y verificación inmutable.
              </p>
            </div>
            <span className="badge badge-valid">
              <Activity className="w-3 h-3 mr-1" />
              SISTEMA EN LÍNEA
            </span>
          </div>

          <TallyStats relevantElectionsCount={relevantElections.length} />
        </div>
      </section>

      <section className="card">
        <div className="admin-card-header">
          <h2 className="section-title m-0">
            <Database className="w-4 h-4 text-indigo-600" />
            Matriz de Escrutinio
          </h2>
          <span className="hash-display border-none bg-transparent">
            BLOCK_HGT: LATEST
          </span>
        </div>

        <div className="p-6">
          <ElectionGrid relevantElections={relevantElections} phaseLabelEs={phaseLabelEs} />
        </div>
      </section>
    </div>
  );
}
