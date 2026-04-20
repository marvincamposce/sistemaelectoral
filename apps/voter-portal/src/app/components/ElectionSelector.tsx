import { CheckCircle2, Vote, ChevronRight } from "lucide-react";

export type ElectionRow = {
  electionId: string;
  phaseLabel?: string;
  manifestHash: string;
  counts: { signups: number; ballots: number };
};

export type ElectionSelectorProps = {
  elections: ElectionRow[];
  loadingElections: boolean;
  electionsError: string;
  electionId: string;
  setElectionId: (id: string) => void;
  onContinue: () => void;
};

export function ElectionSelector({
  elections,
  loadingElections,
  electionsError,
  electionId,
  setElectionId,
  onContinue,
}: ElectionSelectorProps) {
  return (
    <div className="card p-8">
      <h2 className="section-title flex items-center gap-2">
        <Vote className="text-indigo-600" /> Selecciona una Elección
      </h2>
      <p className="admin-page-subtitle mb-6">Elige el proceso electoral en el que deseas participar.</p>
      
      {loadingElections ? (
        <div className="text-center py-8 text-slate-400 animate-pulse">Cargando elecciones seguras...</div>
      ) : electionsError ? (
        <div className="card p-5 border-red-200 bg-red-50 text-red-800">{electionsError}</div>
      ) : elections?.length === 0 ? (
        <div className="card p-5 text-center py-8 text-slate-500">No hay elecciones activas disponibles en este momento.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {elections?.map((election) => {
            const active = election.electionId === electionId;
            return (
              <div 
                key={election.electionId} 
                onClick={() => setElectionId(election.electionId)}
                className={`card p-5 cursor-pointer transition-all ${active ? 'ring-2 ring-indigo-500 bg-indigo-50' : 'hover:border-indigo-500'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg text-slate-900">Elección #{election.electionId}</span>
                  {active && <CheckCircle2 className="text-indigo-600" />}
                </div>
                <div className="text-sm text-slate-500 mb-4">{election.phaseLabel || "Fase Activa"}</div>
                <div className="flex gap-4 text-xs font-medium text-slate-400">
                  <span>{election.counts.signups} inscritos</span>
                  <span>{election.counts.ballots} votos</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      <div className="mt-8 flex justify-end">
        <button 
          onClick={onContinue} 
          disabled={!electionId}
          className="admin-btn-primary"
        >
          Continuar a Identificación <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
