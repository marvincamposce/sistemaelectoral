"use client";

import { use, useEffect, useState } from "react";
import { ethers } from "ethers";
import { getPublicEnv } from "@/lib/env";

type WizardStep = "SETUP" | "SIGNUP_FLIGHT" | "VOTING" | "BALLOT_FLIGHT" | "RECEIPT";

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
      
      // Mock encryption: In production, fetch coordinatorPubKey from EvidenceAPI and hybrid-encrypt.
      const payload = JSON.stringify({ selection, timestamp: Date.now() });
      const ciphertext = ethers.hexlify(ethers.toUtf8Bytes(payload));
      
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
        <div className="rounded-md bg-red-50 p-4 border border-red-200">
          <p className="text-sm font-medium text-red-800">{errorMsg}</p>
        </div>
      )}

      {step === "SETUP" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">1. Identidad Experimental</h2>
          <p className="text-sm text-neutral-600">Pega aquí el contenido de tu <code>Permit JSON</code> (signup permit) validado por la Autoridad de Registro (REA).</p>
          <textarea
            className="w-full h-32 p-3 text-xs font-mono border rounded-md"
            placeholder="{ ...permit content... }"
            value={permitJson}
            onChange={(e) => setPermitJson(e.target.value)}
          />
          <button onClick={handleSignup} className="w-full rounded-md bg-neutral-900 py-2 px-4 text-sm font-semibold text-white hover:bg-neutral-800">
            Registrar Intención de Voto
          </button>
        </div>
      )}

      {(step === "SIGNUP_FLIGHT" || step === "BALLOT_FLIGHT") && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm flex flex-col items-center justify-center space-y-4 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
          <p className="text-sm font-medium text-neutral-600">
            {step === "SIGNUP_FLIGHT" ? "Procesando Registro (MRD Relayer)..." : "Procesando Boleta cifrada..."}
          </p>
          <p className="text-xs text-neutral-400 font-mono">Submission ID: {subId}</p>
        </div>
      )}

      {step === "VOTING" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">2. Emisión de Boleta Cifrada</h2>
          <div className="p-3 bg-neutral-100 rounded-md break-all">
            <p className="text-xs text-neutral-500 font-semibold mb-1">Voting Public Key Generada:</p>
            <p className="text-[10px] font-mono text-neutral-700">{votingKeys?.pub}</p>
          </div>
          <div className="space-y-3 pt-4">
            <label className="flex items-center space-x-3 p-3 border rounded-md cursor-pointer hover:bg-neutral-50">
              <input type="radio" name="vote" value="CANDIDATO_A" onChange={(e) => setSelection(e.target.value)} />
              <span className="text-sm font-medium">Candidato A</span>
            </label>
            <label className="flex items-center space-x-3 p-3 border rounded-md cursor-pointer hover:bg-neutral-50">
              <input type="radio" name="vote" value="CANDIDATO_B" onChange={(e) => setSelection(e.target.value)} />
              <span className="text-sm font-medium">Candidato B</span>
            </label>
            <label className="flex items-center space-x-3 p-3 border rounded-md cursor-pointer hover:bg-neutral-50">
              <input type="radio" name="vote" value="ABSTENCION" onChange={(e) => setSelection(e.target.value)} />
              <span className="text-sm font-medium">Voto en Blanco (Abstención)</span>
            </label>
          </div>
          <button onClick={handleBallot} className="w-full mt-4 rounded-md bg-neutral-900 py-2 px-4 text-sm font-semibold text-white hover:bg-neutral-800">
            Cifrar y Enviar Boleta
          </button>
        </div>
      )}

      {step === "RECEIPT" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 text-green-700 mb-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            <h2 className="text-lg font-semibold">¡Boleta Emitida Exitosamente!</h2>
          </div>
          <p className="text-sm text-neutral-600">
            Guarda este recibo. Tu selección ha sido cifrada y tu prueba de inclusión es pública en el Observer Portal.
          </p>
          <div className="space-y-2 pt-4 border-t border-neutral-100">
            <div>
              <p className="text-xs text-neutral-500 font-semibold">Ballot Hash:</p>
              <p className="text-[10px] font-mono text-neutral-800 break-all">{ballotHash}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 font-semibold">Transaction Hash:</p>
              <p className="text-[10px] font-mono text-neutral-800 break-all">{txHash}</p>
            </div>
          </div>
          <div className="pt-4">
            <a href={`${env.NEXT_PUBLIC_EVIDENCE_API_URL.replace("8000", "3011")}`} target="_blank" className="text-sm text-blue-600 hover:underline">
              Ir al Tablero Público de Evidencia (Observer Portal)
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
