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
} from "@blockurna/shared";
import { z } from "zod";

import { getEnv } from "../../lib/env";
import {
  ensureSchema,
  createHondurasVoterAuthorization,
  getHondurasVoterRegistryRecord,
  getPool,
  listHondurasEnrollmentRequests,
  listHondurasWalletLinksByDni,
  listHondurasVoterAuthorizations,
  listRecentHondurasVoterRegistryRecords,
  reviewHondurasEnrollmentRequest,
  upsertHondurasVoterRegistryRecord,
  upsertHondurasWalletLink,
} from "../../lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

const AuthorizationInputSchema = z
  .object({
    dni: HondurasDniSchema,
    electionId: z.string().trim().regex(/^\d+$/),
    enrollmentRequestId: z.string().uuid().optional(),
    authorizationNotes: z.string().trim().max(500).optional(),
  })
  .strict();

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Se esperaba un objeto JSON.");
  }
  return parsed as Record<string, unknown>;
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
  redirect(`/honduras?dni=${encodeURIComponent(parsed.dni)}`);
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
  redirect("/honduras");
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
  redirect(`/honduras?dni=${encodeURIComponent(parsed.dni)}`);
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
  redirect("/honduras");
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
    throw new Error("El DNI no está habilitado; no puede autorizarse.");
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
  redirect(`/honduras?dni=${encodeURIComponent(parsed.dni)}`);
}

