"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import electionContract from "@/contracts/BlockUrnaElection.json";

type PartyView = {
  id: number;
  name: string;
  voteCount: bigint;
};

type TxState =
  | { status: "idle" }
  | { status: "pending"; label: string; hash?: string }
  | { status: "success"; label: string; hash?: string }
  | { status: "error"; label: string; message: string };

function shortAddress(address: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function normalizeEthersError(error: unknown): string {
  if (typeof error === "string") return error;

  const anyErr = error as any;
  return (
    anyErr?.shortMessage ||
    anyErr?.reason ||
    anyErr?.message ||
    "Transacción fallida"
  );
}

const PHASE_LABELS = [
  "Setup",
  "Registro abierto",
  "Votación abierta",
  "Votación cerrada",
] as const;

const VOTER_STATUS_LABELS = [
  "No registrado",
  "Pendiente",
  "Aprobado",
  "Rechazado",
] as const;

export default function BlockUrnaApp() {
  const contractAddress = (electionContract as any).address as string;
  const contractChainId = (electionContract as any).chainId as string;
  const contractAbi = (electionContract as any).abi as any[];

  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [walletChainId, setWalletChainId] = useState<string>("");

  const [ownerAddress, setOwnerAddress] = useState<string>("");
  const [phase, setPhase] = useState<number | null>(null);
  const [parties, setParties] = useState<PartyView[]>([]);
  const [totalVotes, setTotalVotes] = useState<bigint>(BigInt(0));

  const [voterStatus, setVoterStatus] = useState<number | null>(null);
  const [hasVoted, setHasVoted] = useState<boolean>(false);
  const [votedPartyId, setVotedPartyId] = useState<bigint | null>(null);

  const [pendingVoters, setPendingVoters] = useState<string[]>([]);

  const [txState, setTxState] = useState<TxState>({ status: "idle" });

  const hasContractConfig =
    Boolean(contractAddress) && Array.isArray(contractAbi) && contractAbi.length > 0;

  const isWalletConnected = Boolean(walletAddress);

  const isAdmin = useMemo(() => {
    if (!walletAddress || !ownerAddress) return false;
    return walletAddress.toLowerCase() === ownerAddress.toLowerCase();
  }, [walletAddress, ownerAddress]);

  const isWrongNetwork = useMemo(() => {
    if (!contractChainId || !walletChainId) return false;
    return contractChainId !== walletChainId;
  }, [contractChainId, walletChainId]);

  const getReadContract = useCallback(() => {
    if (!provider || !hasContractConfig) return null;
    return new ethers.Contract(contractAddress, contractAbi, provider);
  }, [provider, hasContractConfig, contractAddress, contractAbi]);

  const getWriteContract = useCallback(() => {
    if (!signer || !hasContractConfig) return null;
    return new ethers.Contract(contractAddress, contractAbi, signer);
  }, [signer, hasContractConfig, contractAddress, contractAbi]);

  const connectWallet = useCallback(async () => {
    try {
      const eth = (globalThis as any).ethereum;
      if (!eth) {
        setTxState({
          status: "error",
          label: "Wallet",
          message: "Necesitas MetaMask (u otra wallet EIP-1193) instalada.",
        });
        return;
      }

      const nextProvider = new ethers.BrowserProvider(eth);
      await nextProvider.send("eth_requestAccounts", []);

      const nextSigner = await nextProvider.getSigner();
      const address = await nextSigner.getAddress();
      const net = await nextProvider.getNetwork();

      setProvider(nextProvider);
      setSigner(nextSigner);
      setWalletAddress(address);
      setWalletChainId(net.chainId.toString());

      setTxState({ status: "idle" });
    } catch (error) {
      setTxState({
        status: "error",
        label: "Wallet",
        message: normalizeEthersError(error),
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    const read = getReadContract();
    if (!read) return;

    try {
      const [owner, phaseValue, totalVotesValue, partyCountValue] =
        await Promise.all([
          read.owner(),
          read.phase(),
          read.totalVotes(),
          read.partyCount(),
        ]);

      setOwnerAddress(owner);
      setPhase(Number(phaseValue));
      setTotalVotes(BigInt(totalVotesValue));

      const count = Number(partyCountValue);
      const partyViews: PartyView[] = [];

      for (let i = 0; i < count; i++) {
        const p = await read.parties(i);
        const name = (p?.name ?? p?.[0] ?? "").toString();
        const voteCount = BigInt(p?.voteCount ?? p?.[1] ?? 0);
        partyViews.push({ id: i, name, voteCount });
      }

      setParties(partyViews);

      if (walletAddress) {
        const [status, voted, votedParty] = await Promise.all([
          read.voterStatus(walletAddress),
          read.hasVoted(walletAddress),
          read.votedPartyId(walletAddress),
        ]);
        setVoterStatus(Number(status));
        setHasVoted(Boolean(voted));
        setVotedPartyId(BigInt(votedParty));
      } else {
        setVoterStatus(null);
        setHasVoted(false);
        setVotedPartyId(null);
      }

      if (isAdmin) {
        const pending: string[] = await read.getPendingVoters();
        setPendingVoters(pending);
      } else {
        setPendingVoters([]);
      }
    } catch (error) {
      setTxState({
        status: "error",
        label: "Lectura",
        message: normalizeEthersError(error),
      });
    }
  }, [getReadContract, walletAddress, isAdmin]);

  const sendTx = useCallback(
    async (label: string, action: () => Promise<any>) => {
      try {
        setTxState({ status: "pending", label });
        const tx = await action();
        const hash = tx?.hash?.toString?.();
        setTxState({ status: "pending", label, hash });

        const receipt = await tx.wait?.();
        if (receipt?.status === 0) {
          throw new Error("La transacción fue revertida");
        }

        setTxState({ status: "success", label, hash });
        await refresh();
      } catch (error) {
        setTxState({
          status: "error",
          label,
          message: normalizeEthersError(error),
        });
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!provider) return;

    let cancelled = false;

    const syncNetwork = async () => {
      try {
        const net = await provider.getNetwork();
        if (!cancelled) {
          setWalletChainId(net.chainId.toString());
        }
      } catch {
        // ignore
      }
    };

    syncNetwork();

    const eth = (globalThis as any).ethereum;
    if (!eth?.on) return;

    const onChainChanged = () => {
      syncNetwork();
      refresh();
    };

    const onAccountsChanged = () => {
      connectWallet();
    };

    eth.on("chainChanged", onChainChanged);
    eth.on("accountsChanged", onAccountsChanged);

    return () => {
      cancelled = true;
      eth.removeListener?.("chainChanged", onChainChanged);
      eth.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [provider, connectWallet, refresh]);

  useEffect(() => {
    if (!isWalletConnected) return;
    refresh();
  }, [isWalletConnected, refresh]);

  const phaseLabel =
    phase === null ? "(sin cargar)" : PHASE_LABELS[phase] ?? `Desconocida (${phase})`;

  const voterStatusLabel =
    voterStatus === null
      ? "(sin cargar)"
      : VOTER_STATUS_LABELS[voterStatus] ?? `Desconocido (${voterStatus})`;

  const canRequestRegistration = phase === 1 && (voterStatus === 0 || voterStatus === 3);
  const canVote = phase === 2 && voterStatus === 2 && !hasVoted;

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold">BlockUrna</h1>
          <p className="text-sm text-neutral-600">
            Sistema de votación en blockchain (registro + aprobación + voto + conteo transparente)
          </p>
        </header>

        {!hasContractConfig && (
          <section className="rounded-lg border border-neutral-200 p-4">
            <h2 className="text-lg font-medium">Contrato no configurado</h2>
            <p className="mt-2 text-sm text-neutral-700">
              Falta el ABI/dirección del contrato. Ejecuta el deploy desde{' '}
              <span className="font-mono">BlockUrna/contracts</span> para generar el archivo.
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              Comandos sugeridos: <span className="font-mono">npm run node</span> y luego{' '}
              <span className="font-mono">npm run deploy:localhost</span>.
            </p>
          </section>
        )}

        <section className="rounded-lg border border-neutral-200 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Wallet</div>
              <div className="text-sm text-neutral-700">
                {walletAddress ? shortAddress(walletAddress) : "No conectada"}
                {walletChainId ? (
                  <span className="text-neutral-500"> · chainId {walletChainId}</span>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                onClick={connectWallet}
              >
                {walletAddress ? "Reconectar" : "Conectar wallet"}
              </button>
              <button
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                onClick={refresh}
                disabled={!isWalletConnected || !hasContractConfig}
              >
                Refrescar
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-sm font-medium">Contrato</div>
              <div className="text-sm text-neutral-700 break-all">
                {contractAddress || "(sin dirección)"}
              </div>
              {contractChainId ? (
                <div className="text-xs text-neutral-500">chainId esperado: {contractChainId}</div>
              ) : null}
              {isWrongNetwork ? (
                <div className="mt-2 text-xs text-red-700">
                  Estás en otra red. Cambia tu wallet al chainId {contractChainId}.
                </div>
              ) : null}
            </div>

            <div>
              <div className="text-sm font-medium">Estado</div>
              <div className="text-sm text-neutral-700">
                Fase: <span className="font-medium">{phaseLabel}</span>
              </div>
              <div className="text-sm text-neutral-700">
                Tu registro: <span className="font-medium">{voterStatusLabel}</span>
              </div>
              <div className="text-sm text-neutral-700">
                Votaste: <span className="font-medium">{hasVoted ? "Sí" : "No"}</span>
                {hasVoted && votedPartyId !== null ? (
                  <span className="text-neutral-500"> · partyId {votedPartyId.toString()}</span>
                ) : null}
              </div>
            </div>
          </div>

          {txState.status !== "idle" && (
            <div className="mt-4 rounded-md border border-neutral-200 p-3">
              <div className="text-sm font-medium">
                {txState.status === "pending" && "Enviando"}
                {txState.status === "success" && "Confirmado"}
                {txState.status === "error" && "Error"}
                {" · "}{txState.label}
              </div>
              {"hash" in txState && txState.hash ? (
                <div className="mt-1 text-xs text-neutral-600 break-all">{txState.hash}</div>
              ) : null}
              {txState.status === "error" ? (
                <div className="mt-1 text-sm text-red-700">{txState.message}</div>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-lg font-medium">Registro</h2>
          <p className="mt-1 text-sm text-neutral-700">
            Modelo: auto-registro → aprobación por admin.
          </p>

          <div className="mt-3">
            <button
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={!isWalletConnected || !hasContractConfig || isWrongNetwork || !canRequestRegistration}
              onClick={() => {
                const write = getWriteContract();
                if (!write) return;
                sendTx("Solicitar registro", () => write.requestRegistration());
              }}
            >
              Solicitar registro
            </button>
            {!canRequestRegistration ? (
              <div className="mt-2 text-xs text-neutral-500">
                Disponible solo cuando la fase es “Registro abierto” y tu estado es “No registrado” o “Rechazado”.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-lg font-medium">Votación</h2>
          <p className="mt-1 text-sm text-neutral-700">
            El conteo es on-chain y se actualiza en tiempo real al refrescar.
          </p>

          <div className="mt-4 grid gap-2">
            {parties.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-medium">{p.name || `Partido ${p.id}`}</div>
                  <div className="text-xs text-neutral-600">Votos: {p.voteCount.toString()}</div>
                </div>
                <button
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  disabled={!isWalletConnected || !hasContractConfig || isWrongNetwork || !canVote}
                  onClick={() => {
                    const write = getWriteContract();
                    if (!write) return;
                    sendTx("Votar", () => write.vote(p.id));
                  }}
                >
                  Votar
                </button>
              </div>
            ))}

            {parties.length === 0 ? (
              <div className="text-sm text-neutral-600">(Sin partidos cargados)</div>
            ) : null}

            <div className="text-sm text-neutral-700">
              Total de votos: <span className="font-medium">{totalVotes.toString()}</span>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-lg font-medium">Admin</h2>
          {isWalletConnected ? (
            <p className="mt-1 text-sm text-neutral-700">
              {isAdmin
                ? "Eres admin (owner del contrato)."
                : "Conecta la wallet del owner para administrar."}
            </p>
          ) : (
            <p className="mt-1 text-sm text-neutral-700">Conecta una wallet para ver permisos.</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              disabled={!isAdmin || !hasContractConfig || isWrongNetwork || phase !== 0}
              onClick={() => {
                const write = getWriteContract();
                if (!write) return;
                sendTx("Abrir registro", () => write.openRegistration());
              }}
            >
              Abrir registro
            </button>

            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              disabled={!isAdmin || !hasContractConfig || isWrongNetwork || phase !== 1}
              onClick={() => {
                const write = getWriteContract();
                if (!write) return;
                sendTx("Abrir votación", () => write.openVoting());
              }}
            >
              Abrir votación
            </button>

            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              disabled={!isAdmin || !hasContractConfig || isWrongNetwork || phase !== 2}
              onClick={() => {
                const write = getWriteContract();
                if (!write) return;
                sendTx("Cerrar votación", () => write.closeVoting());
              }}
            >
              Cerrar votación
            </button>
          </div>

          {isAdmin && (
            <div className="mt-5">
              <div className="text-sm font-medium">Solicitudes pendientes</div>
              <div className="mt-2 grid gap-2">
                {pendingVoters.map((addr) => (
                  <div
                    key={addr}
                    className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="text-sm text-neutral-700 break-all">{addr}</div>
                    <div className="flex gap-2">
                      <button
                        className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                        disabled={!hasContractConfig || isWrongNetwork || phase !== 1}
                        onClick={() => {
                          const write = getWriteContract();
                          if (!write) return;
                          sendTx("Aprobar votante", () => write.approveVoter(addr));
                        }}
                      >
                        Aprobar
                      </button>
                      <button
                        className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                        disabled={!hasContractConfig || isWrongNetwork || phase !== 1}
                        onClick={() => {
                          const write = getWriteContract();
                          if (!write) return;
                          sendTx("Rechazar votante", () => write.rejectVoter(addr));
                        }}
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}

                {pendingVoters.length === 0 ? (
                  <div className="text-sm text-neutral-600">(No hay solicitudes)</div>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <footer className="pb-6 text-xs text-neutral-500">
          Consejo demo: en MetaMask agrega la red local (chainId 31337) y usa cuentas del nodo Hardhat.
        </footer>
      </div>
    </main>
  );
}
