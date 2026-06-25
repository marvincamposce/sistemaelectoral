import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ethers } from "ethers";
import {
  HondurasCensusRecordSchema,
  HondurasCensusStatusSchema,
  HondurasDniSchema,
  HondurasWalletLinkSchema,
  HondurasWalletLinkStatusSchema,
  HondurasWalletVerificationMethodSchema,
  etiquetaCanalSolicitud,
  etiquetaEstado,
  etiquetaMetodoBilletera,
} from "@blockurna/shared";
import { z } from "zod";

import { getEnv } from "../../lib/env";
import { LiveRefresh } from "../components/LiveRefresh";
import { ActionNotice, construirRutaConAviso } from "../components/ActionNotice";
import { PendingSubmitButton } from "../components/PendingSubmitButton";
import {
  createHondurasVoterAuthorization,
  ensureSchema,
  getHondurasVoterRegistryRecord,
  getPool,
  listHondurasEnrollmentRequests,
  listHondurasVoterAuthorizations,
  listHondurasWalletLinksByDni,
  listRecentHondurasVoterRegistryRecords,
  reviewHondurasEnrollmentRequest,
  upsertHondurasVoterRegistryRecord,
  upsertHondurasWalletLink,
} from "../../lib/db";

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

const PHASE_LABELS_ES: Record<string, string> = {
  SETUP: "Preparacion",
  REGISTRY_OPEN: "Registro abierto",
  REGISTRY_CLOSED: "Registro cerrado",
  VOTING_OPEN: "Votacion abierta",
  VOTING_CLOSED: "Votacion cerrada",
  PROCESSING: "Procesamiento",
  TALLYING: "Escrutinio",
  RESULTS_PUBLISHED: "Resultados publicados",
  AUDIT_WINDOW: "Ventana de auditoria",
  AUDIT_WINDOW_OPEN: "Ventana de auditoria",
  ARCHIVED: "Archivada",
};

const CensusUpsertInputSchema = z
  .object({
    dni: HondurasDniSchema,
    fullName: z.string().trim().min(1).max(200),
    habilitationStatus: HondurasCensusStatusSchema,
    statusReason: z.string().trim().max(300).optional(),
    source: z.string().trim().min(1).max(120).optional(),
    citizenAccessCode: z.string().trim().min(6).max(64).optional(),
    metadataJson: z.string().trim().optional(),
  })
  .strict();

const WalletLinkInputSchema = z
  .object({
    dni: HondurasDniSchema,
    walletAddress: z.string().trim().min(1),
    linkStatus: HondurasWalletLinkStatusSchema,
    verificationMethod: HondurasWalletVerificationMethodSchema,
    evidenceJson: z.string().trim().optional(),
  })
  .strict();

const BulkCensusInputSchema = z.object({
  recordsJson: z.string().trim().min(1),
});

const EnrollmentReviewInputSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reviewNotes: z.string().trim().max(500).optional(),
  })
  .strict();

const EnrollmentToCensusInputSchema = z
  .object({
    requestId: z.string().uuid(),
    dni: HondurasDniSchema,
    fullName: z.string().trim().min(5).max(200),
    habilitationStatus: HondurasCensusStatusSchema,
    statusReason: z.string().trim().max(300).optional(),
    source: z.string().trim().min(1).max(120).optional(),
    citizenAccessCode: z.string().trim().min(6).max(64).optional(),
  })
  .strict();

