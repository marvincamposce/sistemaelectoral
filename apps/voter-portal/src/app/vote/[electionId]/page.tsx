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

export default function VotePage({ params }: { params: Promise<{ electionId: string }> }) {
  const resolvedParams = use(params);
  const electionId = resolvedParams.electionId;

  const [step, setStep] = useState<WizardStep>("SETUP");
  const [permitJson, setPermitJson] = useState("");
  const [votingKeys, setVotingKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  
  // Ballot
  const [selection, setSelection] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [ballotHash, setBallotHash] = useState("");
  const [txHash, setTxHash] = useState("");

  const env = getPublicEnv();

  const handleSignup = async () => {
    setErrorMsg("");
    try {
      const permit = JSON.parse(permitJson);
      if (!permit.registryNullifier || !permit.permitSig) throw new Error("Invalid permit JSON");

      // Generate single-use voting keypair
      const wallet = ethers.Wallet.createRandom();
      setVotingKeys({ pub: wallet.publicKey, priv: wallet.privateKey });

      const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/elections/${electionId}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registryNullifier: permit.registryNullifier,
          votingPubKey: wallet.publicKey,
          permitSig: permit.permitSig,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to submit signup");

      setSubId(data.submissionId);
      setStep("SIGNUP_FLIGHT");
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleBallot = async () => {
    setErrorMsg("");
    try {
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
        throw new Error("No se pudo obtener coordinatorPubKey de Evidence API");
      }
      const electionData = (await electionRes.json()) as ElectionPhasesResponse;
      const coordinatorPubKey = electionData.election?.coordinatorPubKey;
      if (typeof coordinatorPubKey !== "string" || coordinatorPubKey.length === 0) {
        throw new Error("coordinatorPubKey ausente para esta elección");
      }

      const ciphertext = encryptBallotPayload(
        {
          electionId,
          selection: selectedCandidate.id,
          candidateId: selectedCandidate.id,
          candidateCode: selectedCandidate.candidateCode,
          candidateLabel: selectedCandidate.displayName,
          timestamp: Date.now(),
        },
        coordinatorPubKey,
      );
      
      // We calculate the hash for the receipt
      const hash = ethers.keccak256(ciphertext);
      setBallotHash(hash);

      const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/elections/${electionId}/ballot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciphertext }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to submit ballot");

      setSubId(data.submissionId);
      setStep("BALLOT_FLIGHT");
    } catch (err: any) {
      setErrorMsg(err.message);
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
            const selectedStillValid = activeCandidates.some((candidate) => candidate.id === selection);
            if (!selectedStillValid) {
              setSelection(activeCandidates[0]!.id);
            }
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setCandidates([]);
          setSelection("");
          setErrorMsg(err?.message ?? "No se pudo cargar el catálogo de candidatos.");
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
    let interval: any;
    if (step === "SIGNUP_FLIGHT" || step === "BALLOT_FLIGHT") {
      interval = setInterval(async () => {
        if (!subId) return;
        try {
          const res = await fetch(`${env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd/submissions/${subId}`);
          const data = await res.json();
          if (data.ok && data.submission.status === "SUCCESS") {
            setTxHash(data.submission.tx_hash);
            if (step === "SIGNUP_FLIGHT") setStep("VOTING");
            if (step === "BALLOT_FLIGHT") {
              try {
                const evRes = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/ballots`);
                if (evRes.ok) {
                  const evData = await evRes.json();
                  const found = evData?.ballots?.find((b: any) => b.txHash === data.submission.tx_hash);
                  if (found) {
                    setStep("RECEIPT");
                  }
                }
              } catch {
                // If it fails to fetch or find, we will just retry next interval
              }
            }
          } else if (data.ok && data.submission.status === "FAILED") {
            setErrorMsg(`Ocurrió un error en el Relayer: ${data.submission.error_message}`);
            if (step === "SIGNUP_FLIGHT") setStep("SETUP");
            if (step === "BALLOT_FLIGHT") setStep("VOTING");
          }
        } catch (e) {
          // ignore network errors until we succeed
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [step, subId]);

  return (
    <main className="space-y-6">
      {errorMsg && (
        <div className="card p-4 border-rose-200 bg-rose-50">
          <p className="text-sm font-medium text-rose-700">{errorMsg}</p>
        </div>
      )}

      {step === "SETUP" && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">1. Identidad del Elector</h2>
            <span className="badge badge-info">Registro</span>
          </div>
          <p className="text-sm text-slate-600">
            Pega aquí el contenido de tu Permit JSON (signup permit) validado por la Autoridad de Registro (REA).
          </p>
          <textarea
            className="w-full h-32 p-3 text-xs font-mono border border-slate-300 bg-white rounded-md"
            placeholder="{ ...permit content... }"
            value={permitJson}
            onChange={(e) => setPermitJson(e.target.value)}
          />
          <button onClick={handleSignup} className="w-full rounded-md bg-indigo-600 py-2 px-4 text-sm font-semibold text-white hover:bg-indigo-700">
            Registrar Intención de Voto
          </button>
        </div>
      )}

      {(step === "SIGNUP_FLIGHT" || step === "BALLOT_FLIGHT") && (
        <div className="card p-6 flex flex-col items-center justify-center space-y-4 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
          <p className="text-sm font-medium text-slate-600">
            {step === "SIGNUP_FLIGHT" ? "Procesando Registro (MRD Relayer)..." : "Procesando Boleta cifrada..."}
          </p>
          <p className="hash-display">Submission ID: {subId}</p>
        </div>
      )}

      {step === "VOTING" && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">2. Emisión de Boleta Cifrada</h2>
            <span className="badge badge-warning">Votación</span>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md break-all">
            <p className="text-xs text-slate-500 font-semibold mb-1">Voting Public Key Generada:</p>
            <p className="text-[10px] font-mono text-slate-700">{votingKeys?.pub}</p>
          </div>
          <div className="space-y-3 pt-4">
            {loadingCandidates && (
              <div className="p-3 text-sm text-slate-600 border border-slate-200 rounded-md bg-slate-50">
                Cargando candidaturas activas...
              </div>
            )}

            {!loadingCandidates && candidates.length === 0 && (
              <div className="p-3 text-sm text-amber-700 border border-amber-200 rounded-md bg-amber-50">
                No hay candidaturas activas para votar en esta elección.
              </div>
            )}

            {!loadingCandidates && candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex items-center space-x-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-indigo-50"
              >
                <input
                  type="radio"
                  name="vote"
                  value={candidate.id}
                  checked={selection === candidate.id}
                  onChange={(e) => setSelection(e.target.value)}
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: candidate.colorHex ?? "#94a3b8" }}
                  aria-hidden
                />
                <span className="text-sm font-medium">
                  {candidate.displayName}
                  {candidate.partyName ? ` · ${candidate.partyName}` : ""}
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={handleBallot}
            disabled={loadingCandidates || candidates.length === 0}
            className="w-full mt-4 rounded-md bg-indigo-600 py-2 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cifrar y Enviar Boleta
          </button>
        </div>
      )}

      {step === "RECEIPT" && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center space-x-2 text-emerald-700 mb-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            <h2 className="text-lg font-semibold">¡Boleta Emitida Exitosamente!</h2>
          </div>
          <p className="text-sm text-slate-600">
            Guarda este recibo. Tu selección ha sido cifrada y tu prueba de inclusión es pública en el Observer Portal.
          </p>
          <div className="space-y-2 pt-4 border-t border-slate-100">
            <div>
              <p className="text-xs text-slate-500 font-semibold">Ballot Hash:</p>
              <p className="text-[10px] font-mono text-slate-800 break-all">{ballotHash}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold">Transaction Hash:</p>
              <p className="text-[10px] font-mono text-slate-800 break-all">{txHash}</p>
            </div>
          </div>
          <div className="pt-4">
            <a href={`${env.NEXT_PUBLIC_EVIDENCE_API_URL.replace("8000", "3011")}`} target="_blank" className="btn-subtle">
              Ir al Tablero Público de Evidencia (Observer Portal)
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
