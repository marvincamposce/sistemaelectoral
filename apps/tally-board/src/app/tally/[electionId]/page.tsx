"use client";

import { use, useState, useEffect } from "react";
import { ethers } from "ethers";
import { 
  publishProofAction, 
  publishActaWithContentAction, 
  advanceToResultsPublishedAction,
  createProcessingBatchAction,
  updateProcessingBatchStatusAction,
  createTallyJobAction,
  updateTallyJobStatusAction,
  logIncidentAction,
  createResultPayloadAction,
  openAuditWindowAction,
  persistAuditBundleAction
} from "../../actions";

// Recreate public env inline for simplicity
function getClientEnv() {
  return {
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000"
  };
}

type TallyStatus = "IDLE" | "FETCHING_CIPHERTEXTS" | "SIMULATING_ZK" | "PUBLISHING_STUB" | "PUBLISHING_ACTA" | "DONE";

export default function TallyPage({ params }: { params: Promise<{ electionId: string }> }) {
  const resolvedParams = use(params);
  const electionId = resolvedParams.electionId;

  const [status, setStatus] = useState<TallyStatus>("IDLE");
  const [ballots, setBallots] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  const addLog = (msg: string) => setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleStartTally = async () => {
    try {
      setErrorMsg("");
      setLogs([]);
      setStatus("FETCHING_CIPHERTEXTS");
      addLog("Descargando boletas encriptadas desde TPE...");
      
      const env = getClientEnv();
      const res = await fetch(`${env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections/${electionId}/ballots`);
      if (!res.ok) throw new Error("Fallo al descargar boletas de la Evidence API");
      
      const data = await res.json();
      const ciphertexts = data.ballots.map((b: any) => b.ciphertext);
      setBallots(ciphertexts);
      addLog(`Se obtuvieron ${ciphertexts.length} cifrados listos para procesar.`);
      const pointer = [{ source: "ballots", count: ciphertexts.length }];
      if (ciphertexts.length === 0) {
        await logIncidentAction(electionId, "TALLY_NO_BALLOTS", "TALLY_ERROR", "Attempted to run processing batch without published ballots.", "CRITICAL", pointer);
        throw new Error("No hay boletas (input_count=0). Abortando. Incidente registrado.");
      }

      const inputBuffer = Buffer.from(ciphertexts.join(","));
      const derivedRoot = ethers.keccak256(inputBuffer);
      addLog(`Root hash (Merkle Stub) derivado desde los ciphertexts indexados: ${derivedRoot}`);

      addLog("Creando Processing Batch en base de datos...");
      const batchRes = await createProcessingBatchAction(electionId, ciphertexts.length, derivedRoot);
      if (!batchRes.ok) throw new Error(`Error creando batch: ${batchRes.error}`);
      const batchId = batchRes.batchId;
      addLog(`Batch creado. ID: ${batchId}`);

      await updateProcessingBatchStatusAction(batchId!, "RUNNING");
      
      // Simulating processing batch (decryption/mix)
      addLog("Procesando Batch (Mixnet simulación)...");
      await new Promise(r => setTimeout(r, 2000));
      await updateProcessingBatchStatusAction(batchId!, "COMPLETED");
      addLog("Batch procesado y completado.");

      addLog("Creando Tally Job en base de datos...");
      const jobRes = await createTallyJobAction(electionId, batchId!);
      if (!jobRes.ok) throw new Error(`Error creando tally job: ${jobRes.error}`);
      const jobId = jobRes.jobId;
      addLog(`Tally Job creado. ID: ${jobId}`);

      setStatus("SIMULATING_ZK");
      addLog("Generando Proof Experimental... (Esto es un Stub temporal. Mixnet/ZKP está pendiente para Fase 6 avanzada)");
      await new Promise(r => setTimeout(r, 2000));
      
      const pseudoRandomBlock = ethers.hexlify(ethers.randomBytes(32));
      const proofPayload = ethers.solidityPacked(
        ["string", "bytes32", "uint256"], 
        ["BU-PVP-1:TALLY_STUB", pseudoRandomBlock, ciphertexts.length]
      );
      
      setStatus("PUBLISHING_STUB");
      addLog(`Enviando Proof Stub On-Chain...`);
      const proofResult = await publishProofAction(electionId, proofPayload);
      if (!proofResult.ok) throw new Error(`Fallo publicando proof: ${proofResult.error}`);
      addLog(`Proof publicado on-chain. Tx: ${proofResult.txHash}`);

      await updateTallyJobStatusAction(jobId!, "COMPLETED", "SIMULATED", proofResult.txHash!);
      setLastJobId(jobId!);

      setStatus("PUBLISHING_ACTA");
      addLog("Generando ACTA_ESCRUTINIO firmada y anclando hash en la blockchain...");
      
      const actaJson = {
        kind: "ACTA_ESCRUTINIO",
        electionId,
        mockResults: true,
        note: "EXPERIMENTAL TALLY STUB — resultSummary es estático, no proviene de descifrado real",
        totalProcessed: ciphertexts.length,
        proofPayload: proofPayload,
        timestamp: new Date().toISOString()
      };
      
      // kind=2 = ACTA_ESCRUTINIO in Solidity enum
      const actaResult = await publishActaWithContentAction(electionId, actaJson, 2);
      if (!actaResult.ok) throw new Error(`Fallo anclando acta: ${actaResult.error}`);
      addLog(`ACTA_ESCRUTINIO anclada On-chain. Tx: ${actaResult.txHash} | actId: ${actaResult.actId}`);

      addLog("Notificando Contrato para transicionar de TALLYING -> RESULTS_PUBLISHED ...");
      const resultsResult = await advanceToResultsPublishedAction(electionId);
      if (!resultsResult.ok) throw new Error(`Fallo cambiando fase a published: ${resultsResult.error}`);
      addLog(`Fase Results Published activada. Tx: ${resultsResult.txHash}`);

      setStatus("DONE");
      addLog("Escrutinio completado íntegramente de forma experimental.");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      setStatus("IDLE");
    }
  };

  const handlePublishResults = async () => {
    try {
      setErrorMsg("");
      const jobId = lastJobId ?? "unknown-job";
      addLog(`Generando Result Payload (basado en tallyJobId: ${jobId})...`);
      const resultJson = {
        electionId,
        tallyJobId: jobId,
        proofState: "SIMULATED",
        ballotsCount: ballots.length,
        batchesCount: 1,
        resultMode: "SIMULATED",
        summary: {
          "Opcion A": 10,
          "Opcion B": 5
        },
        honesty: {
          note: "El resultSummary es ESTÁTICO y no proviene de descifrado real de los ciphertexts.",
          whatIsReal: "Anchorajes on-chain, hashes, conteos de boletas, processing batches",
          whatIsSimulated: "Descifrado, resultSummary, ZK proof"
        },
        publicationTimestamp: new Date().toISOString(),
      };

      const payloadRes = await createResultPayloadAction(electionId, jobId, resultJson);
      if (!payloadRes.ok) throw new Error(`Fallo guardando payload: ${payloadRes.error}`);
      addLog(`Result Payload publicado. Hash: ${payloadRes.payloadHash}`);

      addLog("Generando ACTA_RESULTADOS (kind=3) y anclando on-chain...");
      const actaJson = {
        kind: "ACTA_RESULTADOS",
        electionId,
        mockResults: true,
        note: "EXPERIMENTAL RESULTS — resultSummary es estático",
        payloadHash: payloadRes.payloadHash,
        timestamp: new Date().toISOString()
      };
      // kind=3 = ACTA_RESULTADOS in Solidity enum
      const actaResult = await publishActaWithContentAction(electionId, actaJson, 3);
      if (!actaResult.ok) throw new Error(`Fallo anclando acta de resultados: ${actaResult.error}`);
      addLog(`ACTA_RESULTADOS anclada On-chain. Tx: ${actaResult.txHash} | actId: ${actaResult.actId}`);

      addLog("Abriendo Ventana de Auditoría...");
      const auditRes = await openAuditWindowAction(electionId);
      if (!auditRes.ok) throw new Error(`Fallo abriendo auditoría: ${auditRes.error}`);
      addLog("Ventana de Auditoría ABIERTA.");

      addLog("Materializando Audit Bundle...");
      const bundleRes = await persistAuditBundleAction(electionId);
      if (!bundleRes.ok) throw new Error(`Fallo materializando bundle: ${bundleRes.error}`);
      addLog(`Audit Bundle materializado. bundleHash: ${bundleRes.bundleHash}`);
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  };

  return (
    <main className="space-y-6">
      <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-yellow-500 mb-2">Advertencia Oficial JED</h2>
        <p className="text-sm text-yellow-100">
          Esta consola abstracta opera sobre un marco Cero-Conocimiento experimental temporal (Proof Stub). 
          La prueba matemática publicada generará un hash pseudoaleatorio que documenta el progreso on-chain y abre Phase 7, 
          pero no ejecuta Verificadores de Curva Elíptica rigurosos.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Consola de Escrutinio Ciego</h2>
          <span className="text-xs font-mono text-neutral-400">Elección #{electionId}</span>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded bg-red-900/50 border border-red-800 p-4">
            <span className="text-red-300 text-sm font-semibold">{errorMsg}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col space-y-4">
          <button 
            disabled={status !== "IDLE"}
            onClick={handleStartTally}
            className={`px-4 py-3 rounded-md font-bold text-sm tracking-wide ${
              status === "IDLE" 
              ? "bg-blue-600 hover:bg-blue-500 text-white" 
              : "bg-neutral-700 text-neutral-400 cursor-not-allowed"
            }`}
          >
            {status === "IDLE" ? "INICIAR PROCESAMIENTO TALLY (Batch Job)" : "EJECUTANDO..."}
          </button>
          {status === "DONE" && (
            <button 
              onClick={handlePublishResults}
              className={`px-4 py-3 rounded-md font-bold text-sm tracking-wide bg-purple-600 hover:bg-purple-500 text-white mt-4`}
            >
              PUBLICAR RESULTADOS EXPERIMENTALES Y ABRIR AUDITORÍA
            </button>
          )}
        </div>

        {logs.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-neutral-400 mb-2">Bitácora de Operaciones Tally</h3>
            <div className="bg-neutral-950 border border-neutral-700 rounded-md p-4 space-y-1 h-64 overflow-y-auto">
              {logs.map((L, i) => (
                <div key={i} className="text-xs font-mono text-green-400">{L}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