const AuthorizationInputSchema = z
  .object({
    dni: HondurasDniSchema,
    electionId: z.string().trim().regex(/^\d+$/),
    enrollmentRequestId: z.string().uuid().optional(),
    authorizationNotes: z.string().trim().max(500).optional(),
  })
  .strict();

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Se esperaba un objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function statusBadgeClass(status: string): string {
  const value = String(status).toUpperCase();
  if (value === "HABILITADO" || value === "ACTIVE" || value === "AUTHORIZED") return "badge badge-valid";
  if (value === "INHABILITADO" || value === "SUSPENDIDO" || value === "REVOKED" || value === "REJECTED") {
    return "badge badge-critical";
  }
  if (value === "APPROVED") return "badge badge-info";
  return "badge badge-warning";
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("es-HN", {
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

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "-";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function phaseLabelEs(label: string | undefined, phase: number): string {
  const key = String(label ?? "").toUpperCase();
  return PHASE_LABELS_ES[key] ?? `Fase ${phase}`;
}

function electionOptionLabel(election: ElectionsApiResponse["elections"][number]): string {
  const phase = phaseLabelEs(election.phaseLabel, election.phase);
  const signups = Number(election.counts?.signups ?? 0);
  const ballots = Number(election.counts?.ballots ?? 0);
  return `#${election.electionId} - ${phase} - inscripciones ${signups} - boletas ${ballots}`;
}

async function ensureSystemManagedWalletLink(params: {
  pool: Parameters<typeof upsertHondurasWalletLink>[0]["pool"];
  dni: string;
}) {
  const links = await listHondurasWalletLinksByDni({ pool: params.pool, dni: params.dni });
  const active = links.find((row) => row.linkStatus === "ACTIVE" && !row.revokedAt);
  if (active) return active;

  const wallet = ethers.Wallet.createRandom();
  await upsertHondurasWalletLink({
    pool: params.pool,
    dni: params.dni,
    walletAddress: wallet.address.toLowerCase(),
    linkStatus: "ACTIVE",
    verificationMethod: "SYSTEM_MANAGED",
    evidenceJson: {
      systemManagedWallet: true,
      managedPrivateKeyHex: wallet.privateKey.toLowerCase(),
      credentialSecretHex: ethers.hexlify(ethers.randomBytes(32)).toLowerCase(),
      walletProvisioningMode: "SYSTEM_MANAGED",
    },
    revokedAtIso: null,
  });

  const refreshed = await listHondurasWalletLinksByDni({ pool: params.pool, dni: params.dni });
  const created = refreshed.find((row) => row.linkStatus === "ACTIVE" && !row.revokedAt);
  if (!created) throw new Error("No se pudo provisionar wallet gestionada.");
  return created;
}

async function lookupDniAction(formData: FormData) {
  "use server";
  const dni = HondurasDniSchema.parse(String(formData.get("dni") ?? ""));
  redirect(`/honduras?dni=${encodeURIComponent(dni)}`);
}

async function upsertCensusRecordAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = CensusUpsertInputSchema.parse({
    dni: String(formData.get("dni") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    habilitationStatus: String(formData.get("habilitationStatus") ?? ""),
    statusReason: String(formData.get("statusReason") ?? "").trim() || undefined,
    source: String(formData.get("source") ?? "").trim() || undefined,
    citizenAccessCode: String(formData.get("citizenAccessCode") ?? "").trim() || undefined,
    metadataJson: String(formData.get("metadataJson") ?? "").trim() || undefined,
  });

  const metadataJson = parseJsonObject(parsed.metadataJson);
  if (parsed.citizenAccessCode) {
    metadataJson.citizenAccessCodeHash = ethers.keccak256(ethers.toUtf8Bytes(parsed.citizenAccessCode)).toLowerCase();
    metadataJson.citizenAccessCodeRotatedAt = new Date().toISOString();
  }

  const nameParts = parsed.fullName.trim().split(/\s+/).filter(Boolean);
  await upsertHondurasVoterRegistryRecord({
    pool,
    dni: parsed.dni,
    fullName: parsed.fullName,
    firstName: nameParts[0] ?? null,
    middleName: nameParts.length > 3 ? nameParts.slice(1, -2).join(" ") : nameParts[1] ?? null,
    lastName: nameParts.length >= 2 ? nameParts[nameParts.length - 2] ?? null : null,
    secondLastName: nameParts.length >= 1 ? nameParts[nameParts.length - 1] ?? null : null,
    habilitationStatus: parsed.habilitationStatus,
    statusReason: parsed.statusReason ?? null,
    source: parsed.source ?? "MANUAL_AEA",
    metadataJson,
  });

  if (parsed.citizenAccessCode) {
    await pool.query(
      `UPDATE hn_citizen_sessions
       SET status='REVOKED', revoked_at=NOW()
       WHERE dni=$1 AND status='ACTIVE' AND revoked_at IS NULL`,
      [parsed.dni],
    );
  }

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "expediente-guardado", "ok", { dni: parsed.dni }));
}

async function bulkImportCensusAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = BulkCensusInputSchema.parse({
    recordsJson: String(formData.get("recordsJson") ?? ""),
  });

  const raw = JSON.parse(parsed.recordsJson);
  const records = z.array(HondurasCensusRecordSchema).parse(raw);

  for (const record of records) {
    await upsertHondurasVoterRegistryRecord({
      pool,
      dni: record.dni,
      fullName: record.fullName,
      firstName: record.firstName ?? null,
      middleName: record.middleName ?? null,
      lastName: record.lastName ?? null,
      secondLastName: record.secondLastName ?? null,
      habilitationStatus: record.habilitationStatus,
      statusReason: record.statusReason ?? null,
      censusCutoffAtIso: record.censusCutoffAt ?? null,
      source: record.source,
      metadataJson: record.metadata ?? {},
    });
  }

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "lote-importado"));
}

