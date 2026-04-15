import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ethers } from "ethers";
import { signSnapshot } from "@blockurna/crypto";
import { BU_PVP_1_TRANSITIONS, type ElectoralEventType } from "@blockurna/shared";
import { z } from "zod";

import { getEnv, getEnvResult } from "../../../lib/env";
import { ensureSchema, getPool, insertAdminLogEntry, listAdminLogEntries } from "../../../lib/db";
import { EVENT_TO_FUNCTION, getRegistry, phaseLabelFromNumber, validateTransitionOrThrow } from "../../../lib/registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ElectionPhasesResponse = {
  ok: boolean;
  chainId: string;
  contractAddress: string;
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

type PhaseChangesResponse = {
  ok: boolean;
  electionId: string;
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
    verificationStatus?: string | null;
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
    active?: boolean;
    resolvedAt?: string | null;
    lastSeenAt: string;
  }>;
};

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

const EventSchema = z.enum([
  "OPEN_REGISTRY",
  "CLOSE_REGISTRY",
  "OPEN_VOTING",
  "CLOSE_VOTING",
  "START_PROCESSING",
  "FINALIZE_PROCESSING",
  "PUBLISH_RESULTS",
  "OPEN_AUDIT_WINDOW",
  "ARCHIVE_ELECTION",
]);

const TransitionInputSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    event: EventSchema,
  })
  .strict();

async function transitionPhaseAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = TransitionInputSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    event: String(formData.get("event") ?? "").trim(),
  });

  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const event = parsed.data.event as ElectoralEventType;

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const election = await (contract as any).getElection(electionId);
  const currentPhase = phaseLabelFromNumber(Number(election.phase));

  validateTransitionOrThrow({ currentPhase, event });

  const fn = EVENT_TO_FUNCTION[event];
  if (!fn) throw new Error(`No contract function mapping for event ${event}`);

  const tx = await (contract as any)[fn](electionId);
  const receipt = await tx.wait();
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: event,
    message: `Phase transition executed: ${currentPhase} -> ${event}`,
    details: {
      electionId,
      currentPhase,
      event,
      txHash: receipt?.hash ?? null,
    },
    evidencePointers: receipt
      ? [
          {
            type: "tx",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            blockTimestamp: blockTimestampIso,
          },
        ]
      : [],
    actorAddress: authorityAddress,
    relatedTxHash: receipt?.hash ?? null,
    relatedBlockNumber: receipt?.blockNumber ?? null,
    relatedBlockTimestampIso: blockTimestampIso,
  });

  redirect(`/elections/${electionId}`);
}

const PublishActaInputSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    kind: z.enum(["ACTA_APERTURA", "ACTA_CIERRE", "ACTA_ESCRUTINIO", "ACTA_RESULTADOS"]),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const ACTA_KIND_TO_ID: Record<string, number> = {
  ACTA_APERTURA: 0,
  ACTA_CIERRE: 1,
  ACTA_ESCRUTINIO: 2,
  ACTA_RESULTADOS: 3,
};

async function publishActaAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = PublishActaInputSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    kind: String(formData.get("kind") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.message);

  const electionId = Number(parsed.data.electionId);
  const kindLabel = parsed.data.kind;
  const kindId = ACTA_KIND_TO_ID[kindLabel];
  if (kindId === undefined) throw new Error("Invalid acta kind");

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();
  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);

  const election = await (contract as any).getElection(electionId);
  const manifestHash = String(election.manifestHash);

  const chain = await provider.getNetwork();
  const toBlock = await provider.getBlockNumber();
  const signups = await (contract as any).signupCount(electionId);
  const ballots = await (contract as any).ballotCount(electionId);

  const snapshotBody = {
    snapshotVersion: "1",
    protocolVersion: "BU-PVP-1",
    electionId: String(electionId),
    kind: kindLabel,
    generatedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    blockRange: { fromBlock: 0, toBlock },
    commitments: {
      manifestHash,
    },
    counts: {
      signups: Number(signups),
      ballots: Number(ballots),
    },
    notes: parsed.data.notes,
  } as const;

  const signed = await signSnapshot(snapshotBody as any, env.AEA_ED25519_PRIVATE_KEY_HEX);

  // Write to ACTA_OUTPUT_DIR (root) so evidence-indexer can ingest.
  await fs.mkdir(env.ACTA_OUTPUT_DIR, { recursive: true });
  const fileName = `election_${electionId}_${kindLabel.toLowerCase()}_${signed.signature.snapshotHashHex}.signed.json`;
  const actaFilePath = path.join(env.ACTA_OUTPUT_DIR, fileName);
  await fs.writeFile(actaFilePath, JSON.stringify(signed, null, 2) + "\n", "utf8");

  const tx = await (contract as any).publishActa(
    electionId,
    kindId,
    signed.signature.snapshotHashHex,
  );
  const receipt = await tx.wait();
  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: "PUBLISH_ACTA",
    message: `Acta published (anchored): ${kindLabel}`,
    details: {
      electionId,
      kind: kindLabel,
      kindId,
      snapshotHashHex: signed.signature.snapshotHashHex,
      actaFilePath,
      networkChainId: chain.chainId.toString(),
    },
    evidencePointers: receipt
      ? [
          {
            type: "acta",
            electionId,
            kind: kindLabel,
            snapshotHashHex: signed.signature.snapshotHashHex,
          },
          {
            type: "tx",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            blockTimestamp: blockTimestampIso,
          },
        ]
      : [],
    actorAddress: authorityAddress,
    relatedTxHash: receipt?.hash ?? null,
    relatedBlockNumber: receipt?.blockNumber ?? null,
    relatedBlockTimestampIso: blockTimestampIso,
  });

  redirect(`/elections/${electionId}`);
}

