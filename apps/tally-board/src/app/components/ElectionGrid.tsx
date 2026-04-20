import Link from "next/link";
import { ShieldCheck, ChevronRight } from "lucide-react";

export type ElectionGridProps = {
  relevantElections: Array<{
    electionId: string;
    manifestHash: string;
    phase: number;
    phaseLabel?: string;
  }>;
  phaseLabelEs: (label: string | undefined, phase: number) => string;
};

export function ElectionGrid({ relevantElections, phaseLabelEs }: ElectionGridProps) {
  if (relevantElections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
        <ShieldCheck className="w-16 h-16 text-slate-300 mb-6" />
        <p className="text-xl font-bold font-mono tracking-widest text-slate-500">SISTEMA EN ESPERA</p>
        <p className="admin-page-subtitle mt-2 max-w-md m-0 mx-auto">No se detectan elecciones en fase de procesamiento, escrutinio o auditoría.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {relevantElections.map((election) => (
        <div key={election.electionId} className="card p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 group">
          <div className="space-y-3 w-full overflow-hidden">
            <div className="flex items-center gap-4">
              <div className="text-xl font-bold font-mono tracking-wider">
                ELEC_<span className="text-indigo-600">{String(election.electionId).padStart(4, '0')}</span>
              </div>
              <span className="badge badge-warning">
                FASE {election.phase}: {phaseLabelEs(election.phaseLabel, election.phase)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="admin-stat-label mb-0">MANIFEST_HASH:</span>
              <span className="hash-display truncate max-w-full" title={election.manifestHash}>
                {election.manifestHash}
              </span>
            </div>
          </div>

          <div className="flex-shrink-0 mt-4 md:mt-0">
            <Link
              href={`/tally/${election.electionId}`}
              className="admin-btn-primary w-full md:w-auto"
            >
              INICIAR PROTOCOLO
              <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
