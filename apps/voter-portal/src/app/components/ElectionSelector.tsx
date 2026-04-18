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
    <div className="vp-glass-panel p-8">
      <h2 className="vp-title-section flex items-center gap-2">
        <Vote className="text-[var(--color-brand-500)]" /> Selecciona una Elección
      </h2>
      <p className="vp-subtitle mb-6">Elige el proceso electoral en el que deseas participar.</p>
      
      {loadingElections ? (
        <div className="text-center py-8 text-[var(--text-tertiary)] animate-pulse">Cargando elecciones seguras...</div>
      ) : electionsError ? (
        <div className="vp-card border-red-200 bg-red-50 text-red-800">{electionsError}</div>
      ) : elections?.length === 0 ? (
        <div className="vp-card text-center py-8 text-[var(--text-secondary)]">No hay elecciones activas disponibles en este momento.</div>
      ) : (
        <div className="vp-grid-2">
          {elections?.map((election) => {
            const active = election.electionId === electionId;
            return (
              <div 
                key={election.electionId} 
                onClick={() => setElectionId(election.electionId)}
                className={`vp-card cursor-pointer ${active ? 'ring-2 ring-[var(--color-brand-500)] bg-[var(--color-brand-50)]' : 'hover:border-[var(--color-brand-500)]'}`}
              >
                <div className="vp-flex-between mb-2">
                  <span className="font-bold text-lg">Elección #{election.electionId}</span>
                  {active && <CheckCircle2 className="text-[var(--color-brand-600)]" />}
                </div>
                <div className="text-sm text-[var(--text-secondary)] mb-4">{election.phaseLabel || "Fase Activa"}</div>
                <div className="flex gap-4 text-xs font-medium text-[var(--text-tertiary)]">
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
          className="vp-btn-primary"
        >
          Continuar a Identificación <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
