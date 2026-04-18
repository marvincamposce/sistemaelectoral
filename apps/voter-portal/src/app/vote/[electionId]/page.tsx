"use client";

import { use, useEffect, useState } from "react";
import { ethers } from "ethers";
import { encryptBallotPayload } from "@blockurna/crypto";
import { getPublicEnv } from "@/lib/env";

type WizardStep = "SETUP" | "SIGNUP_FLIGHT" | "VOTING" | "BALLOT_FLIGHT" | "RECEIPT";

type ElectionPhasesResponse = {
  ok: boolean;
  election?: {
    coordinatorPubKey?: string;
  };
};

type Candidate = {
  id: string;
  candidateCode: string;
  displayName: string;
  shortName: string;
  partyName: string;
  ballotOrder: number;
  status: string;
  colorHex: string | null;
};

type CandidatesResponse = {
  ok: boolean;
  candidates?: Candidate[];
};

type RelayerSubmissionResponse = {
  ok: boolean;
  submission?: {
    status: string;
    tx_hash: string;
    error_message?: string;
  };
  error?: string;
};

type SignupsListResponse = {
  signups?: Array<{ txHash: string }>;
};

type BallotsListResponse = {
  ballots?: Array<{ txHash: string }>;
};

type SignupPreparationResponse = {
  ok: boolean;
  error?: string;
  session?: {
    sessionId: string;
    authMethod: string;
    expiresAt: string;
  };
  record?: {
    dni: string;
    fullName: string;
    habilitationStatus: string;
    statusReason?: string | null;
  };
  walletLink?: {
    walletAddress: string;
    verificationMethod: string;
  } | null;
  permit?: {
    registryNullifier: string;
    permitSig: string;
  };
  authorization?: {
    authorizationId: string;
    status: string;
    authorizedAt: string;
  };
};

type CitizenAuthResponse = {
  ok: boolean;
  error?: string;
  session?: {
    sessionId: string;
    token: string;
    authMethod: string;
    expiresAt: string;
  };
};

type CitizenSession = {
  dni: string;
  token: string;
  expiresAt: string;
  authMethod: string;
};

type VoterIdentity = {
  dni: string;
  fullName: string;
  walletAddress: string | null;
  verificationMethod: string | null;
  authMethod: string | null;
};

const CITIZEN_SESSION_STORAGE_KEY = "bu_citizen_session";
const NOTICE_STORAGE_PREFIX = "bu_vote_notice_";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type NoticeState = {
  kind: "ok" | "info";
  title: string;
  body: string;
};

function explicarErrorRelayer(raw: string, flow: "signup" | "ballot"): string {
  const value = String(raw ?? "").toLowerCase();

  if (value.includes("missing revert data") || value.includes("call_exception")) {
    if (flow === "signup") {
      return "La red rechazó la inscripción antes de enviarla. Normalmente esto ocurre porque la elección no existe, no está en registro abierto o el permiso de inscripción ya no es válido.";
    }
    return "La red rechazó la boleta antes de enviarla. Normalmente esto ocurre porque la elección no está en votación abierta o la llave de votación ya no es válida para esta operación.";
  }

  if (value.includes("origin not allowed")) {
    return "El relayer rechazó la solicitud por origen no permitido. Revisa la configuración local del navegador y del relayer.";
  }

  if (value.includes("unauthorized")) {
    return "El relayer rechazó la solicitud por autorización inválida.";
  }

  return raw;
}

