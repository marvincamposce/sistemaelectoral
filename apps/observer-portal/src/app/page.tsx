import { getPublicEnv } from "./../lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ElectionsApiResponse = {
  ok: boolean;
  chainId: string;
  contractAddress: string;
  elections: Array<{
    electionId: string;
    manifestHash: string;
    authority: string;
    registryAuthority: string;
    coordinatorPubKey: string;
    phase: number;
    phaseLabel?: string;
    createdAtBlock: string;
    createdAtTimestamp: string | null;
    createdTxHash: string;
    counts: { signups: number; ballots: number };
  }>;
};

type PhaseChangesResponse = {
  ok: boolean;
  phaseChanges: Array<{
    txHash: string;
    logIndex: number;
    blockNumber: string;
    blockTimestamp: string | null;
    previousPhase: number;
    newPhase: number;
    previousPhaseLabel: string;
    newPhaseLabel: string;
  }>;
};

type ActsResponse = {
  ok: boolean;
  acts: Array<{
    actId: string;
    actType: string;
    anchorTxHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    contentHash: string | null;
    createdAt: string | null;
  }>;
};

type AnchorsResponse = {
  ok: boolean;
  anchors: Array<{
    kind: number;
    snapshotHash: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

type SignupsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueNullifiers: number };
};

type BallotsSummaryResponse = {
  ok: boolean;
  summary: { total: number; uniqueBallotIndexes: number };
};

type BallotsResponse = {
  ok: boolean;
  ballots: Array<{
    ballotIndex: string;
    ballotHash: string;
    ciphertext: string;
    blockNumber: string;
    blockTimestamp: string | null;
    txHash: string;
    logIndex: number;
  }>;
};

type ConsistencyResponse = {
  ok: boolean;
  consistency:
    | null
    | {
        runId: string;
        dataVersion: string;
        computedAt: string;
        ok: boolean;
        report: any;
      };
};

type IncidentsResponse = {
  ok: boolean;
  incidents: Array<{
    fingerprint: string;
    code: string;
    severity: string;
    message: string;
    details: any;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    evidencePointers?: any;
    firstSeenAt: string;
    detectedAt?: string;
    lastSeenAt: string;
    occurrences: string;
    relatedTxHash: string | null;
    relatedBlockNumber: string | null;
    relatedBlockTimestamp: string | null;
    active?: boolean;
    resolvedAt?: string | null;
  }>;
};

function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

function severityBadgeClasses(severity: string): string {
  if (isCriticalSeverity(severity)) return "bg-neutral-900 text-white";
  if (isWarningSeverity(severity)) return "bg-neutral-700 text-white";
  return "bg-neutral-200 text-neutral-900";
}

