import Link from "next/link";

import { getPublicEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PhasesResponse = {
  ok: boolean;
  election: {
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
  };
};

type SignupsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueNullifiers: number };
};

type SignupsListResponse = {
  ok: boolean;
  electionId: string;
  page: null | { limit: number; order: "asc" | "desc"; nextCursor: string | null };
  signups: Array<{
    registryNullifier: string;
    votingPubKey: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
    permit:
      | null
      | {
          credentialId: string | null;
          issuerAddress: string | null;
          permitSig: string;
          issuedAt: string | null;
          recordedAt: string | null;
        };
    validity: {
      status: "VALID" | "UNVERIFIED" | "INVALID";
      reason: string | null;
      recoveredIssuerAddress: string | null;
      error?: string;
    };
  }>;
};

function validityBadge(status: string): { label: string; className: string } {
  const s = String(status ?? "").toUpperCase();
  if (s === "VALID") return { label: "VÁLIDA", className: "bg-neutral-900 text-white" };
  if (s === "UNVERIFIED") return { label: "SIN BITÁCORA", className: "bg-neutral-200 text-neutral-900" };
  return { label: "INVÁLIDA", className: "bg-neutral-700 text-white" };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Evidence API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

export default async function SignupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const env = getPublicEnv();
  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");

  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  const electionId = String(resolvedParams.id);
  const cursor = typeof resolvedSearchParams.cursor === "string" ? resolvedSearchParams.cursor : null;

  const election = await safeFetchJson<PhasesResponse | null>(
    `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/phases`,
    null,
  );

  if (!election || !election.ok) {
    return (
      <main className="min-h-screen bg-white text-neutral-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold break-all">Signups</h1>
              <div className="rounded-md px-3 py-1 text-xs font-semibold bg-neutral-200 text-neutral-900">
                NO ENCONTRADA
              </div>
            </div>
            <div className="text-xs text-neutral-600">
              Elección #{electionId} · <Link className="underline" href="/">volver</Link>
            </div>
            <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
          </header>

          <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
            <div className="text-sm font-medium">No se encontró la elección</div>
            <div className="text-sm text-neutral-700">
              La Evidence API configurada no tiene metadatos para esta elección.
            </div>
          </section>
        </div>
      </main>
    );
  }

  const [summary, list] = await Promise.all([
    safeFetchJson<SignupsSummaryResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups/summary`,
      { ok: true, summary: { total: 0, uniqueNullifiers: 0 } },
    ),
    safeFetchJson<SignupsListResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/signups?order=desc&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { ok: true, electionId, page: { limit: 50, order: "desc", nextCursor: null }, signups: [] },
    ),
  ]);

  const page = list.page;
  const nextCursor = page?.nextCursor ?? null;

  const recent = (list.signups ?? []).slice(0, 10);

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold break-all">Signups · Elección #{electionId}</h1>
            <div className="rounded-md px-3 py-1 text-xs font-semibold bg-neutral-200 text-neutral-900">
              {election.election.phaseLabel}
            </div>
          </div>
          <div className="text-xs text-neutral-600">
            <Link className="underline" href="/">volver</Link>
          </div>
          <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-1">
          <div className="text-sm font-medium">Resumen</div>
          <div className="text-sm text-neutral-700">total: {summary.summary.total}</div>
          <div className="text-sm text-neutral-700">nullifiers únicos: {summary.summary.uniqueNullifiers}</div>
          <div className="text-xs text-neutral-600 break-all">registryAuthority (REA signer): {election.election.registryAuthority}</div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Timeline (últimos 10)</div>
          {recent.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin signups)</div>
          ) : (
            <div className="space-y-2">
              {recent.map((s) => {
                const badge = validityBadge(s.validity?.status);
                return (
                  <div key={`${s.txHash}:${s.logIndex}`} className="rounded-md border border-neutral-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-neutral-500">
                        block {s.blockNumber}
                        {s.blockTimestamp ? ` · ${s.blockTimestamp}` : ""}
                      </div>
                      <div className={`rounded px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</div>
                    </div>
                    <div className="text-xs text-neutral-700 break-all">nullifier: {s.registryNullifier}</div>
                    <div className="text-xs text-neutral-700 break-all">tx: {s.txHash}</div>
                    <div className="mt-2">
                      <a
                        className="text-xs text-neutral-700 underline"
                        href={`/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(s.txHash)}/${encodeURIComponent(String(s.logIndex))}`}
                      >
                        Ver evidencia
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Tabla (paginada)</div>
            <div className="text-xs text-neutral-600">
              {page ? `orden: ${page.order} · limit: ${page.limit}` : ""}
            </div>
          </div>

          {list.signups.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin signups)</div>
          ) : (
            <div className="space-y-2">
              {list.signups.map((s) => {
                const badge = validityBadge(s.validity?.status);
                const evidenceUrl = `/elections/${encodeURIComponent(electionId)}/signups/${encodeURIComponent(s.txHash)}/${encodeURIComponent(String(s.logIndex))}`;
                return (
                  <div key={`${s.txHash}:${s.logIndex}`} className="rounded-md border border-neutral-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-neutral-500">
                        block {s.blockNumber}
                        {s.blockTimestamp ? ` · ${s.blockTimestamp}` : ""}
                      </div>
                      <div className={`rounded px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</div>
                    </div>
                    <div className="text-xs text-neutral-700 break-all">registryNullifier: {s.registryNullifier}</div>
                    <div className="text-xs text-neutral-700 break-all">votingPubKey: {s.votingPubKey}</div>
                    <div className="text-xs text-neutral-700 break-all">tx: {s.txHash}</div>
                    <div className="mt-2">
                      <a className="text-xs text-neutral-700 underline" href={evidenceUrl}>
                        Ver evidencia
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-xs text-neutral-600 break-all">
              {cursor ? `cursor: ${cursor}` : ""}
            </div>
            <div className="flex items-center gap-3">
              {cursor ? (
                <a className="text-xs text-neutral-700 underline" href={`/elections/${encodeURIComponent(electionId)}/signups`}>
                  Inicio
                </a>
              ) : null}
              {nextCursor ? (
                <a
                  className="text-xs text-neutral-700 underline"
                  href={`/elections/${encodeURIComponent(electionId)}/signups?cursor=${encodeURIComponent(nextCursor)}`}
                >
                  Siguiente
                </a>
              ) : (
                <div className="text-xs text-neutral-600">(Fin)</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
