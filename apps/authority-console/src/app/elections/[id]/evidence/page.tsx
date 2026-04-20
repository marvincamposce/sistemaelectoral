import { ActionNotice } from "../../../components/ActionNotice";
import { ElectionEvidence } from "../../../components/election/ElectionEvidence";
import { loadElectionData, publishActaAction, registerOperationalIncidentAction } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ElectionEvidencePage({
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
      <ActionNotice codigo={query?.aviso} tipo={query?.tipo} />

      <ElectionEvidence
        electionIdStr={data.electionIdStr}
        apiUrl={data.env.EVIDENCE_API_URL}
        consistencyRes={data.consistencyRes}
        incidentsRes={data.incidentsRes}
        anchorsRes={data.anchorsRes}
        actsRes={data.actsRes}
        activeIncidents={data.activeIncidents}
        criticalActive={data.criticalActive}
        warningActive={data.warningActive}
        infoActive={data.infoActive}
        consistencyOk={data.consistencyOk}
        latestAct={data.latestAct}
        latestTransition={data.latestTransition}
        phaseChangesRes={data.phaseChangesRes}
        publishActaAction={publishActaAction}
        registerOperationalIncidentAction={registerOperationalIncidentAction}
      />
    </div>
  );
}
