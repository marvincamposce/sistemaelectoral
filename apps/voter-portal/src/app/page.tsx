"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FilePlus2, Search, ShieldAlert, Wallet } from "lucide-react";

import { getPublicEnv } from "@/lib/env";

type EnrollmentLookupResponse = {
  ok: boolean;
  error?: string;
  session?: {
    sessionId: string;
    token: string;
    authMethod: string;
    expiresAt: string;
  };
  record?: {
    dni: string;
    fullName: string;
    habilitationStatus: string;
    statusReason?: string | null;
  };
  latestRequest?: {
    requestId: string;
    status: string;
    requestedAt: string;
    reviewedAt?: string | null;
  } | null;
  walletLink?: {
    walletAddress: string;
    verificationMethod: string;
  } | null;
  authorizations?: Array<{
    electionId: string;
    status: string;
    authorizedAt: string;
  }>;
};

type EnrollmentRequestResponse = {
  ok: boolean;
  error?: string;
  request?: {
    requestId: string;
    status: string;
    requestedAt: string;
  };
};

const CITIZEN_SESSION_STORAGE_KEY = "bu_citizen_session";

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

function statusTone(status: string | undefined): string {
  const value = String(status ?? "").toUpperCase();
  if (value === "AUTHORIZED" || value === "HABILITADO") return "badge badge-valid";
  if (value === "REJECTED" || value === "INHABILITADO" || value === "SUSPENDIDO") return "badge badge-critical";
  return "badge badge-warning";
}