const OperationalIncidentSchema = z
  .object({
    electionId: z.string().regex(/^\d+$/),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    code: z.string().min(3).max(80),
    message: z.string().min(3).max(400),
  })
  .strict();

async function registerOperationalIncidentAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const parsed = OperationalIncidentSchema.safeParse({
    electionId: String(formData.get("electionId") ?? "").trim(),
    severity: String(formData.get("severity") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    message: String(formData.get("message") ?? "").trim(),
  });

  if (!parsed.success) throw new Error(parsed.error.message);
  const electionId = Number(parsed.data.electionId);

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    code: `OP_INCIDENT:${parsed.data.code.toUpperCase()}`,
    severity: parsed.data.severity,
    message: parsed.data.message,
    details: {
      electionId,
      reporter: authorityAddress,
      reportedAt: new Date().toISOString(),
    },
    evidencePointers: [],
    actorAddress: authorityAddress,
  });

  redirect(`/elections/${electionId}`);
}

function eventLabel(e: ElectoralEventType): string {
  const map: Record<ElectoralEventType, string> = {
    OPEN_REGISTRY: "Abrir registro (REA)",
    CLOSE_REGISTRY: "Cerrar registro",
    OPEN_VOTING: "Abrir votación",
    CLOSE_VOTING: "Cerrar votación",
    START_PROCESSING: "Iniciar processing",
    FINALIZE_PROCESSING: "Finalizar processing",
    PUBLISH_RESULTS: "Publicar resultados",
    OPEN_AUDIT_WINDOW: "Abrir ventana de auditoría",
    ARCHIVE_ELECTION: "Archivar elección",
  };
  return map[e] ?? e;
}

