import Link from "next/link";
import { LiveRefresh } from "../../../components/LiveRefresh";
import { ActionNotice } from "../../../components/ActionNotice";
import { ElectionHeader } from "../../../components/election/ElectionHeader";
import { loadElectionData } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ElectionDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ aviso?: string; tipo?: string }>;
}) {
  const resolved = await params;
  const query = searchParams ? await searchParams : undefined;
  const data = await loadElectionData(resolved.id);

  if (!data.ok) {
    return (
      <div className="admin-card p-6 text-center text-sm text-slate-500">
        Faltan variables de entorno para operar la consola AEA.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <ActionNotice codigo={query?.aviso} tipo={query?.tipo} />
        <LiveRefresh label="Estado de elección en vivo" intervalMs={15000} />
      </div>

      <ElectionHeader
        electionIdStr={data.electionIdStr}
        chainId={data.env.CHAIN_ID}
        contractAddress={data.env.CONTRACT_ADDRESS}
        apiUrl={data.env.EVIDENCE_API_URL}
        phasesRes={data.phasesRes}
        phaseChangesRes={data.phaseChangesRes}
        anchorsRes={data.anchorsRes}
        actsRes={data.actsRes}
        activeIncidents={data.activeIncidents}
        evidenceApiUnavailable={data.evidenceApiUnavailable}
      />

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="admin-card p-5 space-y-4">
          <div>
            <div className="admin-section-title m-0">Qué puedes hacer aquí</div>
            <div className="text-sm text-slate-600 mt-1">
              Esta vista concentra cuatro frentes: estado on-chain, catálogo oficial, transición de fases y evidencia administrativa.
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Revisar estado", "Confirma manifest, coordinator key, autoridades y fase actual antes de tocar nada."],
              ["Editar catálogo", "Solo mientras la fase lo permita. Cada cambio regenera el manifiesto materializado."],
              ["Mover fases", "Dispara transiciones on-chain solo cuando el proceso operativo ya esté listo."],
              ["Anclar evidencia", "Publica actas e incidentes con contexto trazable para observer e indexación."],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm font-semibold text-slate-900">{title}</div>
                <div className="mt-2 text-xs text-slate-600">{copy}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-card p-5 space-y-4">
          <div>
            <div className="admin-section-title m-0">Lectura rápida</div>
            <div className="text-sm text-slate-600 mt-1">Resumen corto para operadores antes de entrar a la parte técnica.</div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Fase actual</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{data.currentPhaseLabel}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Catálogo</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{data.catalogMutable ? "Editable" : "Bloqueado por fase"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incidentes</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{data.activeIncidents.length} activo(s)</div>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