async function upsertWalletLinkAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = WalletLinkInputSchema.parse({
    dni: String(formData.get("dni") ?? ""),
    walletAddress: String(formData.get("walletAddress") ?? ""),
    linkStatus: String(formData.get("linkStatus") ?? ""),
    verificationMethod: String(formData.get("verificationMethod") ?? ""),
    evidenceJson: String(formData.get("evidenceJson") ?? "").trim() || undefined,
  });

  const censusRecord = await getHondurasVoterRegistryRecord({ pool, dni: parsed.dni });
  if (!censusRecord) {
    throw new Error("No existe ese DNI en el censo Honduras cargado.");
  }

  const walletAddress = ethers.getAddress(parsed.walletAddress).toLowerCase();
  const walletLink = HondurasWalletLinkSchema.parse({
    dni: parsed.dni,
    walletAddress,
    linkStatus: parsed.linkStatus,
    verificationMethod: parsed.verificationMethod,
    evidence: parseJsonObject(parsed.evidenceJson),
    revokedAt: parsed.linkStatus === "REVOKED" ? new Date().toISOString() : null,
  });

  await upsertHondurasWalletLink({
    pool,
    dni: walletLink.dni,
    walletAddress: walletLink.walletAddress,
    linkStatus: walletLink.linkStatus,
    verificationMethod: walletLink.verificationMethod as
      | "MANUAL_AEA"
      | "SELF_ATTESTED"
      | "CENSUS_VERIFIED"
      | "SYSTEM_MANAGED",
    evidenceJson: walletLink.evidence ?? {},
    revokedAtIso: walletLink.revokedAt ?? null,
  });

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "billetera-vinculada", "ok", { dni: parsed.dni }));
}

async function reviewEnrollmentRequestAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = EnrollmentReviewInputSchema.parse({
    requestId: String(formData.get("requestId") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    reviewNotes: String(formData.get("reviewNotes") ?? "").trim() || undefined,
  });

  await reviewHondurasEnrollmentRequest({
    pool,
    requestId: parsed.requestId,
    status: parsed.decision,
    reviewedBy: "AUTHORITY_CONSOLE",
    reviewNotes: parsed.reviewNotes ?? null,
  });

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "solicitud-revisada"));
}

async function createCensusFromEnrollmentRequestAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = EnrollmentToCensusInputSchema.parse({
    requestId: String(formData.get("requestId") ?? ""),
    dni: String(formData.get("dni") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    habilitationStatus: String(formData.get("habilitationStatus") ?? ""),
    statusReason: String(formData.get("statusReason") ?? "").trim() || undefined,
    source: String(formData.get("source") ?? "").trim() || undefined,
    citizenAccessCode: String(formData.get("citizenAccessCode") ?? "").trim() || undefined,
  });

  const metadataJson: Record<string, unknown> = {
    enrollmentRequestId: parsed.requestId,
    createdFromEnrollmentRequest: true,
  };

  if (parsed.citizenAccessCode) {
    metadataJson.citizenAccessCodeHash = ethers.keccak256(ethers.toUtf8Bytes(parsed.citizenAccessCode)).toLowerCase();
    metadataJson.citizenAccessCodeRotatedAt = new Date().toISOString();
  }

  const nameParts = parsed.fullName.trim().split(/\s+/).filter(Boolean);
  await upsertHondurasVoterRegistryRecord({
    pool,
    dni: parsed.dni,
    fullName: parsed.fullName,
    firstName: nameParts[0] ?? null,
    middleName: nameParts.length > 3 ? nameParts.slice(1, -2).join(" ") : nameParts[1] ?? null,
    lastName: nameParts.length >= 2 ? nameParts[nameParts.length - 2] ?? null : null,
    secondLastName: nameParts.length >= 1 ? nameParts[nameParts.length - 1] ?? null : null,
    habilitationStatus: parsed.habilitationStatus,
    statusReason: parsed.statusReason ?? null,
    source: parsed.source ?? "PUBLIC_ENROLLMENT_REVIEW",
    metadataJson,
  });

  if (parsed.citizenAccessCode) {
    await pool.query(
      `UPDATE hn_citizen_sessions
       SET status='REVOKED', revoked_at=NOW()
       WHERE dni=$1 AND status='ACTIVE' AND revoked_at IS NULL`,
      [parsed.dni],
    );
  }

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "expediente-desde-solicitud", "ok", { dni: parsed.dni }));
}