function normalizeSeverityLabel(severity: string): string {
  const s = String(severity ?? "").toUpperCase();
  if (s === "ERROR") return "CRITICAL";
  if (s === "WARN") return "WARNING";
  return s.length > 0 ? s : "UNKNOWN";
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

export default async function Page() {
  const env = getPublicEnv();

  const apiBase = env.NEXT_PUBLIC_EVIDENCE_API_URL.replace(/\/$/, "");
  const sourceLabel = `API: ${apiBase}`;

  const electionsRes = await safeFetchJson<ElectionsApiResponse | null>(
    `${apiBase}/v1/elections`,
    null,
  );
  const elections = electionsRes?.elections ?? [];

  const electionsDetailed = await Promise.all(
    elections.map(async (e) => {
      const id = String(e.electionId);
      const [
        phaseChangesRes,
        actsRes,
        anchorsRes,
        signupsSummaryRes,
        ballotsSummaryRes,
        ballotsRes,
        consistencyRes,
        incidentsRes,
      ] = await Promise.all([
        safeFetchJson<PhaseChangesResponse>(
          `${apiBase}/v1/elections/${id}/phase-changes`,
          { ok: true, phaseChanges: [] },
        ),
        safeFetchJson<ActsResponse>(`${apiBase}/v1/elections/${id}/acts`, { ok: true, acts: [] }),
        safeFetchJson<AnchorsResponse>(
          `${apiBase}/v1/elections/${id}/anchors`,
          { ok: true, anchors: [] },
        ),
        safeFetchJson<SignupsSummaryResponse>(
          `${apiBase}/v1/elections/${id}/signups/summary`,
          { ok: true, summary: { total: 0, uniqueNullifiers: 0 } },
        ),
        safeFetchJson<BallotsSummaryResponse>(
          `${apiBase}/v1/elections/${id}/ballots/summary`,
          { ok: true, summary: { total: 0, uniqueBallotIndexes: 0 } },
        ),
        safeFetchJson<BallotsResponse>(`${apiBase}/v1/elections/${id}/ballots`, {
          ok: true,
          ballots: [],
        }),
        safeFetchJson<ConsistencyResponse>(
          `${apiBase}/v1/elections/${id}/consistency`,
          { ok: true, consistency: null },
        ),
        safeFetchJson<IncidentsResponse>(`${apiBase}/v1/elections/${id}/incidents`, {
          ok: true,
          incidents: [],
        }),
      ]);

      return {
        ...e,
        phaseChanges: phaseChangesRes.phaseChanges,
        acts: actsRes.acts,
        anchors: anchorsRes.anchors,
        signupsSummary: signupsSummaryRes.summary,
        ballotsSummary: ballotsSummaryRes.summary,
        ballots: ballotsRes.ballots,
        consistency: consistencyRes.consistency,
        incidents: incidentsRes.incidents,
      };
    }),
  );

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
          {electionsRes === null ? (
            <div className="mt-2 text-sm text-neutral-700">(Evidence API no disponible)</div>
          ) : (
            <div className="mt-2 text-sm text-neutral-700">Total: {elections.length}</div>
          )}
        </section>

        <div className="space-y-4">
          {electionsDetailed.map((e) => {
            const activeIncidents = (e.incidents ?? []).filter((i) => i.active !== false);
            const resolvedIncidents = (e.incidents ?? []).filter((i) => i.active === false);

            const globalConsistency = activeIncidents.some((i) => isCriticalSeverity(i.severity))
              ? "CRITICAL"
              : activeIncidents.some((i) => isWarningSeverity(i.severity))
                ? "WARNING"
                : "OK";

            const timeline = [
              {
                key: `created:${e.electionId}`,
                blockNumber: e.createdAtBlock,
                blockTimestamp: e.createdAtTimestamp,
                txHash: e.createdTxHash,
                logIndex: -1,
                label: "ElectionCreated",
                detail: null as string | null,
              },
              ...e.phaseChanges.map((pc) => ({
                key: `phase:${pc.txHash}:${pc.logIndex}`,
                blockNumber: pc.blockNumber,
                blockTimestamp: pc.blockTimestamp,
                txHash: pc.txHash,
                logIndex: pc.logIndex,
                label: "PhaseChanged",
                detail: `${pc.previousPhaseLabel} → ${pc.newPhaseLabel}`,
              })),
              ...e.anchors.map((a) => ({
                key: `anchor:${a.txHash}:${a.logIndex}`,
                blockNumber: a.blockNumber,
                blockTimestamp: a.blockTimestamp,
                txHash: a.txHash,
                logIndex: a.logIndex,
                label: `ActaPublished kind ${a.kind}`,
                detail: `snapshotHash: ${a.snapshotHash}`,
              })),
              ...e.ballots.map((b) => ({
                key: `ballot:${b.txHash}:${b.logIndex}`,
                blockNumber: b.blockNumber,
                blockTimestamp: b.blockTimestamp,
                txHash: b.txHash,
                logIndex: b.logIndex,
                label: `BallotPublished idx ${b.ballotIndex}`,
                detail: `ballotHash: ${b.ballotHash}`,
              })),
            ].sort((a, b) => {
              const bnA = BigInt(a.blockNumber);
              const bnB = BigInt(b.blockNumber);
              if (bnA < bnB) return -1;
              if (bnA > bnB) return 1;
              return a.logIndex - b.logIndex;
            });

            return (
              <section
                key={e.electionId}
                className="rounded-lg border border-neutral-200 p-4 space-y-3"
              >
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">Elección #{e.electionId}</div>
                <div className="text-xs text-neutral-600 break-all">
                  manifestHash: {e.manifestHash}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  authority (AEA): {e.authority}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  registryAuthority (REA signer): {e.registryAuthority}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  coordinatorPubKey: {e.coordinatorPubKey}
                </div>
                <div className="text-xs text-neutral-600 break-all">
                  createdAt: block {e.createdAtBlock}
                  {e.createdAtTimestamp ? ` · ${e.createdAtTimestamp}` : ""}
                  {e.createdTxHash ? ` · tx ${e.createdTxHash}` : ""}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Fase</div>
                  <div className="text-sm font-medium">
                    {e.phaseLabel ?? `(${e.phase})`}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Registros (signup)</div>
                  <div className="text-sm font-medium">{e.counts.signups}</div>
                  <div className="text-xs text-neutral-500">
                    únicos: {e.signupsSummary.uniqueNullifiers}
                  </div>
                  <div className="mt-2">
                    <a
                      className="text-xs text-neutral-700 underline"
                      href={`/elections/${encodeURIComponent(String(e.electionId))}/signups`}
                    >
                      Abrir signups
                    </a>
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Boletas publicadas</div>
                  <div className="text-sm font-medium">{e.counts.ballots}</div>
                  <div className="text-xs text-neutral-500">
                    índices únicos: {e.ballotsSummary.uniqueBallotIndexes}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Timeline (eventos)</div>
                <div className="mt-2 space-y-2">
                  {timeline.length === 0 ? (
                    <div className="text-sm text-neutral-600">
                      (Sin eventos indexados)
                    </div>
                  ) : (
                    timeline.map((ev) => (
                      <div
                        key={ev.key}
                        className="rounded-md border border-neutral-200 p-3"
                      >
                        <div className="text-xs text-neutral-500">
                          block {ev.blockNumber}
                          {ev.blockTimestamp ? ` · ${ev.blockTimestamp}` : ""}
                        </div>
                        <div className="text-xs text-neutral-700">{ev.label}</div>
                        {ev.detail ? (
                          <div className="text-xs text-neutral-700 break-all">
                            {ev.detail}
                          </div>
                        ) : null}
                        {ev.txHash ? (
                          <div className="text-xs text-neutral-700 break-all">tx: {ev.txHash}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Actas (referencias ancladas)</div>
                <div className="mt-2 space-y-2">
                  {e.acts.length === 0 ? (
                    <div className="text-sm text-neutral-600">(Sin actas publicadas)</div>
                  ) : (
                    e.acts.map((a) => (
                      <div
                        key={`${a.actId}-${a.anchorTxHash}`}
                        className="rounded-md border border-neutral-200 p-3"
                      >
                        <div className="text-xs text-neutral-500">
                          {a.actType} · block {a.blockNumber}
                          {a.blockTimestamp ? ` · ${a.blockTimestamp}` : ""}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">
                          actId (snapshotHash): {a.actId}
                        </div>
                        {a.contentHash ? (
                          <div className="text-xs text-neutral-700 break-all">
                            contentHash: {a.contentHash}
                          </div>
                        ) : null}
                        <div className="text-xs text-neutral-700 break-all">
                          anchor tx: {a.anchorTxHash}
                        </div>
                        <div className="mt-2">
                          <a
                            className="text-xs text-neutral-700 underline"
                            href={`/elections/${encodeURIComponent(String(e.electionId))}/acts/${encodeURIComponent(String(a.actId))}`}
                          >
                            Abrir acta
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Anclajes (eventos on-chain)</div>
                <div className="mt-2 space-y-2">
                  {e.anchors.length === 0 ? (
                    <div className="text-sm text-neutral-600">(Sin anclajes)</div>
                  ) : (
                    e.anchors.map((a) => (
                      <div
                        key={`${a.txHash}:${a.logIndex}`}
                        className="rounded-md border border-neutral-200 p-3"
                      >
                        <div className="text-xs text-neutral-500">
                          kind {a.kind} · block {a.blockNumber}
                          {a.blockTimestamp ? ` · ${a.blockTimestamp}` : ""}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">
                          snapshotHash: {a.snapshotHash}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">tx: {a.txHash}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Consistencia</div>
                <div className="mt-2 rounded-md border border-neutral-200 p-3">
                  {e.consistency ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-neutral-500">estado global</div>
                        <div className={`rounded px-2 py-0.5 text-[10px] font-semibold ${severityBadgeClasses(globalConsistency)}`}>
                          {globalConsistency}
                        </div>
                      </div>
                      <div className="text-xs text-neutral-500">computedAt: {e.consistency.computedAt}</div>
                      <div className="text-xs text-neutral-500">dataVersion: {e.consistency.dataVersion}</div>
                      <div className="text-xs text-neutral-700">
                        ok: <span className="font-medium">{String(e.consistency.ok)}</span>
                      </div>
                      {Array.isArray(e.consistency.report?.incidents) ? (
                        <div className="text-xs text-neutral-700">
                          incidentes (reporte): {e.consistency.report.incidents.length}
                        </div>
                      ) : null}
                      <div className="text-xs text-neutral-700">
                        activos: {activeIncidents.length} · resueltos: {resolvedIncidents.length}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-600">(Sin reporte de consistencia)</div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Incidentes / Alertas</div>
                <div className="mt-2 space-y-2">
                  {e.incidents.length === 0 ? (
                    <div className="text-sm text-neutral-600">(Sin incidentes)</div>
                  ) : (
                    <>
                      <div className="text-xs text-neutral-600">Activos ({activeIncidents.length})</div>
                      {activeIncidents.length === 0 ? (
                        <div className="text-sm text-neutral-600">(Sin incidentes activos)</div>
                      ) : (
                        activeIncidents.map((i) => (
                          <div
                            key={i.fingerprint}
                            className="rounded-md border border-neutral-200 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-neutral-500">
                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${severityBadgeClasses(i.severity)}`}>
                                  {normalizeSeverityLabel(i.severity)}
                                </span>
                                <span className="ml-2">{i.code} · occ {i.occurrences}</span>
                              </div>
                              <div className="text-xs text-neutral-500">activo</div>
                            </div>
                            <div className="text-xs text-neutral-700">{i.message}</div>
                            <div className="text-xs text-neutral-600">
                              lastSeen: {i.lastSeenAt}
                              {i.relatedBlockNumber ? ` · block ${i.relatedBlockNumber}` : ""}
                              {i.relatedBlockTimestamp ? ` · ${i.relatedBlockTimestamp}` : ""}
                            </div>
                            {i.relatedTxHash ? (
                              <div className="text-xs text-neutral-700 break-all">tx: {i.relatedTxHash}</div>
                            ) : null}
                          </div>
                        ))
                      )}

                      <div className="text-xs text-neutral-600 mt-3">Resueltos ({resolvedIncidents.length})</div>
                      {resolvedIncidents.length === 0 ? (
                        <div className="text-sm text-neutral-600">(Sin incidentes resueltos)</div>
                      ) : (
                        resolvedIncidents.map((i) => (
                          <div
                            key={i.fingerprint}
                            className="rounded-md border border-neutral-200 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-neutral-500">
                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${severityBadgeClasses(i.severity)}`}>
                                  {normalizeSeverityLabel(i.severity)}
                                </span>
                                <span className="ml-2">{i.code} · occ {i.occurrences}</span>
                              </div>
                              <div className="text-xs text-neutral-500">resuelto</div>
                            </div>
                            <div className="text-xs text-neutral-700">{i.message}</div>
                            <div className="text-xs text-neutral-600">
                              resolvedAt: {i.resolvedAt ?? "(desconocido)"}
                              {i.relatedBlockNumber ? ` · block ${i.relatedBlockNumber}` : ""}
                              {i.relatedTxHash ? ` · tx ${i.relatedTxHash}` : ""}
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Boletas (tabla)</div>
                <div className="mt-2 space-y-2">
                  {e.ballots.length === 0 ? (
                    <div className="text-sm text-neutral-600">(Sin boletas)</div>
                  ) : (
                    e.ballots.map((b) => (
                      <div
                        key={`${b.txHash}:${b.logIndex}`}
                        className="rounded-md border border-neutral-200 p-3"
                      >
                        <div className="text-xs text-neutral-500">
                          idx {b.ballotIndex} · block {b.blockNumber}
                          {b.blockTimestamp ? ` · ${b.blockTimestamp}` : ""}
                        </div>
                        <div className="text-xs text-neutral-700 break-all">ballotHash: {b.ballotHash}</div>
                        <div className="text-xs text-neutral-700 break-all">ciphertext: {b.ciphertext}</div>
                        <div className="text-xs text-neutral-700 break-all">tx: {b.txHash}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              </section>
            );
          })}

          {electionsDetailed.length === 0 ? (
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