export default function VotePage({ params }: { params: Promise<{ electionId: string }> }) {
  const resolvedParams = use(params);
  const electionId = resolvedParams.electionId;

  const [step, setStep] = useState<WizardStep>("SETUP");
  const [dni, setDni] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [voterIdentity, setVoterIdentity] = useState<VoterIdentity | null>(null);
  const [citizenSession, setCitizenSession] = useState<CitizenSession | null>(null);
  const [votingKeys, setVotingKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  
  // Ballot
  const [selection, setSelection] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ballotHash, setBallotHash] = useState("");
  const [txHash, setTxHash] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const env = getPublicEnv();
  const electionIdIsValid = /^[0-9]+$/.test(electionId);
  const stepItems: Array<{ key: WizardStep; label: string }> = [
    { key: "SETUP", label: "Autenticación" },
    { key: "SIGNUP_FLIGHT", label: "Inscripción" },
    { key: "VOTING", label: "Selección" },
    { key: "BALLOT_FLIGHT", label: "Emisión" },
    { key: "RECEIPT", label: "Recibo" },
  ];
  const currentStepIndex = stepItems.findIndex((item) => item.key === step);

  // Recovery
  useEffect(() => {
    const saved = sessionStorage.getItem(`bu_vote_state_${electionId}`);
    const savedNotice = sessionStorage.getItem(`${NOTICE_STORAGE_PREFIX}${electionId}`);
    const storedCitizenSessionRaw = sessionStorage.getItem(CITIZEN_SESSION_STORAGE_KEY);
    if (storedCitizenSessionRaw) {
      try {
        const parsed = JSON.parse(storedCitizenSessionRaw) as CitizenSession;
        if (parsed?.token && parsed?.dni && parsed?.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now()) {
          setCitizenSession(parsed);
          setDni(parsed.dni);
        }
      } catch {
        sessionStorage.removeItem(CITIZEN_SESSION_STORAGE_KEY);
      }
    }
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const recoveredStep = parsed.step as WizardStep | undefined;
        const recoveredKeys = parsed.votingKeys as { pub: string; priv?: string } | null;

        // Bug R2-3: If recovering to a step that requires the private key
        // (VOTING or BALLOT_FLIGHT) but the key was not persisted (per Bug 2.1
        // security fix), gracefully degrade to SETUP instead of letting the
        // user encounter a crash when trying to sign the ballot.
        const needsPrivKey = recoveredStep === "VOTING" || recoveredStep === "BALLOT_FLIGHT";
        if (needsPrivKey && (!recoveredKeys?.priv)) {
          setStep("SETUP");
          if (parsed.dni) setDni(parsed.dni);
          if (parsed.voterIdentity) setVoterIdentity(parsed.voterIdentity);
          setErrorMsg(
            "Tu sesión fue restaurada pero la clave de votación no se pudo recuperar por seguridad. " +
            "Debes volver a registrarte para emitir tu voto."
          );
          return;
        }

        if (recoveredStep) setStep(recoveredStep);
        if (parsed.dni) setDni(parsed.dni);
        if (parsed.voterIdentity) setVoterIdentity(parsed.voterIdentity);
        if (recoveredKeys) setVotingKeys(recoveredKeys as { pub: string; priv: string });
        if (parsed.subId) setSubId(parsed.subId);
        if (parsed.ballotHash) setBallotHash(parsed.ballotHash);
        if (parsed.txHash) setTxHash(parsed.txHash);
        if (parsed.selection) setSelection(parsed.selection);
      } catch (e) {
        console.error("Failed to recover session state", e);
      }
    }
    if (savedNotice) {
      try {
        setNotice(JSON.parse(savedNotice) as NoticeState);
      } catch {
        sessionStorage.removeItem(`${NOTICE_STORAGE_PREFIX}${electionId}`);
      }
    }
  }, [electionId]);

  // Persistence — Bug 2.1 fix: DO NOT persist votingKeys.priv in sessionStorage.
  // Private keys in sessionStorage are vulnerable to XSS exfiltration.
  // Only persist the public address for session recovery; the private key
  // lives solely in React state and is lost on page refresh.
  useEffect(() => {
    if (step === "RECEIPT") {
      sessionStorage.removeItem(`bu_vote_state_${electionId}`);
    } else {
      const safeVotingKeys = votingKeys
        ? { pub: votingKeys.pub }
        : null;
      const state = { step, dni, voterIdentity, votingKeys: safeVotingKeys, subId, ballotHash, txHash, selection };
      sessionStorage.setItem(`bu_vote_state_${electionId}`, JSON.stringify(state));
    }
  }, [step, dni, voterIdentity, votingKeys, subId, ballotHash, txHash, selection, electionId]);

  useEffect(() => {
    const key = `${NOTICE_STORAGE_PREFIX}${electionId}`;
    if (!notice) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(notice));
  }, [notice, electionId]);

  useEffect(() => {
    let cancelled = false;

    if (!electionIdIsValid) {
      setNotice(null);
      setSubId(null);
      setStep("SETUP");
      setRouteError("La ruta de votación es inválida. Debe contener un identificador numérico de elección.");
      return () => {
        cancelled = true;
      };
    }

    const validateElection = async () => {
      try {
        const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/phases`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("La elección solicitada no existe o no está disponible en la API de evidencias.");
        }
        if (!cancelled) setRouteError(null);
      } catch (error: unknown) {
        if (!cancelled) {
          setNotice(null);
          setSubId(null);
          setStep("SETUP");
          setRouteError(getErrorMessage(error));
        }
      }
    };

    void validateElection();
    return () => {
      cancelled = true;
    };
  }, [electionId, electionIdIsValid, env.NEXT_PUBLIC_EVIDENCE_API_URL]);

  const handleSignup = async () => {
    setIsSubmitting(true);
    setErrorMsg("");
    setNotice(null);
    try {
      if (routeError) {
        throw new Error(routeError);
      }
      const normalizedDni = dni.replace(/\D/g, "");
      if (!/^[0-9]{13}$/.test(normalizedDni)) {
        throw new Error("Debes ingresar un DNI hondureño válido de 13 dígitos.");
      }

      let activeSession = citizenSession;
      if (!activeSession || activeSession.dni !== normalizedDni || new Date(activeSession.expiresAt).getTime() <= Date.now()) {
        if (accessCode.trim().length < 6) {
          throw new Error("Debes ingresar tu código de acceso ciudadano.");
        }
        const authRes = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/auth/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dni: normalizedDni,
            accessCode: accessCode.trim(),
          }),
        });
        const authData = (await authRes.json()) as CitizenAuthResponse;
        if (!authRes.ok || !authData.ok || !authData.session) {
          if (authData.error === "invalid_access_code") {
            throw new Error("El código de acceso ciudadano es inválido.");
          }
          if (authData.error === "citizen_access_not_configured") {
            throw new Error("Tu expediente no tiene un código ciudadano configurado.");
          }
          throw new Error(authData.error || "No se pudo abrir una sesión ciudadana.");
        }
        activeSession = {
          dni: normalizedDni,
          token: authData.session.token,
          expiresAt: authData.session.expiresAt,
          authMethod: authData.session.authMethod,
        };
        setCitizenSession(activeSession);
        sessionStorage.setItem(CITIZEN_SESSION_STORAGE_KEY, JSON.stringify(activeSession));
      }

      const bootstrapRes = await fetch(
        `${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn/elections/${electionId}/prepare-signup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeSession.token}`,
          },
          body: JSON.stringify({
            dni: normalizedDni,
          }),
        },
      );

      const bootstrapData = (await bootstrapRes.json()) as SignupPreparationResponse;
      if (!bootstrapRes.ok || !bootstrapData.ok) {
        if (bootstrapData.error === "dni_not_eligible") {
          throw new Error("Este DNI no está habilitado para votar en el censo electoral configurado.");
        }
        if (bootstrapData.error === "voter_not_authorized_for_election") {
          throw new Error("Tu expediente existe, pero todavía no estás autorizado para esta elección.");
        }
        throw new Error(bootstrapData.error || "No se pudo preparar la credencial de votación.");
      }

      if (!bootstrapData.permit?.registryNullifier || !bootstrapData.permit.permitSig) {
        throw new Error("La API de evidencias no devolvió un permiso válido para el signup.");
      }

      const wallet = ethers.Wallet.createRandom();
      const votingPubKey = ethers.SigningKey.computePublicKey(wallet.privateKey, false);
      setVotingKeys({ pub: votingPubKey, priv: wallet.privateKey });
      setVoterIdentity({
        dni: normalizedDni,
        fullName: bootstrapData.record?.fullName ?? "Votante registrado",
        walletAddress: bootstrapData.walletLink?.walletAddress ?? null,
        verificationMethod: bootstrapData.walletLink?.verificationMethod ?? null,
        authMethod: activeSession.authMethod ?? bootstrapData.authorization?.status ?? null,
      });

      const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/elections/${electionId}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registryNullifier: bootstrapData.permit.registryNullifier,
          votingPubKey,
          permitSig: bootstrapData.permit.permitSig,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo enviar la inscripción.");

      setSubId(data.submissionId);
      setNotice({
        kind: "info",
        title: "Inscripción enviada",
        body: "La identidad ya fue enviada al relayer. Ahora estamos esperando confirmación en la red y en la indexación pública.",
      });
      setStep("SIGNUP_FLIGHT");
    } catch (err: unknown) {
      setNotice(null);
      setErrorMsg(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBallot = async () => {
    setIsSubmitting(true);
    setErrorMsg("");
    setNotice(null);
    try {
      if (routeError) {
        throw new Error(routeError);
      }
      if (!votingKeys?.pub || !votingKeys?.priv) {
        throw new Error("No existe una llave de votación registrada para esta sesión.");
      }
      if (!selection) throw new Error("Debes seleccionar una opción.");

      const selectedCandidate = candidates.find((c) => c.id === selection);
      if (!selectedCandidate) {
        throw new Error("La candidatura seleccionada no es válida en el catálogo actual.");
      }

      const electionRes = await fetch(
        `${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/phases`,
        { cache: "no-store" },
      );
      if (!electionRes.ok) {
        throw new Error("No se pudo obtener la clave pública del coordinador desde la API de evidencias.");
      }
      const electionData = (await electionRes.json()) as ElectionPhasesResponse;
      const coordinatorPubKey = electionData.election?.coordinatorPubKey;
      if (typeof coordinatorPubKey !== "string" || coordinatorPubKey.length === 0) {
        throw new Error("La clave pública del coordinador no está disponible para esta elección.");
      }

      // Bug 2.4 fix: Use positional index in the sorted candidates array, not ballotOrder - 1.
      // ballotOrder may be non-sequential (e.g. [1, 3, 5]), which would produce non-contiguous
      // indices that break ZK circuit expectations requiring [0, 1, 2, ...].
      const activeCandidatesSorted = candidates
        .filter((c: any) => String(c.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
        .sort((a: any, b: any) => Number(a.ballotOrder) - Number(b.ballotOrder));
      const selectionIndex = activeCandidatesSorted.findIndex((c: any) => c.id === selectedCandidate.id);
      if (selectionIndex < 0) {
        throw new Error("No se pudo calcular un índice de selección válido para la boleta.");
      }

      const ciphertext = await encryptBallotPayload(
        {
          electionId,
          selection: selectedCandidate.id,
          selectionIndex,
          candidateId: selectedCandidate.id,
          candidateCode: selectedCandidate.candidateCode,
          candidateLabel: selectedCandidate.displayName,
          timestamp: Date.now(),
        },
        coordinatorPubKey,
        { scheme: "ZK_FRIENDLY_V2" },
      );
      
      // Calcula la huella criptográfica de la boleta para el comprobante.
      const hash = ethers.keccak256(ciphertext);
      setBallotHash(hash);

      const ballotDigest = ethers.keccak256(
        ethers.solidityPacked(
          ["string", "uint256", "bytes32"],
          ["BU-PVP-1:ballot", BigInt(electionId), hash],
        ),
      );
      const votingWallet = new ethers.Wallet(votingKeys.priv);
      const ballotSig = await votingWallet.signMessage(ethers.getBytes(ballotDigest));

      const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/elections/${electionId}/ballot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          votingPubKey: votingKeys.pub,
          ciphertext,
          ballotSig,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo enviar la boleta.");

      setSubId(data.submissionId);
      setNotice({
        kind: "info",
        title: "Boleta cifrada enviada",
        body: "La boleta ya salió hacia la red. El sistema confirmará primero la transacción y luego su aparición en la evidencia pública.",
      });
      setStep("BALLOT_FLIGHT");
    } catch (err: unknown) {
      setNotice(null);
      setErrorMsg(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (step !== "VOTING") {
      return () => {
        cancelled = true;
      };
    }

    const loadCandidates = async () => {
      setLoadingCandidates(true);
      try {
        const res = await fetch(
          `${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/candidates`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as CandidatesResponse;
        if (!res.ok || !data.ok) {
          throw new Error("No se pudo cargar el catálogo de candidatos.");
        }

        const activeCandidates = (data.candidates ?? [])
          .filter((candidate) => String(candidate.status).toUpperCase() === "ACTIVE")
          .sort((a, b) => a.ballotOrder - b.ballotOrder);

        if (!cancelled) {
          setCandidates(activeCandidates);
          if (activeCandidates.length === 0) {
            setSelection("");
            setErrorMsg("No hay candidaturas activas disponibles para esta elección.");
          } else {
            setErrorMsg("");
            setSelection((prev) =>
              activeCandidates.some((candidate) => candidate.id === prev)
                ? prev
                : activeCandidates[0]!.id,
            );
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setCandidates([]);
          setSelection("");
          setErrorMsg(getErrorMessage(err) || "No se pudo cargar el catálogo de candidatos.");
        }
      } finally {
        if (!cancelled) {
          setLoadingCandidates(false);
        }
      }
    };

    loadCandidates();

    return () => {
      cancelled = true;
    };
  }, [step, electionId, env.NEXT_PUBLIC_EVIDENCE_API_URL]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (step === "SIGNUP_FLIGHT" || step === "BALLOT_FLIGHT") {
      // Bug 2.3 fix: Add a 2-minute timeout to prevent infinite polling.
      // If the relayer/indexer fails permanently, the user gets a clear error
      // instead of being trapped in a spinner forever.
      const POLLING_TIMEOUT_MS = 120_000;
      timeout = setTimeout(() => {
        clearInterval(interval);
        setErrorMsg(
          "La operación está tardando más de lo esperado. " +
          "Es posible que tu transacción ya se haya procesado — verifica en el portal de observación. " +
          "Si el problema persiste, contacta al soporte."
        );
        setNotice(null);
        if (step === "SIGNUP_FLIGHT") setStep("SETUP");
        if (step === "BALLOT_FLIGHT") setStep("VOTING");
      }, POLLING_TIMEOUT_MS);

      interval = setInterval(async () => {
        if (!subId) return;
        try {
          const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/submissions/${subId}`);
          const data = (await res.json()) as RelayerSubmissionResponse;
          if (data.ok && data.submission?.status === "SUCCESS") {
            const relayerTxHash = String(data.submission.tx_hash).toLowerCase();
            setTxHash(data.submission.tx_hash);

            if (step === "SIGNUP_FLIGHT") {
              // Wait for indexer to see the signup
              try {
                const evRes = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/signups`);
                if (evRes.ok) {
                  const evData = (await evRes.json()) as SignupsListResponse;
                  const found = evData.signups?.find((s) => String(s.txHash).toLowerCase() === relayerTxHash);
                  if (found) {
                    setNotice({
                      kind: "ok",
                      title: "Inscripción confirmada",
                      body: "Tu identidad electoral ya quedó registrada y validada. Ahora puedes pasar a la selección de candidatura.",
                    });
                    setStep("VOTING");
                  }
                }
              } catch {
                // Ignore and retry
              }
            }
            if (step === "BALLOT_FLIGHT") {
              // Wait for indexer to see the ballot
              try {
                const evRes = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/ballots`);
                if (evRes.ok) {
                  const evData = (await evRes.json()) as BallotsListResponse;
                  const found = evData.ballots?.find((b) => String(b.txHash).toLowerCase() === relayerTxHash);
                  if (found) {
                    setNotice({
                      kind: "ok",
                      title: "Boleta confirmada",
                      body: "La boleta cifrada ya quedó publicada y observada. Puedes conservar este recibo como comprobante de emisión.",
                    });
                    setStep("RECEIPT");
                  }
                }
              } catch {
                // Ignore and retry
              }
            }
          } else if (data.ok && data.submission?.status === "FAILED") {
            setNotice(null);
            setErrorMsg(
              explicarErrorRelayer(
                data.submission.error_message || "El relayer rechazó la operación.",
                step === "SIGNUP_FLIGHT" ? "signup" : "ballot",
              ),
            );
            if (step === "SIGNUP_FLIGHT") setStep("SETUP");
            if (step === "BALLOT_FLIGHT") setStep("VOTING");
          }
        } catch {
          // ignore network errors until we succeed
        }
      }, 3000);
    }
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [step, subId, electionId, env.NEXT_PUBLIC_EVIDENCE_API_URL, env.NEXT_PUBLIC_MRD_API_URL]);

  return (
    <main className="space-y-6">
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
              {routeError ? "Elección no disponible" : `Elección #${electionId}`}
            </div>
            <h2 className="text-xl font-bold text-slate-900">Flujo guiado de voto</h2>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            Estado actual: {stepItems[currentStepIndex]?.label ?? step}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          {stepItems.map((item, index) => {
            const active = index === currentStepIndex;
            const done = index < currentStepIndex;
            return (
              <div
                key={item.key}
                className={`rounded-2xl border px-3 py-3 ${
                  active
                    ? "border-indigo-300 bg-indigo-50"
                    : done
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${active ? "text-indigo-700" : done ? "text-emerald-700" : "text-slate-500"}`}>
                  {done ? "Completo" : active ? "En curso" : "Pendiente"}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{item.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {routeError && (
        <div className="card p-4 border-amber-200 bg-amber-50 flex items-start gap-3 shadow-sm">
          <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-amber-900">Ruta de elección inválida o no disponible</h3>
            <p className="text-sm text-amber-800 mt-1">{routeError}</p>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`card p-4 flex items-start gap-3 shadow-sm ${
            notice.kind === "ok"
              ? "border-emerald-200 bg-emerald-50"
              : "border-indigo-200 bg-indigo-50"
          }`}
        >
          <div
            className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
              notice.kind === "ok" ? "bg-emerald-500" : "bg-indigo-500"
            }`}
          />
          <div className="flex-1">
            <h3 className={`text-sm font-bold ${notice.kind === "ok" ? "text-emerald-900" : "text-indigo-900"}`}>
              {notice.title}
            </h3>
            <p className={`mt-1 text-sm ${notice.kind === "ok" ? "text-emerald-800" : "text-indigo-900"}`}>
              {notice.body}
            </p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="card p-4 border-rose-200 bg-rose-50 flex items-start gap-3 shadow-sm">
          <svg className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-rose-800">Se detectó un problema técnico</h3>
            <p className="text-sm text-rose-700 mt-1">{errorMsg}</p>
          </div>
        </div>
      )}

      {step === "SETUP" && (
        <div className="card overflow-hidden border-slate-200 shadow-md">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 flex items-center justify-center rounded-full text-xs">1</span>
              Acceso ciudadano
            </h2>
            <span className="badge badge-info bg-indigo-100 text-indigo-800 uppercase tracking-wider text-[10px] font-bold">DNI + autorización</span>
          </div>
          <div className="p-6 space-y-5">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-slate-800 font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Identidad y elegibilidad Honduras
              </p>
              <p className="text-xs text-slate-600">
                Ingresa tu DNI. El sistema comprobará tu expediente, validará si estás autorizado para esta elección y emitirá el permiso REA automáticamente.
              </p>
            </div>
            <div className="grid gap-4">
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-400"
                placeholder="DNI hondureño"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
              />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-400"
                placeholder="Código de acceso ciudadano"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
              />
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
              La API de evidencias valida tu sesión ciudadana, comprueba que tu expediente esté autorizado para esta elección y emite el `SignupPermit` sin archivos manuales.
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">DNI</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{dni || "Pendiente"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Sesión</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{citizenSession ? "Activa" : "No abierta"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Permiso</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">REA automática</div>
              </div>
            </div>
            <button 
              onClick={handleSignup} 
              disabled={Boolean(routeError) || isSubmitting || !dni.trim() || ((!citizenSession || citizenSession.dni !== dni.replace(/\D/g, "")) && accessCode.trim().length < 6)}
              className="w-full rounded-xl bg-indigo-600 py-3.5 px-4 text-sm font-extrabold tracking-wide uppercase text-white hover:bg-indigo-700 hover:shadow-lg transition-all focus:ring-4 focus:ring-indigo-100 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Preparando credencial...
                </>
              ) : (
                <>
                  Validar e iniciar inscripción
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {(step === "SIGNUP_FLIGHT" || step === "BALLOT_FLIGHT") && (
        <div className="card p-10 flex flex-col items-center justify-center space-y-6 shadow-md border-indigo-100">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-100 rounded-full blur-xl animate-pulse" />
            <div className="relative h-14 w-14 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-bold text-slate-800">
              {step === "SIGNUP_FLIGHT" ? "Registrando identidad en cadena..." : "Enviando boleta cifrada a la red..."}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
              Por favor espera un momento. Estamos validando firmas y confirmando la operación en la red.
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg break-all text-center max-w-sm">
             <p className="text-[10px] text-slate-400 font-bold uppercase mb-1 tracking-wider">Identificador Criptográfico</p>
             <p className="text-xs font-mono text-slate-700">{subId}</p>
          </div>
        </div>
      )}

      {step === "VOTING" && (
        <div className="card overflow-hidden shadow-lg border-indigo-100">
          <div className="bg-indigo-600 px-6 py-5 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span className="bg-white text-indigo-700 w-6 h-6 flex items-center justify-center rounded-full text-xs shadow-sm">2</span>
              Boleta Presidencial Oficial
            </h2>
            <span className="bg-indigo-800 text-indigo-100 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border border-indigo-500">
              Cifrado: BabyJub / ElGamal
            </span>
          </div>
          
          <div className="p-6 space-y-6">
            {voterIdentity ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-semibold">{voterIdentity.fullName}</div>
                <div className="mt-1 text-xs">
                  DNI {voterIdentity.dni} · wallet embebida {voterIdentity.walletAddress ?? "no visible"} · acceso {voterIdentity.authMethod ?? "NO_DECLARADO"}
                </div>
              </div>
            ) : null}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                Llave Pública de Emisión (Anónima)
              </div>
              <p className="text-[11px] font-mono text-slate-500 bg-white border border-slate-200 px-3 py-2 rounded-md break-all">
                {votingKeys?.pub}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Expediente</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{voterIdentity?.fullName ?? "No resuelto"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Wallet</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{voterIdentity?.walletAddress ? "Provisionada" : "No visible"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Opciones activas</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{candidates.length}</div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2">Catálogo Activo</h3>
              
              {loadingCandidates && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 mr-3" />
                  <span className="text-sm font-medium text-slate-600">Sincronizando estado de la elección...</span>
                </div>
              )}

              {!loadingCandidates && candidates.length === 0 && (
                <div className="p-4 text-sm text-amber-800 border border-amber-200 rounded-xl bg-amber-50 text-center font-medium">
                  El contrato no reporta candidaturas activas. Solicite asistencia técnica.
                </div>
              )}

              {!loadingCandidates && candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-all ${
                    selection === candidate.id 
                      ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 shadow-sm" 
                      : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="radio"
                        name="vote"
                        value={candidate.id}
                        checked={selection === candidate.id}
                        onChange={(e) => setSelection(e.target.value)}
                        className="w-5 h-5 text-indigo-600 bg-slate-100 border-slate-300 focus:ring-indigo-500 focus:ring-2 transition-all cursor-pointer"
                      />
                    </div>
                    <div 
                      className="w-10 h-10 rounded-full flex-shrink-0 shadow-sm border border-slate-100 flex items-center justify-center text-white"
                      style={{ backgroundColor: candidate.colorHex ?? "#94a3b8" }}
                    />
                    <div className="flex flex-col">
                      <span className="text-base font-bold text-slate-900">{candidate.displayName}</span>
                      <span className="text-xs font-semibold text-slate-500">{candidate.partyName || "Candidatura Independiente"}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="pt-2">
              <button
                onClick={handleBallot}
                disabled={loadingCandidates || candidates.length === 0 || !selection || isSubmitting}
                className="w-full rounded-xl bg-slate-900 py-4 px-4 text-sm font-extrabold tracking-widest uppercase text-white hover:bg-black transition-all shadow-md focus:ring-4 focus:ring-slate-300 disabled:bg-slate-400 disabled:cursor-not-allowed group flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                   <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                ) : (
                  <svg className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                )}
                {isSubmitting ? "Enviando voto cifrado..." : "Emitir boleta cifrada"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "RECEIPT" && (
        <div className="card overflow-hidden shadow-xl border-emerald-100">
          <div className="bg-emerald-50 border-b border-emerald-100 p-8 text-center space-y-3">
             <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4 ring-8 ring-emerald-50">
               <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
             </div>
             <h2 className="text-2xl font-black text-emerald-900">Voto registrado con éxito</h2>
             <p className="text-sm text-emerald-600 font-medium max-w-sm mx-auto">
               Tu boleta quedó anclada criptográficamente. Es anónima y verificable de forma pública.
             </p>
          </div>
          
          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  Huella criptográfica de boleta (hash)
                </p>
                <p className="text-[11px] font-mono text-slate-800 break-all bg-white px-3 py-2 border border-slate-100 rounded-md">
                  {ballotHash}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  Transacción en cadena (on-chain)
                </p>
                <p className="text-[11px] font-mono text-slate-800 break-all bg-white px-3 py-2 border border-slate-100 rounded-md">
                  {txHash}
                </p>
              </div>
            </div>
            <a 
              href={`${env.NEXT_PUBLIC_OBSERVER_PORTAL_URL}`} 
              target="_blank" 
              className="w-full flex justify-center items-center gap-2 bg-slate-100 text-slate-700 py-4 px-4 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-slate-200 hover:text-slate-900 transition-all border border-slate-200"
            >
              Abrir portal de observación
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
