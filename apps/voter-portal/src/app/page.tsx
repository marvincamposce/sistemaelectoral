"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FilePlus2, KeyRound, Search, ShieldAlert, Vote, Wallet, ChevronRight, ArrowLeft } from "lucide-react";
import { etiquetaCanalSolicitud, etiquetaEstado, etiquetaMetodoBilletera } from "@blockurna/shared";
import { getPublicEnv } from "@/lib/env";
import { ElectionSelector } from "./components/ElectionSelector";
import { IdentityVerification } from "./components/IdentityVerification";

// ... Types copied from original ...
type EnrollmentLookupResponse = {
  ok: boolean; error?: string;
  session?: { sessionId: string; token: string; authMethod: string; expiresAt: string; };
  record?: { dni: string; fullName: string; habilitationStatus: string; statusReason?: string | null; };
  latestRequest?: { requestId: string; status: string; requestedAt: string; reviewedAt?: string | null; } | null;
  walletLink?: { walletAddress: string; verificationMethod: string; } | null;
  authorizations?: Array<{ electionId: string; status: string; authorizedAt: string; }>;
};

type EnrollmentRequestResponse = {
  ok: boolean; error?: string;
  request?: { requestId: string; status: string; requestedAt: string; };
};

type PublicEnrollmentStatusResponse = {
  ok: boolean; error?: string;
  record?: { dni: string; fullName: string; habilitationStatus: string; statusReason?: string | null; } | null;
  latestRequest?: { requestId: string; status: string; requestChannel: string; requestedAt: string; reviewedAt?: string | null; } | null;
  walletProvisioned?: boolean; citizenAccessConfigured?: boolean;
  authorizations?: Array<{ electionId: string; status: string; authorizedAt: string; }>;
};

type ElectionsApiResponse = {
  ok: boolean;
  elections?: Array<{ electionId: string; phaseLabel?: string; manifestHash: string; counts: { signups: number; ballots: number }; }>;
};

const CITIZEN_SESSION_STORAGE_KEY = "bu_citizen_session";

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("es-HN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function statusTone(status: string | undefined): string {
  const value = String(status ?? "").toUpperCase();
  if (value === "AUTHORIZED" || value === "HABILITADO") return "vp-status-success";
  if (value === "REJECTED" || value === "INHABILITADO" || value === "SUSPENDIDO") return "vp-status-error";
  return "vp-status-warning";
}