async function authorizeVoterAction(formData: FormData) {
  "use server";
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const parsed = AuthorizationInputSchema.parse({
    dni: String(formData.get("dni") ?? ""),
    electionId: String(formData.get("electionId") ?? ""),
    enrollmentRequestId: String(formData.get("enrollmentRequestId") ?? "").trim() || undefined,
    authorizationNotes: String(formData.get("authorizationNotes") ?? "").trim() || undefined,
  });

  const censusRecord = await getHondurasVoterRegistryRecord({ pool, dni: parsed.dni });
  if (!censusRecord) {
    throw new Error("No existe ese DNI en el censo.");
  }
  if (censusRecord.habilitationStatus !== "HABILITADO") {
    throw new Error("El DNI no esta habilitado; no puede autorizarse.");
  }

  const walletLink = await ensureSystemManagedWalletLink({ pool, dni: parsed.dni });

  await createHondurasVoterAuthorization({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId: parsed.electionId,
    dni: parsed.dni,
    walletAddress: walletLink.walletAddress,
    enrollmentRequestId: parsed.enrollmentRequestId ?? null,
    status: "AUTHORIZED",
    authorizedBy: "AUTHORITY_CONSOLE",
    authorizationNotes: parsed.authorizationNotes ?? null,
    metadataJson: {
      source: "AUTHORITY_CONSOLE",
    },
  });

  revalidatePath("/honduras");
  redirect(construirRutaConAviso("/honduras", "ciudadano-autorizado", "ok", { dni: parsed.dni }));
}

