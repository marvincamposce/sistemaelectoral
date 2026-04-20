import { ActionNotice } from "../../../components/ActionNotice";
import { ElectionAdminLog } from "../../../components/election/ElectionAdminLog";
import { loadElectionData } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ElectionLogsPage({
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

      <ElectionAdminLog
        electionIdStr={data.electionIdStr}
        adminLog={data.adminLog}
      />
    </div>
  );
}