export default function VoterPortal() {
  const env = getPublicEnv();
  const router = useRouter();

  // Wizard State
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [activeLane, setActiveLane] = useState<"PUBLICO" | "ACCESO" | "SOPORTE">("PUBLICO");
  const [dni, setDni] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [electionId, setElectionId] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [selfRegistrationName, setSelfRegistrationName] = useState("");
  const [selfRegistrationEmail, setSelfRegistrationEmail] = useState("");
  const [selfRegistrationPhone, setSelfRegistrationPhone] = useState("");
  
  // Data State
  const [publicStatus, setPublicStatus] = useState<PublicEnrollmentStatusResponse | null>(null);
  const [lookup, setLookup] = useState<EnrollmentLookupResponse | null>(null);
  const [elections, setElections] = useState<ElectionsApiResponse["elections"]>([]);
  const [loadingElections, setLoadingElections] = useState(true);
  
  // UI State
  const [electionsError, setElectionsError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState<"LOOKUP" | "REQUEST" | "PUBLIC_REQUEST" | "PUBLIC_STATUS" | "GO" | null>(null);

  const normalizedDni = useMemo(() => dni.replace(/\D/g, ""), [dni]);
  const canLookup = normalizedDni.length === 13;
  const selectedElection = useMemo(() => elections?.find((row) => row.electionId === electionId) ?? null, [electionId, elections]);
  const selectedAuthorization = useMemo(() => lookup?.authorizations?.find((row) => row.electionId === electionId && row.status === "AUTHORIZED") ?? null, [lookup, electionId]);

  useEffect(() => {
    let cancelled = false;
    const loadElections = async () => {
      setLoadingElections(true); setElectionsError("");
      try {
        const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections`, { cache: "no-store" });
        const data = (await res.json()) as ElectionsApiResponse;
        if (!res.ok || !data.ok) throw new Error("No se pudo cargar el listado de elecciones.");
        if (cancelled) return;
        const rows = data.elections ?? [];
        setElections(rows);
        setElectionId((current) => (current && rows.some((row) => row.electionId === current) ? current : rows[0]?.electionId ?? current));
      } catch (error: unknown) {
        if (cancelled) return; setElections([]); setElectionsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoadingElections(false);
      }
    };
    void loadElections();
    return () => { cancelled = true; };
  }, [env.NEXT_PUBLIC_EVIDENCE_API_URL]);

  useEffect(() => {
    if (!canLookup || busy !== null || (!publicStatus && !lookup)) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshPublicStatus(normalizedDni).catch(() => null);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [busy, canLookup, lookup, normalizedDni, publicStatus]);

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault(); if (!canLookup) return;
    setBusy("LOOKUP"); setErrorMsg("");
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/auth/session`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni: normalizedDni, accessCode: accessCode.trim() }),
      });
      const data = (await res.json()) as EnrollmentLookupResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo autenticar tu expediente.");
      if (data.session) sessionStorage.setItem(CITIZEN_SESSION_STORAGE_KEY, JSON.stringify({ dni: normalizedDni, token: data.session.token, expiresAt: data.session.expiresAt, authMethod: data.session.authMethod }));
      setLookup(data);
      setStep(3); // Advance to status step on success
    } catch (error: unknown) {
      setLookup(null); setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  }

  async function refreshPublicStatus(dniToQuery: string) {
    const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/public-enrollment-status/${encodeURIComponent(dniToQuery)}`);
    const data = (await res.json()) as PublicEnrollmentStatusResponse;
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo consultar el estado.");
    setPublicStatus(data);
    return data;
  }

  async function handlePublicStatusClick() {
    if (!canLookup) return;
    setBusy("PUBLIC_STATUS"); setErrorMsg("");
    try {
      await refreshPublicStatus(normalizedDni);
      setStep(3); // Advance on success
    } catch (error: unknown) {
      setPublicStatus(null); setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  }

  async function handlePublicEnrollmentRequest(event: React.FormEvent) {
    event.preventDefault(); if (!canLookup) return;
    setBusy("PUBLIC_REQUEST"); setErrorMsg("");
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/public-enrollment-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni: normalizedDni, fullName: selfRegistrationName.trim(), electionId: electionId.trim() || undefined, requestNotes: requestNotes.trim() || undefined, contactEmail: selfRegistrationEmail.trim() || undefined, contactPhone: selfRegistrationPhone.trim() || undefined }),
      });
      const data = (await res.json()) as EnrollmentRequestResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo crear la solicitud.");
      await refreshPublicStatus(normalizedDni);
      setStep(3); // Advance to view status
    } catch (error: unknown) { setErrorMsg(error instanceof Error ? error.message : String(error)); } finally { setBusy(null); }
  }

  function goToVote() {
    if (!electionId.trim() || !selectedAuthorization) return;
    setBusy("GO"); router.push(`/vote/${encodeURIComponent(electionId.trim())}`);
  }

  return (
    <main className="vp-container">
      <div className="vp-glass-panel mb-8 p-8 flex flex-col items-center text-center animate-slide-up">
        <h1 className="vp-title-display">Tu voto, asegurado.</h1>
        <p className="vp-subtitle max-w-2xl">Bienvenido al Portal del Votante. Sigue el proceso guiado para verificar tu habilitación y acceder a la urna de forma segura.</p>
        
        {/* Wizard Progress */}
        <div className="w-full max-w-md mt-8">
          <div className="vp-wizard-nav">
            <div className={`vp-wizard-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>1</div>
            <div className={`vp-wizard-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>2</div>
            <div className={`vp-wizard-step ${step >= 3 ? 'active' : ''}`}>3</div>
          </div>
          <div className="flex justify-between text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider">
            <span>Elección</span>
            <span>Identidad</span>
            <span>Acceso</span>
          </div>
        </div>
      </div>

      <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
        {/* Step 1: Election Selection */}
        {step === 1 && (
          <ElectionSelector
            elections={elections || []}
            loadingElections={loadingElections}
            electionsError={electionsError}
            electionId={electionId}
            setElectionId={setElectionId}
            onContinue={() => setStep(2)}
          />
        )}

        {/* Step 2: Identification */}
        {step === 2 && (
          <IdentityVerification
            activeLane={activeLane}
            setActiveLane={setActiveLane}
            errorMsg={errorMsg}
            setErrorMsg={setErrorMsg}
            handleLookup={handleLookup}
            dni={dni}
            setDni={setDni}
            accessCode={accessCode}
            setAccessCode={setAccessCode}
            canLookup={canLookup}
            busy={busy}
            handlePublicEnrollmentRequest={handlePublicEnrollmentRequest}
            selfRegistrationName={selfRegistrationName}
            setSelfRegistrationName={setSelfRegistrationName}
            selfRegistrationEmail={selfRegistrationEmail}
            setSelfRegistrationEmail={setSelfRegistrationEmail}
            selfRegistrationPhone={selfRegistrationPhone}
            setSelfRegistrationPhone={setSelfRegistrationPhone}
            handlePublicStatusClick={handlePublicStatusClick}
            onBack={() => setStep(1)}
          />
        )}

        {/* Step 3: Status & Action */}
        {step === 3 && (
          <div className="vp-glass-panel p-8">
            <div className="vp-flex-between mb-8">
              <h2 className="vp-title-section m-0">Estado del Expediente</h2>
              <button onClick={() => setStep(2)} className="vp-btn-secondary !p-2 !rounded-full"><ArrowLeft size={18} /></button>
            </div>

            {(!lookup && !publicStatus) ? (
              <div className="text-center py-10 text-[var(--text-tertiary)]">Cargando expediente...</div>
            ) : (
              <div className="vp-grid-2">
                {/* Profile Info */}
                <div className="vp-card flex flex-col justify-center">
                  <div className="text-xs text-[var(--text-tertiary)] uppercase font-bold tracking-wider mb-1">Ciudadano</div>
                  <div className="text-xl font-bold text-[var(--text-primary)]">{lookup?.record?.fullName || publicStatus?.record?.fullName || selfRegistrationName || "Expediente en Proceso"}</div>
                  <div className="font-mono text-sm text-[var(--text-secondary)] mt-1">DNI: {normalizedDni}</div>
                  
                  <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet size={16} className="text-[var(--text-tertiary)]" />
                      <span className="font-semibold text-sm">Estado de Billetera</span>
                    </div>
                    {lookup?.walletLink ? (
                      <span className="vp-status-badge vp-status-success">Provisionada</span>
                    ) : publicStatus?.walletProvisioned ? (
                      <span className="vp-status-badge vp-status-success">Provisionada</span>
                    ) : (
                      <span className="vp-status-badge vp-status-warning">Pendiente de Emisión</span>
                    )}
                  </div>
                </div>

                {/* Authorization Status */}
                <div className="vp-card">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldAlert size={18} className="text-[var(--color-brand-600)]" />
                    <span className="font-bold">Autorización Electoral</span>
                  </div>
                  
                  <div className="p-4 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] mb-6">
                    <div className="vp-flex-between">
                      <span className="font-semibold">Elección #{electionId}</span>
                      <span className={`vp-status-badge ${(lookup?.record?.habilitationStatus === "HABILITADO" || publicStatus?.record?.habilitationStatus === "HABILITADO") ? 'vp-status-success' : 'vp-status-warning'}`}>
                        {etiquetaEstado(lookup?.record?.habilitationStatus ?? publicStatus?.record?.habilitationStatus ?? publicStatus?.latestRequest?.status, "Revisando")}
                      </span>
                    </div>
                    <div className="text-sm text-[var(--text-secondary)] mt-2">
                      {lookup?.record?.statusReason || publicStatus?.record?.statusReason || "El expediente está siendo procesado por la autoridad."}
                    </div>
                  </div>

                  <button 
                    onClick={goToVote} 
                    disabled={!selectedAuthorization || busy !== null} 
                    className="vp-btn-primary w-full h-14"
                  >
                    {busy === "GO" ? "Asegurando conexión..." : selectedAuthorization ? "Ingresar a la Urna" : "Esperando Autorización"}
                  </button>
                  
                  {!selectedAuthorization && (
                    <p className="text-xs text-center text-[var(--text-tertiary)] mt-3">
                      El botón se activará cuando tu expediente esté completamente habilitado y autorizado para esta elección.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
