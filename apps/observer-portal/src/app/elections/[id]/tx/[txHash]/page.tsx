import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEnv } from "../../../../../lib/env";
import { formatTimestamp, phaseLabelEs, fullHash } from "../../../../../lib/types";

export const revalidate = 0;

export default async function TransactionDetail(props: {
  params: Promise<{ id: string; txHash: string }>;
}) {
  const { id, txHash } = await props.params;
  const env = getPublicEnv();

  const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load elections: ${res.statusText}`);

  const { elections } = await res.json();
  const election = elections?.find((e: any) => String(e.electionId) === id);
  if (!election) notFound();

  // Fetch related events
  const [pcRes, anRes, baRes] = await Promise.all([
    fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(id)}/phase-changes`, { cache: "no-store" }).then(r => r.ok ? r.json() : { phaseChanges: [] }),
    fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(id)}/anchors`, { cache: "no-store" }).then(r => r.ok ? r.json() : { anchors: [] }),
    fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(id)}/ballots`, { cache: "no-store" }).then(r => r.ok ? r.json() : { ballots: [] }),
  ]);

  const phaseChanges = pcRes.phaseChanges || [];
  const anchors = anRes.anchors || [];
  const ballots = baRes.ballots || [];

  // Find the event matching this txHash
  const timelineEvents = [
    { key: `created:${election.electionId}`, blockNumber: election.createdAtBlock, blockTimestamp: election.createdAtTimestamp, txHash: election.createdTxHash, label: "Elección creada", detail: null, type: "creation" },
    ...phaseChanges.map((pc: any) => ({ key: `phase:${pc.txHash}:${pc.logIndex}`, blockNumber: pc.blockNumber, blockTimestamp: pc.blockTimestamp, txHash: pc.txHash, label: "Cambio de fase", detail: `${pc.previousPhaseLabel} → ${pc.newPhaseLabel}`, type: "phase" })),
    ...anchors.map((a: any) => ({ key: `anchor:${a.txHash}:${a.logIndex}`, blockNumber: a.blockNumber, blockTimestamp: a.blockTimestamp, txHash: a.txHash, label: "Acta anclada", detail: `Tipo ${a.kind}`, type: "anchor" })),
    ...ballots.map((b: any) => ({ key: `ballot:${b.txHash}:${b.logIndex}`, blockNumber: b.blockNumber, blockTimestamp: b.blockTimestamp, txHash: b.txHash, label: `Boleta #${b.ballotIndex}`, detail: null, type: "ballot" })),
  ];

  const event = timelineEvents.find(e => e.txHash && e.txHash.toLowerCase() === txHash.toLowerCase());
  
  if (!event) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 text-sm text-slate-500 font-medium">
        <Link href={`/elections/${id}`} className="hover:text-indigo-600 transition-colors">
          ← Volver a la Elección #{id}
        </Link>
        <span>/</span>
        <span className="text-slate-900">Transacción</span>
      </div>

      <h1 className="admin-page-title m-0">Detalles de la Transacción</h1>
      <p className="admin-page-subtitle">Evidencia criptográfica registrada en cadena.</p>

      <div className="card p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Tipo de Evento</div>
            <div className="text-lg font-bold text-slate-900">{event.label}</div>
            {event.detail && (
              <div className="text-sm text-slate-600 mt-1">{event.detail}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Estado en Blockchain</div>
            <span className="badge badge-valid">Confirmado</span>
          </div>

          <div className="md:col-span-2 border-t border-slate-100 pt-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Hash de Transacción</div>
                <div className="hash-display bg-slate-50" style={{ wordBreak: 'break-all' }}>
                  {event.txHash}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bloque</div>
                  <div className="text-base font-bold text-slate-900">{event.blockNumber}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Fecha y Hora</div>
                  <div className="text-sm text-slate-600">{formatTimestamp(event.blockTimestamp)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
