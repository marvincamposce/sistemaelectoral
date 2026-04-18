"use client";

import React, { useState, useTransition } from "react";
import { Plus, Edit2, X, AlertCircle } from "lucide-react";

type Candidate = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: string;
  colorHex?: string | null;
  metadataJson?: any;
};

type ElectionCatalogProps = {
  electionIdStr: string;
  candidates: Candidate[];
  currentManifest: any;
  catalogMutable: boolean;
  hasBallotOrderCollisions: boolean;
  createOrUpdateCandidateAction: (formData: FormData) => Promise<void>;
  updateCandidateStatusAction: (formData: FormData) => Promise<void>;
};

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export function ElectionCatalog({
  electionIdStr,
  candidates,
  currentManifest,
  catalogMutable,
  hasBallotOrderCollisions,
  createOrUpdateCandidateAction,
  updateCandidateStatusAction,
}: ElectionCatalogProps) {
  const [isPending, startTransition] = useTransition();
  const [editingCand, setEditingCand] = useState<Candidate | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [formState, setFormState] = useState<Partial<Candidate>>({});

  const handleOpenModal = (cand?: Candidate) => {
    if (cand) {
      setEditingCand(cand);
      setFormState(cand);
    } else {
      setEditingCand(null);
      setFormState({
        ballotOrder: candidates.length + 1,
        status: "ACTIVE",
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCand(null);
    setFormState({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catalogMutable) return;

    const fd = new FormData();
    fd.append("electionId", electionIdStr);
    fd.append("id", formState.id || "");
    fd.append("candidateCode", formState.candidateCode || "");
    fd.append("displayName", formState.displayName || "");
    fd.append("shortName", formState.shortName || "");
    fd.append("partyName", formState.partyName || "");
    fd.append("ballotOrder", String(formState.ballotOrder || 1));
    fd.append("status", formState.status || "ACTIVE");
    if (formState.colorHex) fd.append("colorHex", formState.colorHex);
    
    // Convert object to string if it's an object, or use the string value
    if (formState.metadataJson) {
      const meta = typeof formState.metadataJson === 'string' 
        ? formState.metadataJson 
        : JSON.stringify(formState.metadataJson);
      fd.append("metadataJson", meta);
    } else {
      fd.append("metadataJson", "{}");
    }

    startTransition(async () => {
      try {
        await createOrUpdateCandidateAction(fd);
        handleCloseModal();
      } catch (err) {
        console.error("Error saving candidate:", err);
      }
    });
  };

  const handleStatusChange = (candId: string, newStatus: string) => {
    if (!catalogMutable) return;
    const fd = new FormData();
    fd.append("electionId", electionIdStr);
    fd.append("id", candId);
    fd.append("status", newStatus);

    startTransition(async () => {
      try {
        await updateCandidateStatusAction(fd);
      } catch (err) {
        console.error("Error updating status:", err);
      }
    });
  };

  return (
    <section className="admin-card p-6 space-y-6">
      {/* Header and Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="admin-section-title m-0">Catálogo Oficial de Candidaturas</h2>
            <span className={catalogMutable ? "admin-badge admin-badge-valid" : "admin-badge admin-badge-warning"}>
              {catalogMutable ? "Editable" : "Bloqueado"}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Gestiona los candidatos de la elección. Los cambios regeneran automáticamente el manifiesto materializado.
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          disabled={!catalogMutable || isPending}
          className="admin-btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <Plus size={16} />
          <span>Añadir Candidatura</span>
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="admin-stat-card border border-slate-200">
          <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">Candidatos</span>
          <span className="text-2xl font-bold text-slate-900">{candidates.length}</span>
        </article>
        <article className="admin-stat-card border border-slate-200">
          <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">Activos</span>
          <span className="text-2xl font-bold text-slate-900">
            {candidates.filter((c) => c.status === "ACTIVE").length}
          </span>
        </article>
        <article className="admin-stat-card border border-slate-200">
          <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">Manifiesto Actual</span>
          <span className="text-sm font-mono font-medium text-slate-900 break-all">
            {shortHash(currentManifest?.manifestHash ?? null)}
          </span>
        </article>
        <article className={`admin-stat-card border ${hasBallotOrderCollisions ? 'bg-red-50 border-red-200' : 'border-slate-200'}`}>
          <span className={`text-xs uppercase tracking-wide font-medium ${hasBallotOrderCollisions ? 'text-red-600' : 'text-slate-500'}`}>
            Orden en Papeleta
          </span>
          <span className={`text-sm font-bold ${hasBallotOrderCollisions ? 'text-red-700' : 'text-slate-900'}`}>
            {hasBallotOrderCollisions ? "Duplicado detectado" : "Consistente"}
          </span>
        </article>
      </div>

      {/* Table / List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {candidates.length === 0 ? (
          <div className="p-8 text-center text-slate-500 flex flex-col items-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <AlertCircle size={24} className="text-slate-400" />
            </div>
            <p className="font-medium text-slate-900">No hay candidaturas registradas</p>
            <p className="text-sm mt-1">Haz clic en "Añadir Candidatura" para comenzar a poblar el catálogo.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600 font-semibold">
                <tr>
                  <th className="px-4 py-3">Orden</th>
                  <th className="px-4 py-3">Candidato</th>
                  <th className="px-4 py-3">Partido</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.sort((a, b) => a.ballotOrder - b.ballotOrder).map((candidate) => (
                  <tr key={candidate.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 w-16">
                      {candidate.ballotOrder}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {candidate.colorHex ? (
                          <div className="w-6 h-6 rounded-md shadow-sm border border-slate-200" style={{ backgroundColor: candidate.colorHex }}></div>
                        ) : (
                          <div className="w-6 h-6 rounded-md bg-slate-100 border border-slate-200"></div>
                        )}
                        <div>
                          <div className="font-semibold text-slate-900">{candidate.displayName}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">{candidate.candidateCode}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{candidate.partyName}</td>
                    <td className="px-4 py-3">
                      <select
                        value={candidate.status}
                        onChange={(e) => handleStatusChange(candidate.id, e.target.value)}
                        disabled={!catalogMutable || isPending}
                        className={`text-xs font-semibold py-1 px-2 rounded-md border appearance-none cursor-pointer outline-none transition-colors
                          ${candidate.status === 'ACTIVE' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                            : candidate.status === 'WITHDRAWN'
                              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                      >
                        <option value="ACTIVE">Activo</option>
                        <option value="INACTIVE">Inactivo</option>
                        <option value="WITHDRAWN">Retirado</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleOpenModal(candidate)}
                        disabled={!catalogMutable || isPending}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                        title="Editar candidato"
                      >
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500 pt-2 flex items-center justify-between">
        {currentManifest ? (
          <span>
            Última actualización: <strong>{formatTimestamp(currentManifest.updatedAt)}</strong>
          </span>
        ) : (
          <span>Esperando primer manifiesto materializado.</span>
        )}
        {isPending && <span className="text-blue-600 font-medium animate-pulse">Guardando cambios...</span>}
      </div>

      {/* Modal / Overlay for Edit/Add */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-lg font-semibold text-slate-900">
                {editingCand ? "Editar Candidatura" : "Nueva Candidatura"}
              </h3>
              <button onClick={handleCloseModal} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">ID del Sistema</label>
                  <input 
                    required 
                    className="admin-input" 
                    placeholder="cand-4" 
                    value={formState.id || ""}
                    onChange={e => setFormState({...formState, id: e.target.value})}
                    disabled={!!editingCand} // Cannot change ID of existing candidate
                  />
                  <p className="text-[11px] text-slate-500">Identificador único inmutable.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Código Oficial</label>
                  <input 
                    required 
                    className="admin-input" 
                    placeholder="CAND_4"
                    value={formState.candidateCode || ""}
                    onChange={e => setFormState({...formState, candidateCode: e.target.value})}
                  />
                </div>
                
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[13px] font-semibold text-slate-700">Nombre Completo</label>
                  <input 
                    required 
                    className="admin-input" 
                    placeholder="Ej. Juan Pérez"
                    value={formState.displayName || ""}
                    onChange={e => setFormState({...formState, displayName: e.target.value})}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Nombre Corto</label>
                  <input 
                    required 
                    className="admin-input" 
                    placeholder="J. Pérez"
                    value={formState.shortName || ""}
                    onChange={e => setFormState({...formState, shortName: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Partido / Alianza</label>
                  <input 
                    required 
                    className="admin-input" 
                    placeholder="Partido Independiente"
                    value={formState.partyName || ""}
                    onChange={e => setFormState({...formState, partyName: e.target.value})}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Orden en Papeleta</label>
                  <input 
                    type="number" 
                    min={1} 
                    required 
                    className="admin-input"
                    value={formState.ballotOrder || ""}
                    onChange={e => setFormState({...formState, ballotOrder: parseInt(e.target.value) || 1})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Color (Hexadecimal)</label>
                  <div className="flex gap-2">
                    <input 
                      type="color" 
                      className="w-10 h-10 p-1 bg-white border border-slate-200 rounded-md cursor-pointer"
                      value={formState.colorHex || "#1D4ED8"}
                      onChange={e => setFormState({...formState, colorHex: e.target.value})}
                    />
                    <input 
                      className="admin-input flex-1 font-mono uppercase" 
                      placeholder="#1D4ED8"
                      value={formState.colorHex || ""}
                      onChange={e => setFormState({...formState, colorHex: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[13px] font-semibold text-slate-700 flex justify-between">
                    <span>Metadatos Adicionales (JSON)</span>
                    <span className="text-slate-400 font-normal">Opcional</span>
                  </label>
                  <textarea 
                    rows={2} 
                    className="admin-input font-mono text-xs" 
                    placeholder='{"coalitionName": "Frente Unido"}'
                    value={typeof formState.metadataJson === 'string' ? formState.metadataJson : JSON.stringify(formState.metadataJson || {})}
                    onChange={e => setFormState({...formState, metadataJson: e.target.value})}
                  />
                </div>
              </div>

              <div className="mt-8 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isPending}
                  className="admin-btn-primary min-w-[120px] shadow-sm flex justify-center items-center"
                >
                  {isPending ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span>Guardar Cambios</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
