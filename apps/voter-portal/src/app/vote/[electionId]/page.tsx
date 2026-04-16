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

      const selectionIndex = Number(selectedCandidate.ballotOrder) - 1;
      if (!Number.isInteger(selectionIndex) || selectionIndex < 0) {
        throw new Error("No se pudo derivar selectionIndex válido para la boleta");
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
              Acreditación de Identidad
            </h2>
            <span className="badge badge-info bg-indigo-100 text-indigo-800 uppercase tracking-wider text-[10px] font-bold">Validación Criptográfica</span>
          </div>
          <div className="p-6 space-y-5">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-slate-800 font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Permit de Autoridad de Registro (REA)
              </p>
              <p className="text-xs text-slate-600">
                Pega el hash criptográfico JSON expedido por la institución para iniciar sesión. Este documento contiene la firma ECDSA que legitima tu derecho a voto garantizando máxima privacidad mediante zk-SNARKs.
              </p>
            </div>
            <textarea
              className="w-full h-40 p-4 text-xs font-mono border border-slate-300 bg-slate-800 text-emerald-400 rounded-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
              placeholder='{ "permitVersion": "1", ... }'
              value={permitJson}
              onChange={(e) => setPermitJson(e.target.value)}
            />
            <button 
              onClick={handleSignup} 
              className="w-full rounded-xl bg-indigo-600 py-3.5 px-4 text-sm font-extrabold tracking-wide uppercase text-white hover:bg-indigo-700 hover:shadow-lg transition-all focus:ring-4 focus:ring-indigo-100 flex items-center justify-center gap-2"
            >
              Auditar Permiso y Autenticarse
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
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
              {step === "SIGNUP_FLIGHT" ? "Aprobando Identidad en Cadena..." : "Cifrando Boleta y Escribiendo Block..."}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
              Por favor aguarda, la capa de seguridad criptográfica está verificando firmas digitales y emitiendo el paquete (Relayer).
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
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                Llave Pública de Emisión (Anónima)
              </div>
              <p className="text-[11px] font-mono text-slate-500 bg-white border border-slate-200 px-3 py-2 rounded-md break-all">
                {votingKeys?.pub}
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2">Catálogo Activo</h3>
              
              {loadingCandidates && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 mr-3" />
                  <span className="text-sm font-medium text-slate-600">Sincronizando Estado Global...</span>
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
                disabled={loadingCandidates || candidates.length === 0}
                className="w-full rounded-xl bg-slate-900 py-4 px-4 text-sm font-extrabold tracking-widest uppercase text-white hover:bg-black transition-all shadow-md focus:ring-4 focus:ring-slate-300 disabled:bg-slate-400 disabled:cursor-not-allowed group flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                Cifrar Boleta y Emitir
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
             <h2 className="text-2xl font-black text-emerald-900">Misión Completada</h2>
             <p className="text-sm text-emerald-600 font-medium max-w-sm mx-auto">
               Tu voto se encuentra anclado criptográficamente. Es anónimo y permanentemente verificable por ti y por el mundo.
             </p>
          </div>
          
          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  Identificador ZK (Ballot Hash)
                </p>
                <p className="text-[11px] font-mono text-slate-800 break-all bg-white px-3 py-2 border border-slate-100 rounded-md">
                  {ballotHash}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  On-Chain Transaction
                </p>
                <p className="text-[11px] font-mono text-slate-800 break-all bg-white px-3 py-2 border border-slate-100 rounded-md">
                  {txHash}
                </p>
              </div>
            </div>
            <a 
              href={`${env.NEXT_PUBLIC_EVIDENCE_API_URL.replace("8000", "3011")}`} 
              target="_blank" 
              className="w-full flex justify-center items-center gap-2 bg-slate-100 text-slate-700 py-4 px-4 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-slate-200 hover:text-slate-900 transition-all border border-slate-200"
            >
              Consultar Observer Portal
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
