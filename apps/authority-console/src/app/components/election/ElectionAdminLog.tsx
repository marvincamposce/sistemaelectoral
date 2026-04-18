import React from "react";

type ElectionAdminLogProps = {
  electionIdStr: string;
  adminLog: any[];
};

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

export function ElectionAdminLog({ electionIdStr, adminLog }: ElectionAdminLogProps) {
  return (
    <section className="admin-card p-6 space-y-3 bg-slate-950 border-slate-900 shadow-inner">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h3 className="text-sm font-bold text-slate-100 font-mono tracking-widest">/var/log/aea/admin.log</h3>
        </div>
        <div className="text-[10px] text-slate-500 font-mono flex gap-3">
          <a className="hover:text-amber-400 transition-colors" href={`/api/elections/${encodeURIComponent(electionIdStr)}/admin-log`}>[EXPORT JSON]</a>
          <a className="hover:text-amber-400 transition-colors" href={`/api/elections/${encodeURIComponent(electionIdStr)}/manifest`}>[MANIFEST]</a>
        </div>
      </div>
      
      {adminLog.length === 0 ? (
        <div className="text-xs text-slate-600 font-mono py-4">{'>> EOF - No hay entradas aún'}</div>
      ) : (
        <div className="space-y-1 font-mono text-[11px] h-64 overflow-y-auto pr-2 custom-scrollbar">
          {adminLog.map((e) => (
            <div key={e.entryId} className="border-l-2 border-slate-800 pl-3 py-1 hover:bg-slate-900 transition-colors group">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">[{formatTimestamp(e.createdAt)}]</span>
                    {e.severity === 'CRITICAL' ? (
                      <span className="text-rose-500 font-bold">[{e.severity}]</span>
                    ) : e.severity === 'WARNING' ? (
                      <span className="text-amber-400 font-bold">[{e.severity}]</span>
                    ) : (
                      <span className="text-sky-400 font-bold">[{e.severity || 'INFO'}]</span>
                    )}
                    <span className="text-indigo-300 font-semibold">{e.code}</span>
                  </div>
                  <div className="text-slate-300 group-hover:text-white transition-colors">{'>'} {e.message}</div>
                  {e.relatedTxHash ? (
                    <div className="text-slate-500 flex items-center gap-1 mt-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      TX: <span className="text-slate-400">{e.relatedTxHash}</span>
                    </div>
                  ) : null}
                </div>
                <div className="text-[9px] text-slate-700">IDX:{e.entryId}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