export default function Home() {
  const env = getPublicEnv();
  const router = useRouter();

  const [dni, setDni] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [electionId, setElectionId] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [lookup, setLookup] = useState<EnrollmentLookupResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState<"LOOKUP" | "REQUEST" | "GO" | null>(null);

  const normalizedDni = useMemo(() => dni.replace(/\D/g, ""), [dni]);
  const canLookup = normalizedDni.length === 13;
  const selectedAuthorization = useMemo(
    () => lookup?.authorizations?.find((row) => row.electionId === electionId && row.status === "AUTHORIZED") ?? null,
    [lookup, electionId],
  );

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    if (!canLookup) return;
    setBusy("LOOKUP");
    setErrorMsg("");
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/auth/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dni: normalizedDni,
          accessCode: accessCode.trim(),
        }),
      });
      const data = (await res.json()) as EnrollmentLookupResponse;
      if (!res.ok || !data.ok) {
        if (data.error === "invalid_access_code") {
          throw new Error("El código de acceso ciudadano es inválido.");
        }
        if (data.error === "citizen_access_not_configured") {
          throw new Error("Tu expediente no tiene un código ciudadano configurado. Contacta a la autoridad electoral.");
        }
        throw new Error(data.error || "No se pudo autenticar tu expediente.");
      }
      if (data.session) {
        sessionStorage.setItem(CITIZEN_SESSION_STORAGE_KEY, JSON.stringify({
          dni: normalizedDni,
          token: data.session.token,
          expiresAt: data.session.expiresAt,
          authMethod: data.session.authMethod,
        }));
      }
      setLookup(data);
    } catch (error: unknown) {
      setLookup(null);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleEnrollmentRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!canLookup) return;
    setBusy("REQUEST");
    setErrorMsg("");
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/enrollment-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(lookup?.session?.token ? { Authorization: `Bearer ${lookup.session.token}` } : {}),
        },
        body: JSON.stringify({
          dni: normalizedDni,
          electionId: electionId.trim() || undefined,
          requestNotes: requestNotes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as EnrollmentRequestResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "No se pudo crear la solicitud de enrolamiento.");
      }
      await handleLookup(event);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function goToVote() {
    if (!electionId.trim()) {
      setErrorMsg("Debes indicar el identificador de elección.");
      return;
    }
    if (!selectedAuthorization) {
      setErrorMsg("Todavía no estás autorizado para esa elección.");
      return;
    }
    setBusy("GO");
    router.push(`/vote/${encodeURIComponent(electionId.trim())}`);
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="card p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Portal ciudadano</h2>
            <p className="text-sm text-slate-600">
              Consulta tu expediente, solicita enrolamiento y verifica si ya estás autorizado para votar.
            </p>
          </div>

          <form onSubmit={handleLookup} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">DNI</label>
              <input
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="0801199912345"
                value={dni}
                onChange={(event) => setDni(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Código de acceso</label>
              <input
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Código ciudadano"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                type="password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Elección</label>
              <input
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="1"
                value={electionId}
                onChange={(event) => setElectionId(event.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={!canLookup || accessCode.trim().length < 6 || busy !== null}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === "LOOKUP" ? "Autenticando..." : "Autenticar expediente"}
            </button>
          </form>

          <form onSubmit={handleEnrollmentRequest} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FilePlus2 className="h-4 w-4 text-indigo-600" />
              Solicitar enrolamiento
            </div>
            <textarea
              className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Escribe una nota breve para la autoridad electoral si necesitas enrolarte o reactivar tu expediente."
              value={requestNotes}
              onChange={(event) => setRequestNotes(event.target.value)}
            />
            <button
              type="submit"
              disabled={!canLookup || busy !== null}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy === "REQUEST" ? "Enviando solicitud..." : "Crear solicitud"}
            </button>
          </form>

          {errorMsg ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {errorMsg}
            </div>
          ) : null}
        </section>

        <section className="card p-8 space-y-5">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-900">Estado actual</h3>
            <p className="text-sm text-slate-600">Lo que sabe el sistema sobre tu registro y tu autorización.</p>
          </div>

          {!lookup ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              Consulta tu expediente para ver habilitación, solicitud, wallet y autorización por elección.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{lookup.record?.fullName}</div>
                    <div className="text-xs text-slate-500">DNI {lookup.record?.dni}</div>
                  </div>
                  <span className={statusTone(lookup.record?.habilitationStatus)}>{lookup.record?.habilitationStatus}</span>
                </div>
                <div className="text-sm text-slate-700">{lookup.record?.statusReason || "Sin observaciones registradas."}</div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Search className="h-4 w-4 text-indigo-600" />
                  Última solicitud de enrolamiento
                </div>
                {lookup.latestRequest ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className={statusTone(lookup.latestRequest.status)}>{lookup.latestRequest.status}</span>
                      <span className="text-xs text-slate-500">{formatTimestamp(lookup.latestRequest.requestedAt)}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      revisada: {formatTimestamp(lookup.latestRequest.reviewedAt)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">No existe solicitud todavía.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Wallet className="h-4 w-4 text-indigo-600" />
                  Wallet vinculada
                </div>
                {lookup.walletLink ? (
                  <>
                    <code className="hash-display">{lookup.walletLink.walletAddress}</code>
                    <div className="text-xs text-slate-500">método={lookup.walletLink.verificationMethod}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">Todavía no hay wallet provisionada.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Autorización por elección
                </div>
                {lookup.authorizations && lookup.authorizations.length > 0 ? (
                  <div className="space-y-2">
                    {lookup.authorizations.map((authorization) => (
                      <div key={`${authorization.electionId}-${authorization.authorizedAt}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">Elección #{authorization.electionId}</div>
                          <span className={statusTone(authorization.status)}>{authorization.status}</span>
                        </div>
                        <div className="text-xs text-slate-500">autorizado: {formatTimestamp(authorization.authorizedAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                    <ShieldAlert className="h-4 w-4 mt-0.5" />
                    <span>No existe autorización activa para ninguna elección.</span>
                  </div>
                )}
              </div>

              <button
                onClick={goToVote}
                disabled={!selectedAuthorization || busy !== null || !electionId.trim()}
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
              >
                {busy === "GO" ? "Abriendo votación..." : "Ir al flujo de votación"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
