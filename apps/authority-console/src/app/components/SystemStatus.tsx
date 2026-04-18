export function SystemStatus({
  chainId,
  contractAddress,
}: {
  chainId: string;
  contractAddress: string;
}) {
  return (
    <div className="admin-card bg-slate-900 text-white">
      <div className="admin-card-body">
        <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400"></span> System Status
        </h2>
        <div className="space-y-3 mt-4 text-sm text-slate-300">
          <div className="flex justify-between">
            <span>API Connection</span>
            <span className="text-emerald-400 font-mono">OK</span>
          </div>
          <div className="flex justify-between">
            <span>Chain ID</span>
            <span className="font-mono text-slate-400">{chainId}</span>
          </div>
          <div className="flex justify-between">
            <span>Registry Contract</span>
            <span className="font-mono text-xs text-slate-400 truncate max-w-[150px]">{contractAddress}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