function statusBadgeClass(status: string): string {
  const value = String(status).toUpperCase();
  if (value === "HABILITADO" || value === "ACTIVE") return "badge badge-valid";
  if (value === "INHABILITADO" || value === "SUSPENDIDO" || value === "REVOKED") return "badge badge-critical";
  return "badge badge-warning";
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
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

export default async function HondurasPage(props: {
  searchParams?: Promise<{ dni?: string }>;
}) {
  const env = getEnv();
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const dniQueryRaw = String(searchParams?.dni ?? "").trim();
  const dniQueryParsed = dniQueryRaw ? HondurasDniSchema.safeParse(dniQueryRaw) : null;
  const dniQuery = dniQueryParsed?.success ? dniQueryParsed.data : null;

  const [recentRecords, selectedRecord, selectedLinks, enrollmentRequests, authorizations] = await Promise.all([
    listRecentHondurasVoterRegistryRecords({ pool, limit: 12 }),
    dniQuery ? getHondurasVoterRegistryRecord({ pool, dni: dniQuery }) : Promise.resolve(null),
    dniQuery ? listHondurasWalletLinksByDni({ pool, dni: dniQuery }) : Promise.resolve([]),
    listHondurasEnrollmentRequests({ pool, limit: 12 }),
    listHondurasVoterAuthorizations({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      limit: 12,
    }),
  ]);

  return (
    <main className="min-h-screen text-slate-900">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <header className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold">Honduras Scope</h1>
              <p className="text-sm text-slate-700">
                Censo mínimo para BlockUrna: consulta de DNI, estado de habilitación y vínculo DNI-wallet.
              </p>
            </div>
            <Link
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              href="/"
            >
              Volver a consola
            </Link>
          </div>
          <div className="text-xs text-slate-500 break-all">
            API pública: {env.EVIDENCE_API_URL}/v1/hn/eligibility/:dni
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <section className="card p-4 space-y-3">
              <div className="section-title">Consultar DNI</div>
              <form action={lookupDniAction} className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  name="dni"
                  placeholder="0801199912345"
                  defaultValue={dniQuery ?? ""}
                />
                <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
                  Consultar
                </button>
              </form>

              {dniQuery ? (
                selectedRecord ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{selectedRecord.fullName}</div>
                        <div className="text-xs text-slate-500">DNI {selectedRecord.dni}</div>
                      </div>
                      <span className={statusBadgeClass(selectedRecord.habilitationStatus)}>
                        {selectedRecord.habilitationStatus}
                      </span>
                    </div>
                    <div className="text-sm text-slate-700">
                      {selectedRecord.statusReason || "Sin observaciones registradas."}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                      <div>Fuente: {selectedRecord.source}</div>
                      <div>Actualizado: {formatTimestamp(selectedRecord.updatedAt)}</div>
                      <div>
                        Código ciudadano: {typeof (selectedRecord.metadataJson as Record<string, unknown>)?.citizenAccessCodeHash === "string" ? "configurado" : "no configurado"}
                      </div>
                      <div>
                        Rotación código: {typeof (selectedRecord.metadataJson as Record<string, unknown>)?.citizenAccessCodeRotatedAt === "string"
                          ? formatTimestamp(String((selectedRecord.metadataJson as Record<string, unknown>).citizenAccessCodeRotatedAt))
                          : "—"}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Autorizaciones activas</div>
                      {authorizations.filter((row) => row.dni === selectedRecord.dni).length === 0 ? (
                        <div className="text-sm text-slate-500">Sin autorización activa para elecciones.</div>
                      ) : (
                        <div className="space-y-2">
                          {authorizations
                            .filter((row) => row.dni === selectedRecord.dni)
                            .map((row) => (
                              <div key={row.authorizationId} className="rounded-md border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-sm font-semibold text-slate-900">Elección #{row.electionId}</div>
                                  <span className={statusBadgeClass(row.status)}>{row.status}</span>
                                </div>
                                <div className="mt-2 text-xs text-slate-600">
                                  wallet={row.walletAddress} · autorizado={formatTimestamp(row.authorizedAt)}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallets vinculadas</div>
                      {selectedLinks.length === 0 ? (
                        <div className="text-sm text-slate-500">Sin wallets vinculadas.</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedLinks.map((link) => (
                            <div key={`${link.dni}-${link.walletAddress}`} className="rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-3">
                                <code className="hash-display">{link.walletAddress}</code>
                                <span className={statusBadgeClass(link.linkStatus)}>{link.linkStatus}</span>
                              </div>
                              <div className="mt-2 text-xs text-slate-600">
                                método={link.verificationMethod} · actualizado={formatTimestamp(link.updatedAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    El DNI consultado no existe en el censo cargado.
                  </div>
                )
              ) : null}
            </section>

            <section className="card p-4 space-y-3">
              <div className="section-title">Registrar o actualizar DNI</div>
              <form action={upsertCensusRecordAction} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="dni" placeholder="DNI" />
                  <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="habilitationStatus" defaultValue="HABILITADO">
                    <option value="HABILITADO">HABILITADO</option>
                    <option value="INHABILITADO">INHABILITADO</option>
                    <option value="SUSPENDIDO">SUSPENDIDO</option>
                    <option value="FALLECIDO">FALLECIDO</option>
                    <option value="OBSERVADO">OBSERVADO</option>
                  </select>
                </div>
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="fullName" placeholder="Nombre completo" />
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="statusReason" placeholder="Motivo o nota de estado" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="source" placeholder="Fuente" defaultValue="MANUAL_AEA" />
                  <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="citizenAccessCode" placeholder="Código ciudadano (mín. 6)" />
                </div>
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="metadataJson" placeholder='Metadata JSON opcional, p.ej. {"batch":"abril"}' />
                <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
                  Guardar DNI
                </button>
              </form>
            </section>

            <section className="card p-4 space-y-3">
              <div className="section-title">Importación masiva</div>
              <form action={bulkImportCensusAction} className="space-y-3">
                <textarea
                  className="min-h-56 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  name="recordsJson"
                  placeholder={`[
  {
    "dni": "0801199912345",
    "fullName": "Ciudadana Demo",
    "habilitationStatus": "HABILITADO",
    "statusReason": "Verificado internamente",
    "source": "CENSO_HN_2026"
  }
]`}
                />
                <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white" type="submit">
                  Importar lote
                </button>
              </form>
            </section>
          </div>

          <div className="space-y-6">
            <section className="card p-4 space-y-3">
              <div className="section-title">Solicitudes de enrolamiento</div>
              {enrollmentRequests.length === 0 ? (
                <div className="text-sm text-slate-500">No hay solicitudes todavía.</div>
              ) : (
                <div className="space-y-3">
                  {enrollmentRequests.map((request) => (
                    <div key={request.requestId} className="rounded-md border border-slate-200 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">DNI {request.dni}</div>
                          <div className="text-xs text-slate-500">
                            canal={request.requestChannel} · solicitado={formatTimestamp(request.requestedAt)}
                          </div>
                        </div>
                        <span className={statusBadgeClass(request.status)}>{request.status}</span>
                      </div>
                      {request.requestNotes ? (
                        <div className="text-sm text-slate-700">{request.requestNotes}</div>
                      ) : null}
                      {request.status === "PENDING_REVIEW" ? (
                        <div className="grid gap-3">
                          <form action={reviewEnrollmentRequestAction} className="grid gap-2">
                            <input type="hidden" name="requestId" value={request.requestId} />
                            <input
                              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                              name="reviewNotes"
                              placeholder="Notas de revisión"
                            />
                            <div className="flex gap-2">
                              <button className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white" type="submit" name="decision" value="APPROVED">
                                Aprobar expediente
                              </button>
                              <button className="rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white" type="submit" name="decision" value="REJECTED">
                                Rechazar
                              </button>
                            </div>
                          </form>
                          <form action={authorizeVoterAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                            <input type="hidden" name="dni" value={request.dni} />
                            <input type="hidden" name="enrollmentRequestId" value={request.requestId} />
                            <div className="grid gap-2">
                              <input
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                name="electionId"
                                placeholder="Election ID"
                              />
                              <input
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                                name="authorizationNotes"
                                placeholder="Notas de autorización"
                              />
                            </div>
                            <button className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white" type="submit">
                              Autorizar para elección
                            </button>
                          </form>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">
                          revisado por {request.reviewedBy ?? "—"} · {formatTimestamp(request.reviewedAt)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-4 space-y-3">
              <div className="section-title">Vincular wallet</div>
              <form action={upsertWalletLinkAction} className="grid gap-3">
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  name="dni"
                  placeholder="DNI ya cargado"
                  defaultValue={dniQuery ?? ""}
                />
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="walletAddress" placeholder="0x..." />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="linkStatus" defaultValue="ACTIVE">
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PENDING">PENDING</option>
                    <option value="REVOKED">REVOKED</option>
                  </select>
                  <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" name="verificationMethod" defaultValue="MANUAL_AEA">
                    <option value="MANUAL_AEA">MANUAL_AEA</option>
                    <option value="SELF_ATTESTED">SELF_ATTESTED</option>
                    <option value="CENSUS_VERIFIED">CENSUS_VERIFIED</option>
                  </select>
                </div>
                <textarea
                  className="min-h-28 rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  name="evidenceJson"
                  placeholder='Evidence JSON opcional, p.ej. {"operator":"aea-admin"}'
                />
                <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white" type="submit">
                  Guardar vínculo
                </button>
              </form>
            </section>

            <section className="card p-4 space-y-3">
              <div className="section-title">Últimos DNIs cargados</div>
              {recentRecords.length === 0 ? (
                <div className="text-sm text-slate-500">Aún no hay registros Honduras cargados.</div>
              ) : (
                <div className="space-y-2">
                  {recentRecords.map((record) => (
                    <Link
                      key={record.dni}
                      href={`/honduras?dni=${encodeURIComponent(record.dni)}`}
                      className="block rounded-md border border-slate-200 p-3 hover:bg-slate-50"
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
          </div>
        </section>
      </div>
    </main>
  );
}