export default async function HondurasPage(props: {
  searchParams?: Promise<{ dni?: string; aviso?: string; tipo?: string }>;
}) {
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const dniQueryRaw = String(searchParams?.dni ?? "").trim();
  const dniQueryParsed = dniQueryRaw ? HondurasDniSchema.safeParse(dniQueryRaw) : null;
  const dniQuery = dniQueryParsed?.success ? dniQueryParsed.data : null;

  const [
    recentRecords,
    selectedRecord,
    selectedLinks,
    enrollmentRequests,
    selectedAuthorizations,
    recentAuthorizations,
    electionsResponse,
  ] = await Promise.all([
    listRecentHondurasVoterRegistryRecords({ pool, limit: 14 }),
    dniQuery ? getHondurasVoterRegistryRecord({ pool, dni: dniQuery }) : Promise.resolve(null),
    dniQuery ? listHondurasWalletLinksByDni({ pool, dni: dniQuery }) : Promise.resolve([]),
    listHondurasEnrollmentRequests({ pool, limit: 14 }),
    dniQuery
      ? listHondurasVoterAuthorizations({
          pool,
          chainId: env.CHAIN_ID,
          contractAddress: env.CONTRACT_ADDRESS,
          dni: dniQuery,
          limit: 40,
        })
      : Promise.resolve([]),
    listHondurasVoterAuthorizations({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      limit: 12,
    }),
    fetchJsonOrNull<ElectionsApiResponse>(`${env.EVIDENCE_API_URL}/v1/elections`),
  ]);

  const elections = (electionsResponse?.elections ?? [])
    .slice()
    .sort((a, b) => Number(b.electionId) - Number(a.electionId));

  const pendingEnrollments = enrollmentRequests.filter((row) => row.status === "PENDING_REVIEW").length;
  const recentEligibleRecords = recentRecords.filter((row) => row.habilitationStatus === "HABILITADO").length;
  const activeRecentAuthorizations = recentAuthorizations.filter(
    (row) => row.status === "AUTHORIZED" && !row.revokedAt,
  ).length;

  const defaultElectionId = elections[0]?.electionId ?? "";
  const electionById = new Map(elections.map((item) => [item.electionId, item]));
  const knownElectionIds = new Set(elections.map((item) => item.electionId));

  const selectedMetadata = asRecord(selectedRecord?.metadataJson);
  const selectedHasCitizenCode = typeof selectedMetadata.citizenAccessCodeHash === "string";
  const selectedCodeRotatedAt =
    typeof selectedMetadata.citizenAccessCodeRotatedAt === "string"
      ? selectedMetadata.citizenAccessCodeRotatedAt
      : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_500px_at_5%_-10%,#cffafe_0%,transparent_60%),radial-gradient(1100px_420px_at_100%_-12%,#dcfce7_0%,transparent_60%),#f8fafc] text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <header className="card surface-noise overflow-hidden">
          <div className="bg-gradient-to-r from-cyan-950 via-teal-900 to-emerald-900 px-6 py-6 text-white">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">Honduras: censo y autorizacion electoral</h1>
                <p className="max-w-3xl text-sm text-cyan-100">
                  Flujo operativo para consultar DNI, administrar expedientes y autorizar ciudadania por eleccion de forma trazable.
                </p>
              </div>
              <Link
                className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                href="/"
              >
                Volver a consola
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-cyan-100/90">
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1">chainId={env.CHAIN_ID}</span>
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 break-all">contract={env.CONTRACT_ADDRESS}</span>
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 break-all">
                API={env.EVIDENCE_API_URL}/v1/hn/eligibility/:dni
              </span>
            </div>
          </div>

          <div className="grid gap-3 border-t border-slate-200 bg-white/95 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">Elecciones indexadas</div>
              <div className="mt-1 text-2xl font-semibold text-cyan-950">{elections.length}</div>
              <div className="text-xs text-cyan-700">desde Evidence API</div>
            </article>

            <article className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Expedientes habilitados</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-950">{recentEligibleRecords}</div>
              <div className="text-xs text-emerald-700">en ultimos registros</div>
            </article>

            <article className="rounded-xl border border-amber-100 bg-amber-50/80 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Pendientes de revision</div>
              <div className="mt-1 text-2xl font-semibold text-amber-950">{pendingEnrollments}</div>
              <div className="text-xs text-amber-700">solicitudes de enrolamiento</div>
            </article>

            <article className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-800">Autorizaciones activas</div>
              <div className="mt-1 text-2xl font-semibold text-indigo-950">{activeRecentAuthorizations}</div>
              <div className="text-xs text-indigo-700">en ventana reciente</div>
            </article>
          </div>
        </header>

        <div className="flex justify-end">
          <LiveRefresh label="Panel operativo en vivo" intervalMs={15000} />
        </div>
        <ActionNotice codigo={searchParams?.aviso} tipo={searchParams?.tipo} />

        {!dniQuery && dniQueryRaw ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            El DNI en la URL no tiene formato valido de 13 digitos.
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <section className="card motion-rise overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="section-title">Flujo operativo recomendado</div>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-4">
                {[
                  ["1", "Consultar o crear expediente", "Carga el DNI, nombre y estado de habilitación."],
                  ["2", "Configurar acceso", "Define o rota el código ciudadano y revisa observaciones."],
                  ["3", "Autorizar por elección", "Provisiona una billetera gestionada y crea la autorización activa."],
                  ["4", "Validar en portal", "El ciudadano ya puede entrar al flujo de voto con su código."],
                ].map(([index, title, description]) => (
                  <article key={index} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Paso {index}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{title}</div>
                    <p className="mt-2 text-xs text-slate-600">{description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="card motion-rise p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="section-title">Buscar y validar DNI</div>
                  <p className="mt-1 text-xs text-slate-600">
                    Consulta expediente, estado de habilitación, billeteras y autorizaciones por elección.
                  </p>
                </div>
              </div>

              <form action={lookupDniAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="dni"
                  placeholder="0801199912345"
                  defaultValue={dniQuery ?? ""}
                  required
                />
                <button
                  className="rounded-lg bg-cyan-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800"
                  type="submit"
                >
                  Consultar expediente
                </button>
              </form>

              {dniQuery ? (
                selectedRecord ? (
                  <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{selectedRecord.fullName}</div>
                        <div className="text-xs text-slate-500">DNI {selectedRecord.dni}</div>
                      </div>
                      <span className={statusBadgeClass(selectedRecord.habilitationStatus)}>
                        {etiquetaEstado(selectedRecord.habilitationStatus)}
                      </span>
                    </div>

                    <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <span className="font-semibold text-slate-900">Fuente:</span> {selectedRecord.source}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <span className="font-semibold text-slate-900">Actualizado:</span> {formatTimestamp(selectedRecord.updatedAt)}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <span className="font-semibold text-slate-900">Codigo ciudadano:</span>{" "}
                        {selectedHasCitizenCode ? "configurado" : "no configurado"}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <span className="font-semibold text-slate-900">Rotacion codigo:</span> {formatTimestamp(selectedCodeRotatedAt)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                      {selectedRecord.statusReason || "Sin observaciones registradas."}
                    </div>

                    <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4">
                      <div className="text-sm font-semibold text-teal-900">Autorizar para elección</div>
                      <p className="mt-1 text-xs text-teal-800">
                        Esta acción crea o actualiza la autorización del DNI en la elección seleccionada y provisiona una billetera gestionada si no existe una activa.
                      </p>

                      {selectedRecord.habilitationStatus !== "HABILITADO" ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Este expediente no esta habilitado. Actualiza su estado a HABILITADO para autorizarlo.
                        </div>
                      ) : (
                        <form action={authorizeVoterAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                          <input type="hidden" name="dni" value={selectedRecord.dni} />

                          {elections.length > 0 ? (
                            <select
                              className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                              name="electionId"
                              defaultValue={defaultElectionId}
                              required
                            >
                              {elections.map((election) => (
                                <option key={election.electionId} value={election.electionId}>
                                  {electionOptionLabel(election)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                              name="electionId"
                              placeholder="ID de eleccion"
                              required
                            />
                          )}

                          <input
                            className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                            name="authorizationNotes"
                            placeholder="Notas de autorizacion"
                          />

                          <button
                            className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-600"
                            type="submit"
                          >
                            Autorizar DNI
                          </button>
                        </form>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Autorizaciones del DNI consultado
                        </div>

                        {selectedAuthorizations.length === 0 ? (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                            Sin autorizaciones registradas para este DNI.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {selectedAuthorizations.map((row) => {
                              const electionMeta = electionById.get(row.electionId);
                              return (
                                <div key={row.authorizationId} className="rounded-lg border border-slate-200 bg-white p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-semibold text-slate-900">
                                      Eleccion #{row.electionId}
                                    </div>
                                    <span className={statusBadgeClass(row.status)}>{etiquetaEstado(row.status)}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    fase={
                                      electionMeta
                                        ? phaseLabelEs(electionMeta.phaseLabel, electionMeta.phase)
                                        : "sin indice"
                                    }
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    billetera={row.walletAddress} · autorizado={formatTimestamp(row.authorizedAt)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Billeteras vinculadas
                        </div>

                        {selectedLinks.length === 0 ? (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                            Sin wallets vinculadas.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {selectedLinks.map((link) => (
                              <div key={`${link.dni}-${link.walletAddress}`} className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <code className="hash-display">{link.walletAddress}</code>
                                  <span className={statusBadgeClass(link.linkStatus)}>{etiquetaEstado(link.linkStatus)}</span>
                                </div>
                                <div className="mt-2 text-xs text-slate-600">
                                  método={etiquetaMetodoBilletera(link.verificationMethod)} · actualizado={formatTimestamp(link.updatedAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    El DNI consultado no existe en el censo cargado.
                  </div>
                )
              ) : null}
            </section>

            <section className="card motion-rise motion-rise-delay-1 space-y-3 p-4 md:p-5">
              <div>
                <div className="section-title">Registrar o actualizar expediente</div>
                <p className="mt-1 text-xs text-slate-600">
                  Crea o corrige datos de censo para habilitar autorizaciones y autenticacion ciudadana.
                </p>
              </div>

              <form action={upsertCensusRecordAction} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="dni"
                    placeholder="DNI"
                    defaultValue={dniQuery ?? ""}
                  />
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="habilitationStatus"
                    defaultValue="HABILITADO"
                  >
                    <option value="HABILITADO">HABILITADO</option>
                    <option value="INHABILITADO">INHABILITADO</option>
                    <option value="SUSPENDIDO">SUSPENDIDO</option>
                    <option value="FALLECIDO">FALLECIDO</option>
                    <option value="OBSERVADO">OBSERVADO</option>
                  </select>
                </div>

                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="fullName"
                  placeholder="Nombre completo"
                />

                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="statusReason"
                  placeholder="Motivo o nota de estado"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="source"
                    placeholder="Fuente"
                    defaultValue="MANUAL_AEA"
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="citizenAccessCode"
                    placeholder="Codigo ciudadano (min. 6)"
                  />
                </div>

                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="metadataJson"
                  placeholder='Metadata JSON opcional, p.ej. {"batch":"abril"}'
                />

                <PendingSubmitButton
                  idleLabel="Guardar expediente"
                  pendingLabel="Guardando expediente..."
                  className="rounded-lg bg-cyan-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800"
                />
              </form>
            </section>

            <section className="card motion-rise motion-rise-delay-2 space-y-3 p-4 md:p-5">
              <div>
                <div className="section-title">Importacion masiva</div>
                <p className="mt-1 text-xs text-slate-600">
                  Carga lotes de expedientes desde JSON validado contra esquema compartido.
                </p>
              </div>

              <form action={bulkImportCensusAction} className="space-y-3">
                <textarea
                  className="min-h-56 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  name="recordsJson"
                  placeholder={`[
  {
    "dni": "0801199912345",
    "fullName": "Ciudadana Ejemplo",
    "habilitationStatus": "HABILITADO",
    "statusReason": "Verificado internamente",
    "source": "CENSO_HN_2026"
  }
]`}
                />
                <PendingSubmitButton
                  idleLabel="Importar lote"
                  pendingLabel="Importando lote..."
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                />
              </form>
            </section>
          </div>

          <div className="space-y-6">
            <section className="card p-4 md:p-5">
              <div className="section-title">Elecciones disponibles</div>

              {electionsResponse === null ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  No se pudo consultar la lista de elecciones desde Evidence API.
                </div>
              ) : elections.length === 0 ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  No hay elecciones indexadas todavia.
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {elections.slice(0, 6).map((election) => (
                    <div key={election.electionId} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Eleccion #{election.electionId}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            fase={phaseLabelEs(election.phaseLabel, election.phase)}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            inscripciones={election.counts?.signups ?? 0} · boletas={election.counts?.ballots ?? 0}
                          </div>
                        </div>
                        <span className="hash-display" title={election.manifestHash}>
                          {shortHash(election.manifestHash)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-4 md:p-5">
              <div className="section-title">Solicitudes de enrolamiento</div>

              {enrollmentRequests.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">No hay solicitudes todavia.</div>
              ) : (
                <div className="mt-3 space-y-3">
                  {enrollmentRequests.map((request) => {
                    const metadata = asRecord(request.metadataJson);
                    const requestedFullName = typeof metadata.fullName === "string" ? metadata.fullName : "";
                    const contactEmail = typeof metadata.contactEmail === "string" ? metadata.contactEmail : "";
                    const contactPhone = typeof metadata.contactPhone === "string" ? metadata.contactPhone : "";
                    const requestedElectionId = typeof metadata.electionId === "string" ? metadata.electionId : "";
                    const preferredElectionId = requestedElectionId || defaultElectionId;

                    return (
                      <div key={request.requestId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">DNI {request.dni}</div>
                            <div className="text-xs text-slate-500">
                              canal={etiquetaCanalSolicitud(request.requestChannel)} · solicitado={formatTimestamp(request.requestedAt)}
                            </div>
                          </div>
                          <span className={statusBadgeClass(request.status)}>{etiquetaEstado(request.status)}</span>
                        </div>

                        {request.requestNotes ? (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                            {request.requestNotes}
                          </div>
                        ) : null}

                        {requestedFullName || contactEmail || contactPhone || requestedElectionId ? (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                            {requestedFullName ? <div>Nombre reportado: {requestedFullName}</div> : null}
                            {contactEmail ? <div>Correo: {contactEmail}</div> : null}
                            {contactPhone ? <div>Telefono: {contactPhone}</div> : null}
                            {requestedElectionId ? <div>Eleccion solicitada: #{requestedElectionId}</div> : null}
                          </div>
                        ) : null}

                        {request.status === "PENDING_REVIEW" ? (
                          <div className="mt-3 grid gap-3">
                            <form action={createCensusFromEnrollmentRequestAction} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
                              <input type="hidden" name="requestId" value={request.requestId} />
                              <input type="hidden" name="dni" value={request.dni} />
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Crear o actualizar expediente
                              </div>
                              <input
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                name="fullName"
                                defaultValue={requestedFullName}
                                placeholder="Nombre completo validado"
                              />

                              <div className="grid gap-2 sm:grid-cols-2">
                                <select
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  name="habilitationStatus"
                                  defaultValue="OBSERVADO"
                                >
                                  <option value="HABILITADO">HABILITADO</option>
                                  <option value="OBSERVADO">OBSERVADO</option>
                                  <option value="INHABILITADO">INHABILITADO</option>
                                  <option value="SUSPENDIDO">SUSPENDIDO</option>
                                </select>

                                <input
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  name="citizenAccessCode"
                                  placeholder="Codigo ciudadano inicial"
                                />
                              </div>

                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  name="source"
                                  defaultValue="PUBLIC_ENROLLMENT_REVIEW"
                                  placeholder="Fuente"
                                />
                                <input
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  name="statusReason"
                                  placeholder="Resultado de validacion"
                                />
                              </div>

                              <PendingSubmitButton
                                idleLabel="Guardar expediente desde solicitud"
                                pendingLabel="Guardando expediente..."
                                className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-600"
                              />
                            </form>

                            <form action={reviewEnrollmentRequestAction} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
                              <input type="hidden" name="requestId" value={request.requestId} />
                              <input
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                name="reviewNotes"
                                placeholder="Notas de revision"
                              />
                              <div className="flex gap-2">
                                <button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600" type="submit" name="decision" value="APPROVED">
                                  Aprobar expediente
                                </button>
                                <button className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-600" type="submit" name="decision" value="REJECTED">
                                  Rechazar
                                </button>
                              </div>
                            </form>

                            <form action={authorizeVoterAction} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
                              <input type="hidden" name="dni" value={request.dni} />
                              <input type="hidden" name="enrollmentRequestId" value={request.requestId} />

                              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                                {elections.length > 0 ? (
                                  <select
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                    name="electionId"
                                    defaultValue={preferredElectionId}
                                    required
                                  >
                                    {requestedElectionId && !knownElectionIds.has(requestedElectionId) ? (
                                      <option value={requestedElectionId}>#{requestedElectionId} - no indexada</option>
                                    ) : null}
                                    {elections.map((election) => (
                                      <option key={election.electionId} value={election.electionId}>
                                        {electionOptionLabel(election)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                    name="electionId"
                                    defaultValue={requestedElectionId}
                                    placeholder="ID de eleccion"
                                    required
                                  />
                                )}

                                <input
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                  name="authorizationNotes"
                                  placeholder="Notas de autorizacion"
                                />

                                <PendingSubmitButton
                                  idleLabel="Autorizar para elección"
                                  pendingLabel="Autorizando..."
                                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                                />
                              </div>
                            </form>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            revisado por {request.reviewedBy ?? "-"} · {formatTimestamp(request.reviewedAt)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="card p-4 md:p-5">
              <div className="section-title">Vincular billetera</div>
              <form action={upsertWalletLinkAction} className="mt-3 grid gap-3">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="dni"
                  placeholder="DNI ya cargado"
                  defaultValue={dniQuery ?? ""}
                />

                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="walletAddress"
                  placeholder="0x..."
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="linkStatus"
                    defaultValue="ACTIVE"
                  >
                    <option value="ACTIVE">Activa</option>
                    <option value="PENDING">PENDING</option>
                    <option value="REVOKED">Revocada</option>
                  </select>

                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    name="verificationMethod"
                    defaultValue="MANUAL_AEA"
                  >
                    <option value="MANUAL_AEA">MANUAL_AEA</option>
                    <option value="SELF_ATTESTED">SELF_ATTESTED</option>
                    <option value="CENSUS_VERIFIED">CENSUS_VERIFIED</option>
                  </select>
                </div>

                <textarea
                  className="min-h-28 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  name="evidenceJson"
                  placeholder='Evidence JSON opcional, p.ej. {"operator":"aea-admin"}'
                />

                <PendingSubmitButton
                  idleLabel="Guardar vínculo"
                  pendingLabel="Guardando vínculo..."
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                />
              </form>
            </section>

            <section className="card p-4 md:p-5">
              <div className="section-title">Ultimos expedientes cargados</div>

              {recentRecords.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">Aun no hay registros cargados.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {recentRecords.map((record) => (
                    <Link
                      key={record.dni}
                      href={`/honduras?dni=${encodeURIComponent(record.dni)}`}
                      className="block rounded-lg border border-slate-200 bg-slate-50/70 p-3 transition hover:border-cyan-200 hover:bg-cyan-50/60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{record.fullName}</div>
                          <div className="text-xs text-slate-500">{record.dni}</div>
                        </div>
                        <span className={statusBadgeClass(record.habilitationStatus)}>
                          {record.habilitationStatus}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        fuente={record.source} · actualizado={formatTimestamp(record.updatedAt)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-4 md:p-5">
              <div className="section-title">Ultimas autorizaciones emitidas</div>

              {recentAuthorizations.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">Sin autorizaciones recientes.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {recentAuthorizations.map((row) => (
                    <div key={row.authorizationId} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          DNI {row.dni} · eleccion #{row.electionId}
                        </div>
                        <span className={statusBadgeClass(row.status)}>{etiquetaEstado(row.status)}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        billetera={row.walletAddress} · autorizado={formatTimestamp(row.authorizedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
