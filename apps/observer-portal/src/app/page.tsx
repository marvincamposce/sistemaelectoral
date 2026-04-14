import { ethers } from "ethers";

import {
  fetchActaAnchors,
  fetchElection,
  fetchElectionCount,
  fetchElectionCounters,
} from "@blockurna/sdk";

import { getPublicEnv } from "./../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PHASE_LABELS = [
  "SETUP",
  "REGISTRY_OPEN",
  "REGISTRY_CLOSED",
  "VOTING_OPEN",
  "VOTING_CLOSED",
  "PROCESSING",
  "TALLYING",
  "RESULTS_PUBLISHED",
  "AUDIT_WINDOW",
  "ARCHIVED",
] as const;

export default async function Page() {
  const env = getPublicEnv();

  let sourceLabel = "";
  let count = 0;
  let elections: Array<{
    id: string;
    election: {
      manifestHash: string;
      authority: string;
      registryAuthority: string;
      coordinatorPubKey: string;
      phase: bigint;
      createdAtBlock: bigint;
    };
    counters: { signups: bigint; ballots: bigint };
    actas: Array<{ kind: number; snapshotHash: string; blockNumber: number; txHash: string }>;
  }> = [];

  if (env.mode === "api") {
    sourceLabel = `API: ${env.NEXT_PUBLIC_EVIDENCE_API_URL}`;
    const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const rows = (data?.elections ?? []) as any[];
    elections = rows.map((r) => ({
      id: String(r.electionId),
      election: {
        manifestHash: String(r.manifestHash),
        authority: String(r.authority),
        registryAuthority: String(r.registryAuthority),
        coordinatorPubKey: String(r.coordinatorPubKey),
        phase: BigInt(r.phase ?? 0),
        createdAtBlock: BigInt(r.createdAtBlock ?? 0),
      },
      counters: {
        signups: BigInt(r.counts?.signups ?? 0),
        ballots: BigInt(r.counts?.ballots ?? 0),
      },
      actas: ((r.actas ?? []) as any[]).map((a) => ({
        kind: Number(a.kind ?? 0),
        snapshotHash: String(a.snapshotHash),
        blockNumber: Number(a.blockNumber ?? 0),
        txHash: String(a.txHash),
      })),
    }));
    count = elections.length;
  } else {
    sourceLabel = `RPC: ${env.NEXT_PUBLIC_RPC_URL} · TPE: ${env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS}`;
    const provider = new ethers.JsonRpcProvider(env.NEXT_PUBLIC_RPC_URL);

    count = await fetchElectionCount(
      env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS,
      provider,
    );

    elections = await Promise.all(
      Array.from({ length: count }).map(async (_, idx) => {
        const election = await fetchElection(
          env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS,
          provider,
          idx,
        );
        const counters = await fetchElectionCounters(
          env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS,
          provider,
          idx,
        );
        const actas = await fetchActaAnchors(
          env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS,
          provider,
          idx,
        );
        return { id: String(idx), election, counters, actas };
      }),
    );
  }

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Observación electoral (BU‑PVP‑1)</h1>
          <p className="text-sm text-neutral-700">
            Tablero público de evidencias: fases, actas ancladas y verificación básica.
          </p>
          <div className="text-xs text-neutral-500 break-all">
            {sourceLabel}
          </div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4">
          <div className="text-sm font-medium">Elecciones registradas</div>
          <div className="mt-2 text-sm text-neutral-700">Total: {count}</div>
        </section>

        <div className="space-y-4">
          {elections.map(({ id, election, counters, actas }) => (
            <section
              key={id}
              className="rounded-lg border border-neutral-200 p-4 space-y-3"
            >
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Elección #{id}</div>
                <div className="text-xs text-neutral-600 break-all">
                  manifestHash: {election.manifestHash}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  authority (AEA): {election.authority}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  registryAuthority (REA signer): {election.registryAuthority}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Fase</div>
                  <div className="text-sm font-medium">
                    {PHASE_LABELS[Number(election.phase)] ?? `(${election.phase.toString()})`}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Registros (signup)</div>
                  <div className="text-sm font-medium">{counters.signups.toString()}</div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Boletas publicadas</div>
                  <div className="text-sm font-medium">{counters.ballots.toString()}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Actas ancladas (hashes)</div>
                <div className="mt-2 space-y-2">
                  {actas.length === 0 ? (
                    <div className="text-sm text-neutral-600">(Sin actas publicadas)</div>
                  ) : (
                    actas.map((a) => (
                      <div
                        key={`${a.kind}-${a.snapshotHash}-${a.txHash}`}
                        className="rounded-md border border-neutral-200 p-3"
                      >
                        <div className="text-xs text-neutral-500">
                          kind {a.kind} · block {a.blockNumber}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">
                          snapshotHash: {a.snapshotHash}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">
                          tx: {a.txHash}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          ))}

          {elections.length === 0 ? (
            <section className="rounded-lg border border-neutral-200 p-4">
              <div className="text-sm text-neutral-700">
                No hay elecciones todavía. Crea una elección con el contrato BU_PVP_1_ElectionRegistry.
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
