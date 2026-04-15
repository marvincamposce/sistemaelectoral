import Link from "next/link";
import { getPublicEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PhasesResponse = {
  ok: boolean;
  election: {
    electionId: string;
    phaseLabel: string;
    registryAuthority: string;
  };
};

type BallotsSummaryResponse = {
  ok: boolean;
  summary: { total: number };
};

type BallotsListResponse = {
  ok: boolean;
  electionId: string;
  page: null | { limit: number; order: "asc" | "desc"; nextCursor: string | null };
  ballots: Array<{
    index: number;
    ballotHash: string;
    ciphertext: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Evidence API error: ${res.status}`);
  return (await res.json()) as T;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fallback;
  }
}

export default async function BallotsPage({
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
            <h1 className="text-2xl font-semibold">Boletas (Urna Virtual)</h1>
            <div className="text-xs text-neutral-600">
              <Link className="underline" href="/">volver</Link>
            </div>
          </header>
          <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
            <div className="text-sm font-medium">No se encontró la elección</div>
          </section>
        </div>
      </main>
    );
  }

  const [summary, list] = await Promise.all([
    safeFetchJson<BallotsSummaryResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/ballots/summary`,
      { ok: true, summary: { total: 0 } },
    ),
    safeFetchJson<BallotsListResponse>(
      `${apiBase}/v1/elections/${encodeURIComponent(electionId)}/ballots?order=desc&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { ok: true, electionId, page: { limit: 50, order: "desc", nextCursor: null }, ballots: [] },
    ),
  ]);

  const page = list.page;
  const nextCursor = page?.nextCursor ?? null;
  const recent = (list.ballots ?? []).slice(0, 10);

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold break-all">Urna Virtual (Ballots) · Elección #{electionId}</h1>
            <div className="rounded-md px-3 py-1 text-xs font-semibold bg-neutral-200 text-neutral-900">
              {election.election.phaseLabel}
            </div>
          </div>
          <div className="text-xs text-neutral-600">
            <Link className="underline" href="/">volver al dashboard</Link>
          </div>
          <div className="text-xs text-neutral-500 break-all">API: {apiBase}</div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-1">
          <div className="text-sm font-medium">Resumen</div>
          <div className="text-sm text-neutral-700">total boletas publicadas: {summary.summary.total}</div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Evidencia Pública de Publicación (Paginada)</div>
            <div className="text-xs text-neutral-600">
              {page ? `orden: ${page.order} · limit: ${page.limit}` : ""}
            </div>
          </div>

          {list.ballots.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin boletas)</div>
          ) : (
            <div className="space-y-4">
              {list.ballots.map((b) => (
                <div key={`${b.txHash}:${b.logIndex}`} className="rounded-md border border-neutral-200 p-3 bg-neutral-50">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs font-bold text-neutral-800">
                      Index: {b.index}
                    </div>
                    <div className="text-xs text-neutral-500">
                      block {b.blockNumber} {b.blockTimestamp ? ` · ${b.blockTimestamp}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-700 break-all">
                    <span className="font-semibold text-neutral-500">Tx Hash:</span> {b.txHash}
                  </div>
                  <div className="text-xs text-neutral-700 break-all">
                    <span className="font-semibold text-neutral-500">Recibo / Ballot Hash:</span> {b.ballotHash}
                  </div>
                  <div className="mt-2 pt-2 border-t border-neutral-200 text-[10px] text-neutral-600 font-mono break-all line-clamp-3 hover:line-clamp-none">
                    <span className="font-semibold text-neutral-500">Ciphertext:</span> {b.ciphertext}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-xs text-neutral-600 break-all">
              {cursor ? `cursor: ${cursor}` : ""}
            </div>
            <div className="flex items-center gap-3">
              {cursor ? (
                <Link className="text-xs text-neutral-700 underline" href={`/elections/${encodeURIComponent(electionId)}/ballots`}>
                  Inicio
                </Link>
              ) : null}
              {nextCursor ? (
                <Link
                  className="text-xs text-neutral-700 underline"
                  href={`/elections/${encodeURIComponent(electionId)}/ballots?cursor=${encodeURIComponent(nextCursor)}`}
                >
                  Siguiente
                </Link>
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
