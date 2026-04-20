export function SystemStatus({
  chainId,
  contractAddress,
}: {
  chainId: string;
  contractAddress: string;
}) {
  const shortContract = contractAddress.length > 20
    ? `${contractAddress.slice(0, 10)}…${contractAddress.slice(-8)}`
    : contractAddress;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/30" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Estado del sistema</h2>
      </div>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-slate-500">Conexión API</span>
          <span className="badge badge-valid">Conectado</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-500">Red blockchain</span>
          <span className="hash-display">{chainId}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-500">Contrato</span>
          <span className="hash-display" title={contractAddress}>{shortContract}</span>
        </div>
      </div>
    </div>
  );
}
