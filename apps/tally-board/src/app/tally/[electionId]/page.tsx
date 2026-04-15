"use client";

import { use, useState, useEffect } from "react";
import { ethers } from "ethers";
import { 
  computeRealTallyAction,
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

type RealTallyComputation = {
  summary: Record<string, number>;
  validCount: number;
  invalidCount: number;
  ballotsCount: number;
  merkleRoot: string;
  transcriptHash: string;
  transcript: unknown;
  proofPayload: string;
  proofTxHash: string;
};

export default function TallyPage({ params }: { params: Promise<{ electionId: string }> }) {
  const resolvedParams = use(params);
  const electionId = resolvedParams.electionId;

  const [status, setStatus] = useState<TallyStatus>("IDLE");
  const [ballots, setBallots] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [tallyComputation, setTallyComputation] = useState<RealTallyComputation | null>(null);

  const addLog = (msg: string) => setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleStartTally = async () => {
    try {
      setErrorMsg("");
      setLogs([]);
      setTallyComputation(null);
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

      setStatus("SIMULATING_ZK");
      addLog("Descifrando boletas y calculando resumen real...");
      const tallyRes = await computeRealTallyAction(electionId, ciphertexts);
      if (!tallyRes.ok) {
        await logIncidentAction(
          electionId,
          `TALLY_DECRYPTION_FAILED:${new Date().toISOString()}`,
          "TALLY_DECRYPTION_FAILED",
          `Fallo en descifrado/conteo real: ${tallyRes.error ?? "unknown"}`,
          "CRITICAL",
          [{ source: "ballots", count: ciphertexts.length }],
        );
        throw new Error(tallyRes.error ?? "Error en descifrado real");
      }

      const tallyData = tallyRes as {
        ok: true;
        summary: Record<string, number>;
        validCount: number;
        invalidCount: number;
        ballotsCount: number;
        merkleRoot: string;
        transcript: unknown;
        transcriptHash: string;
      };

      const derivedRoot = tallyData.merkleRoot;
      addLog(`Root hash Merkle (real) derivado desde ciphertexts: ${derivedRoot}`);
      addLog(
        `Conteo real listo. Validas=${tallyData.validCount}, inválidas=${tallyData.invalidCount}. Resumen=${JSON.stringify(tallyData.summary)}`,
      );

      addLog("Creando Processing Batch en base de datos...");
      const batchRes = await createProcessingBatchAction(electionId, ciphertexts.length, derivedRoot);
      if (!batchRes.ok) throw new Error(`Error creando batch: ${batchRes.error}`);
      const batchId = batchRes.batchId;
      addLog(`Batch creado. ID: ${batchId}`);

      await updateProcessingBatchStatusAction(batchId!, "RUNNING");

      addLog("Procesando Batch de forma determinista (sin simulación temporal)...");
      await updateProcessingBatchStatusAction(batchId!, "COMPLETED");
      addLog("Batch procesado y completado.");

      addLog("Creando Tally Job en base de datos...");
      const jobRes = await createTallyJobAction(electionId, batchId!);
      if (!jobRes.ok) throw new Error(`Error creando tally job: ${jobRes.error}`);
      const jobId = jobRes.jobId;
      addLog(`Tally Job creado. ID: ${jobId}`);

      const transcriptHash = tallyData.transcriptHash;
      const proofPayload = ethers.solidityPacked(
        ["string", "bytes32", "bytes32", "uint256"],
        ["BU-PVP-1:TALLY_TRANSCRIPT_V1", derivedRoot, transcriptHash, BigInt(ciphertexts.length)],
      );

      setStatus("PUBLISHING_STUB");
      addLog("Publicando commitment del transcript de tally on-chain...");
      const proofResult = await publishProofAction(electionId, proofPayload);
      if (!proofResult.ok) throw new Error(`Fallo publicando proof: ${proofResult.error}`);
      addLog(`Proof publicado on-chain. Tx: ${proofResult.txHash}`);

      await updateTallyJobStatusAction(
        jobId!,
        "COMPLETED",
        "TRANSCRIPT_VERIFIED",
        proofResult.txHash!,
        {
          summary: tallyData.summary,
          validCount: tallyData.validCount,
          invalidCount: tallyData.invalidCount,
          ballotsCount: tallyData.ballotsCount,
          merkleRoot: derivedRoot,
          transcriptHash,
        },
      );
      setLastJobId(jobId!);
      setTallyComputation({
        summary: tallyData.summary,
        validCount: tallyData.validCount,
        invalidCount: tallyData.invalidCount,
        ballotsCount: tallyData.ballotsCount,
        merkleRoot: derivedRoot,
        transcriptHash,
        transcript: tallyData.transcript,
        proofPayload,
        proofTxHash: proofResult.txHash!,
      });

      setStatus("PUBLISHING_ACTA");
      addLog("Generando ACTA_ESCRUTINIO firmada y anclando hash en la blockchain...");
      
      const actaJson = {
        kind: "ACTA_ESCRUTINIO",
        electionId,
        tallyMode: "REAL_TRANSCRIPT",
        note: "Descifrado y conteo reales ejecutados. Compromiso de transcript publicado; ZK completa pendiente.",
        totalProcessed: tallyData.ballotsCount,
        validBallots: tallyData.validCount,
        invalidBallots: tallyData.invalidCount,
        summary: tallyData.summary,
        merkleRoot: derivedRoot,
        transcriptHash,
        proofPayload,
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
      addLog("Escrutinio completado con descifrado y conteo reales.");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      setStatus("IDLE");
    }
  };

  const handlePublishResults = async () => {
    try {
      setErrorMsg("");
      if (!tallyComputation) {
        throw new Error("No existe un resultado de tally real para publicar. Ejecuta primero el procesamiento.");
      }

      const jobId = lastJobId ?? "unknown-job";
      addLog(`Generando Result Payload (basado en tallyJobId: ${jobId})...`);
      const resultJson = {
        electionId,
        tallyJobId: jobId,
        proofState: "TRANSCRIPT_VERIFIED",
        ballotsCount: tallyComputation.ballotsCount,
        batchesCount: 1,
        resultMode: "TRANSCRIPT_VERIFIED",
        summary: tallyComputation.summary,
        validBallots: tallyComputation.validCount,
        invalidBallots: tallyComputation.invalidCount,
        merkleRoot: tallyComputation.merkleRoot,
        transcriptHash: tallyComputation.transcriptHash,
        proofPayload: tallyComputation.proofPayload,
        proofTxHash: tallyComputation.proofTxHash,
        honesty: {
          note: "El resultSummary proviene de descifrado real de ciphertexts y transcript verificable.",
          whatIsReal: "Descifrado, conteo, Merkle root, commitment on-chain, actas ancladas",
          whatIsPending: "Prueba ZK completa"
        },
        publicationTimestamp: new Date().toISOString(),
      };

      const payloadRes = await createResultPayloadAction(electionId, jobId, resultJson, {
        proofState: "TRANSCRIPT_VERIFIED",
        resultKind: "TALLY_REAL",
      });
      if (!payloadRes.ok) throw new Error(`Fallo guardando payload: ${payloadRes.error}`);
      addLog(`Result Payload publicado. Hash: ${payloadRes.payloadHash} | modo=${payloadRes.resultMode}`);

      addLog("Generando ACTA_RESULTADOS (kind=3) y anclando on-chain...");
      const actaJson = {
        kind: "ACTA_RESULTADOS",
        electionId,
        tallyMode: "REAL_TRANSCRIPT",
        note: "Resultados publicados desde conteo real; ZK completa pendiente.",
        summary: tallyComputation.summary,
        validBallots: tallyComputation.validCount,
        invalidBallots: tallyComputation.invalidCount,
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
          Esta consola ejecuta descifrado y conteo reales con compromiso de transcript verificable publicado on-chain.
          La prueba ZK completa aún está pendiente de integración; mientras tanto, la auditoría debe validar transcript y hashes.
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
              PUBLICAR RESULTADOS Y ABRIR AUDITORÍA
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
