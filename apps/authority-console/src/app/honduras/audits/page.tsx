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

import { getEnv } from "../../../lib/env";
import { LiveRefresh } from "../../components/LiveRefresh";
import { ActionNotice, construirRutaConAviso } from "../../components/ActionNotice";
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
} from "../../../lib/db";
import { HondurasHeader } from "../../components/honduras/HondurasHeader";
import { HondurasWorkflow } from "../../components/honduras/HondurasWorkflow";
import { DniLookup } from "../../components/honduras/DniLookup";
import { RegistryForms } from "../../components/honduras/RegistryForms";
import { RecentRecordsList } from "../../components/honduras/RecentRecordsList";
import { EnrollmentRequestsList } from "../../components/honduras/EnrollmentRequestsList";

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
    <div>
      <div className="space-y-8">
        <ActionNotice codigo={searchParams?.aviso} tipo={searchParams?.tipo} />

        {!dniQuery && dniQueryRaw ? (
          <div className="bg-red-50 text-red-800 border-l-4 border-red-500 p-4 rounded-md text-sm">
            El DNI en la URL no tiene formato válido de 13 dígitos.
          </div>
        ) : null}

        <div className="grid gap-8 xl:grid-cols-2">
          <div className="space-y-8">

            <EnrollmentRequestsList
              enrollmentRequests={enrollmentRequests}
              reviewEnrollmentRequestAction={reviewEnrollmentRequestAction}
              createCensusFromEnrollmentRequestAction={createCensusFromEnrollmentRequestAction}
            />

            <RecentRecordsList recentRecords={recentRecords} />
          </div>
        </div>
      </div>
    </div>
  );
}