export default async function ElectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  const electionIdStr = String(resolved.id);
  const electionId = Number(electionIdStr);

  const envRes = getEnvResult();
  if (!envRes.ok) {
    return (
      <main className="min-h-screen bg-white text-neutral-900">
        <div className="mx-auto max-w-5xl p-6 space-y-6">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Elección #{electionIdStr}</h1>
              <Link className="text-xs underline" href="/">
                volver
              </Link>
            </div>
            <div className="text-sm text-neutral-700">
              Consola operativa para investigación (instancia experimental). No apta para elecciones públicas vinculantes reales.
            </div>
          </header>

          <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
            <div className="text-sm font-medium">Configuración requerida</div>
            <div className="text-sm text-neutral-700">
              Faltan variables de entorno para operar la consola AEA.
            </div>

            {envRes.missingKeys.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-neutral-700 font-semibold">Variables faltantes</div>
                <ul className="text-xs text-neutral-700 font-mono list-disc pl-5">
                  {envRes.missingKeys.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {envRes.problems.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-neutral-700 font-semibold">Problemas detectados</div>
                <ul className="text-xs text-neutral-700 font-mono list-disc pl-5">
                  {envRes.problems.map((p, idx) => (
                    <li key={`${p.key}:${idx}`}>{p.key}: {p.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="text-xs text-neutral-700">Crear archivo de configuración local:</div>
            <pre className="rounded-md bg-neutral-50 border border-neutral-200 p-3 text-xs overflow-x-auto">cp apps/authority-console/.env.example apps/authority-console/.env.local</pre>
          </section>
        </div>
      </main>
    );
  }

  const env = envRes.env;

  const [phasesRes, phaseChangesRes, anchorsRes, actsRes, consistencyRes, incidentsRes] = await Promise.all([
    safeFetchJson<ElectionPhasesResponse | null>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phases`,
      null,
    ),
    safeFetchJson<PhaseChangesResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/phase-changes`,
      { ok: true, electionId: electionIdStr, phaseChanges: [] },
    ),
    safeFetchJson<AnchorsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/anchors`,
      { ok: true, anchors: [] },
    ),
    safeFetchJson<ActsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/acts`,
      { ok: true, acts: [] },
    ),
    safeFetchJson<ConsistencyResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/consistency`,
      { ok: true, consistency: null },
    ),
    safeFetchJson<IncidentsResponse>(
      `${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/incidents`,
      { ok: true, incidents: [] },
    ),
  ]);

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);
  const adminLog = await listAdminLogEntries({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    limit: 50,
  });

  const currentPhaseLabel = phasesRes?.ok ? phasesRes.election.phaseLabel : "UNKNOWN";

  const availableEvents = BU_PVP_1_TRANSITIONS.filter((t) => t.from === currentPhaseLabel).map(
    (t) => t.event as ElectoralEventType,
  );

  const activeIncidents = (incidentsRes.incidents ?? []).filter((i) => i.active !== false);
  const criticalActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "CRITICAL").length;
  const warningActive = activeIncidents.filter((i) => String(i.severity).toUpperCase() === "WARNING").length;

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Elección #{electionIdStr}</h1>
            <Link className="text-xs underline" href="/">
              volver
            </Link>
          </div>
          <div className="text-xs text-neutral-500 break-all">
            chainId={env.CHAIN_ID} · contract={env.CONTRACT_ADDRESS} · API={env.EVIDENCE_API_URL}
          </div>
          <div className="text-sm text-neutral-700">
            Consola operativa para investigación (instancia experimental). No apta para elecciones públicas vinculantes reales.
          </div>
        </header>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-2">
          <div className="text-sm font-medium">Estado</div>
          {phasesRes?.ok ? (
            <>
              <div className="text-xs text-neutral-700 break-all">manifestHash: {phasesRes.election.manifestHash}</div>
              <div className="text-xs text-neutral-700 break-all">authority (AEA): {phasesRes.election.authority}</div>
              <div className="text-xs text-neutral-700 break-all">registryAuthority (REA): {phasesRes.election.registryAuthority}</div>
              <div className="text-xs text-neutral-700 break-all">coordinatorPubKey: {phasesRes.election.coordinatorPubKey}</div>
              <div className="text-xs text-neutral-700">fase actual: {phasesRes.election.phaseLabel}</div>
            </>
          ) : (
            <div className="text-sm text-neutral-600">
              (No se pudo cargar metadata desde Evidence API; verifica que indexer+api apunten al mismo contrato)
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Control de fases (BU‑PVP‑1)</div>
          {availableEvents.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin transiciones disponibles desde {currentPhaseLabel})</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableEvents.map((event) => (
                <form key={event} action={transitionPhaseAction}>
                  <input type="hidden" name="electionId" value={electionIdStr} />
                  <input type="hidden" name="event" value={event} />
                  <button
                    type="submit"
                    className="rounded-md bg-neutral-900 text-white px-3 py-2 text-xs font-semibold"
                  >
                    {eventLabel(event)}
                  </button>
                </form>
              ))}
            </div>
          )}
          <div className="text-xs text-neutral-600">
            La máquina de estados se valida en consola y en el contrato (reverts en transiciones inválidas).
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Publicar acta digital (firma + anchor)</div>
          <form action={publishActaAction} className="space-y-3">
            <input type="hidden" name="electionId" value={electionIdStr} />
            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="kind">
                Tipo
              </label>
              <select id="kind" name="kind" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                <option value="ACTA_APERTURA">ACTA_APERTURA</option>
                <option value="ACTA_CIERRE">ACTA_CIERRE</option>
                <option value="ACTA_ESCRUTINIO">ACTA_ESCRUTINIO</option>
                <option value="ACTA_RESULTADOS">ACTA_RESULTADOS</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="notes">
                Notas (opcional)
              </label>
              <textarea
                id="notes"
                name="notes"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                rows={3}
                placeholder="Contexto de la publicación del acta"
              />
            </div>
            <button type="submit" className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-semibold">
              Firmar (ed25519) + anclar on-chain
            </button>
          </form>
          <div className="text-xs text-neutral-600">
            El JSON firmado se escribe en <span className="font-mono">ACTA_OUTPUT_DIR</span> para que el evidence-indexer lo materialice en Postgres.
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Consistencia e incidentes (lectura Evidence API)</div>
          <div className="text-xs text-neutral-700">
            Activos: CRITICAL={criticalActive} · WARNING={warningActive} · total={activeIncidents.length}
          </div>
          <div className="text-xs text-neutral-700">
            Última corrida: {consistencyRes.consistency?.computedAt ?? "(no disponible)"} · ok={String(consistencyRes.consistency?.ok ?? false)}
          </div>
          <div className="text-xs text-neutral-600 break-all">
            JSON: {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/consistency · {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/incidents
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Anchors y actas</div>
          <div className="text-xs text-neutral-700">Anchors: {anchorsRes.anchors.length} · Actas (referencias): {actsRes.acts.length}</div>
          <div className="text-xs text-neutral-600 break-all">
            JSON: {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/anchors · {env.EVIDENCE_API_URL}/v1/elections/{electionIdStr}/acts
          </div>
          {actsRes.acts.length > 0 ? (
            <div className="space-y-2">
              {actsRes.acts.slice(0, 10).map((a) => (
                <div key={a.actId} className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-700 break-all">actId: {a.actId}</div>
                  <div className="text-xs text-neutral-700">actType: {a.actType}</div>
                  <div className="text-xs text-neutral-700 break-all">anchorTxHash: {a.anchorTxHash}</div>
                  <div className="text-xs text-neutral-700">createdAt: {a.createdAt ?? "(sin contenido)"}</div>
                  <div className="text-xs">
                    <a
                      className="underline"
                      href={`${env.EVIDENCE_API_URL}/v1/elections/${encodeURIComponent(electionIdStr)}/acts/${encodeURIComponent(
                        a.actId,
                      )}/content`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      descargar contenido firmado
                    </a>
                    <span className="text-neutral-400"> · </span>
                    <Link className="underline" href={`/`}>TPE</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Bitácora administrativa (Postgres)</div>
          <div className="text-xs text-neutral-600">
            Descargar JSON: <a className="underline" href={`/api/elections/${encodeURIComponent(electionIdStr)}/admin-log`}>admin-log</a>
            {" · "}
            <a className="underline" href={`/api/elections/${encodeURIComponent(electionIdStr)}/manifest`}>manifiesto</a>
          </div>
          {adminLog.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin entradas aún)</div>
          ) : (
            <div className="space-y-2">
              {adminLog.map((e) => (
                <div key={e.entryId} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-neutral-500">{e.createdAt}</div>
                      <div className="text-xs font-semibold">
                        {e.code}
                        {e.severity ? ` · ${e.severity}` : ""}
                      </div>
                      <div className="text-xs text-neutral-700">{e.message}</div>
                      {e.relatedTxHash ? (
                        <div className="text-xs text-neutral-700 break-all">txHash: {e.relatedTxHash}</div>
                      ) : null}
                    </div>
                    <div className="text-xs text-neutral-500">#{e.entryId}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Registrar incidente operativo (bitácora)</div>
          <form action={registerOperationalIncidentAction} className="space-y-3">
            <input type="hidden" name="electionId" value={electionIdStr} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-neutral-700" htmlFor="severity">
                  Severidad
                </label>
                <select
                  id="severity"
                  name="severity"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="INFO">INFO</option>
                  <option value="WARNING">WARNING</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-700" htmlFor="code">
                  Código
                </label>
                <input
                  id="code"
                  name="code"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="ej: OPERATOR_NOTE"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-700" htmlFor="message">
                Mensaje
              </label>
              <input
                id="message"
                name="message"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Descripción del incidente operativo"
                required
              />
            </div>
            <button type="submit" className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-semibold">
              Registrar
            </button>
          </form>
          <div className="text-xs text-neutral-600">
            Registro off-chain en Postgres (bitácora). No se interpreta como evidencia on-chain.
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="text-sm font-medium">Timeline de transiciones</div>
          {phaseChangesRes.phaseChanges.length === 0 ? (
            <div className="text-sm text-neutral-600">(Sin phase-changes indexados)</div>
          ) : (
            <div className="space-y-2">
              {phaseChangesRes.phaseChanges.map((p) => (
                <div key={`${p.txHash}:${p.logIndex}`} className="rounded-md border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">{p.blockTimestamp ?? "(sin timestamp)"}</div>
                  <div className="text-xs text-neutral-700">
                    {p.previousPhaseLabel} → {p.newPhaseLabel}
                  </div>
                  <div className="text-xs text-neutral-700 break-all">txHash: {p.txHash}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
