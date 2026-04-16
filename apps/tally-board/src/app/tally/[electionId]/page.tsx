"use client";

import { use, useState, useEffect } from "react";
import { ethers } from "ethers";
import { 
  closeDecryptionCeremonyAction,
  computeRealTallyAction,
  createDecryptionCeremonyAction,
  generateCoordinatorSharesAction,
  getDecryptionCeremonyStateAction,
  getDecryptionShareSigningMessageAction,
  publishProofAction, 
  publishActaWithContentAction, 
  advanceToResultsPublishedAction,
  createProcessingBatchAction,
  updateProcessingBatchStatusAction,
  createTallyJobAction,
  submitDecryptionShareAction,
  updateTallyJobStatusAction,
  logIncidentAction,
  createResultPayloadAction,
  openAuditWindowAction,
  persistAuditBundleAction,
  generateZkProofAction
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
  merkleRootPoseidon: string;
  transcriptHash: string;
  transcript: unknown;
  proofPayload: string;
  proofTxHash: string;
};

type DecryptionCeremonyState = {
  ceremonyId: string;
  status: string;
  thresholdRequired: number;
  trusteeCount: number;
  shareCount: number;
  trustees: Array<{ trusteeId: string; submittedAt: string }>;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
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
  const [ceremony, setCeremony] = useState<DecryptionCeremonyState | null>(null);
  const [ceremonyLoading, setCeremonyLoading] = useState(false);
  const [ceremonyMsg, setCeremonyMsg] = useState("");
  const [generatedShares, setGeneratedShares] = useState<string[]>([]);
  const [trusteeIdInput, setTrusteeIdInput] = useState("TRUSTEE_1");
  const [sharePayloadInput, setSharePayloadInput] = useState("");
  const [submissionChannelInput, setSubmissionChannelInput] = useState<"MANUAL" | "API_SIGNED">("MANUAL");
  const [signerAddressInput, setSignerAddressInput] = useState("");
  const [signatureInput, setSignatureInput] = useState("");
  const [signingMessage, setSigningMessage] = useState("");
  const [signingMessageLoading, setSigningMessageLoading] = useState(false);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [zkProofStatus, setZkProofStatus] = useState<string | null>(null);
  const [zkProofJobId, setZkProofJobId] = useState<string | null>(null);

  const addLog = (msg: string) => setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const refreshCeremonyState = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setCeremonyLoading(true);
      const res = await getDecryptionCeremonyStateAction(electionId);
      if (!res.ok) {
        throw new Error(res.error ?? "No se pudo consultar la ceremonia");
      }
      setCeremony(res.ceremony as DecryptionCeremonyState | null);
      return (res.ceremony as DecryptionCeremonyState | null) ?? null;
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      return null;
    } finally {
      if (!options?.silent) setCeremonyLoading(false);
    }
  };

  useEffect(() => {
    void refreshCeremonyState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electionId]);

  const handleCreateCeremony = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      setCeremonyLoading(true);
      const res = await createDecryptionCeremonyAction(electionId);
      if (!res.ok) throw new Error(res.error ?? "No se pudo crear la ceremonia");
      setCeremony((res.ceremony as DecryptionCeremonyState | null) ?? null);
      setCeremonyMsg(res.created ? "Ceremonia 2-de-3 abierta." : "Ya existía una ceremonia abierta/reutilizable.");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setCeremonyLoading(false);
    }
  };

  const handleGenerateShares = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      const res = await generateCoordinatorSharesAction();
      if (!res.ok) throw new Error(res.error ?? "No se pudieron generar shares");
      setGeneratedShares(res.shares);
      setCeremonyMsg("Shares locales generadas para distribución operativa (2 de 3).");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  };

  const handleCloseCeremony = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      setCeremonyLoading(true);

      const res = await closeDecryptionCeremonyAction({
        electionId,
        ceremonyId: ceremony?.ceremonyId,
      });

      if (!res.ok) {
        throw new Error(res.error ?? "No se pudo cerrar la ceremonia");
      }

      setCeremony((res.ceremony as DecryptionCeremonyState | null) ?? null);
      setCeremonyMsg(res.closed ? "Ceremonia cerrada. Ya no se aceptan nuevas shares." : "La ceremonia ya estaba cerrada.");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setCeremonyLoading(false);
    }
  };

  const handleSubmitShare = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");

      if (!trusteeIdInput.trim()) {
        throw new Error("Ingresa trusteeId antes de enviar la share.");
      }
      if (!sharePayloadInput.trim()) {
        throw new Error("Ingresa sharePayload antes de enviar la share.");
      }
      if (submissionChannelInput === "API_SIGNED") {
        if (!ceremony?.ceremonyId) {
          throw new Error("API_SIGNED requiere una ceremonia activa explícita.");
        }
        if (!signerAddressInput.trim()) {
          throw new Error("Ingresa signerAddress para API_SIGNED.");
        }
        if (!signatureInput.trim()) {
          throw new Error("Ingresa signature para API_SIGNED.");
        }
      }

      setShareSubmitting(true);
      const res = await submitDecryptionShareAction({
        electionId,
        trusteeId: trusteeIdInput.trim(),
        sharePayload: sharePayloadInput.trim(),
        ceremonyId: ceremony?.ceremonyId,
        submissionChannel: submissionChannelInput,
        signerAddress: submissionChannelInput === "API_SIGNED" ? signerAddressInput.trim() : null,
        signature: submissionChannelInput === "API_SIGNED" ? signatureInput.trim() : null,
      });

      if (!res.ok) {
        throw new Error(res.error ?? "No se pudo registrar la share");
      }

      setCeremony((res.ceremony as DecryptionCeremonyState | null) ?? null);
      setCeremonyMsg(
        res.ready
          ? "Share registrada. Ceremonia lista para descifrado (threshold cumplido)."
          : "Share registrada. Aún faltan shares para llegar al threshold.",
      );
      setSharePayloadInput("");
      if (submissionChannelInput === "API_SIGNED") {
        setSignatureInput("");
      }
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleBuildSigningMessage = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");

      if (!ceremony?.ceremonyId) {
        throw new Error("No hay ceremonia activa para generar el mensaje de firma.");
      }
      if (!trusteeIdInput.trim()) {
        throw new Error("Ingresa trusteeId para generar mensaje de firma.");
      }
      if (!sharePayloadInput.trim()) {
        throw new Error("Ingresa sharePayload para generar mensaje de firma.");
      }

      setSigningMessageLoading(true);
      const res = await getDecryptionShareSigningMessageAction({
        electionId,
        ceremonyId: ceremony.ceremonyId,
        trusteeId: trusteeIdInput.trim(),
        sharePayload: sharePayloadInput.trim(),
      });

      if (!res.ok || !res.signingMessage) {
        throw new Error(res.error ?? "No se pudo generar el mensaje de firma");
      }

      setSigningMessage(res.signingMessage);
      setCeremonyMsg("Mensaje de firma generado. Firma exactamente este contenido con la wallet del trustee.");
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    } finally {
      setSigningMessageLoading(false);
    }
  };

  const handleStartTally = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      setLogs([]);
      setTallyComputation(null);

      const ceremonySnapshot = await refreshCeremonyState({ silent: true });
      if (!ceremonySnapshot) {
        addLog("Advertencia: no existe ceremonia 2-de-3 activa. Se intentará fallback legacy solo si está habilitado en servidor.");
      } else if (ceremonySnapshot.shareCount < ceremonySnapshot.thresholdRequired) {
        addLog(
          `Advertencia: ceremonia ${ceremonySnapshot.ceremonyId} con ${ceremonySnapshot.shareCount}/${ceremonySnapshot.thresholdRequired} shares. ` +
            "Sin threshold completo, solo podrá continuar si el fallback legacy está habilitado.",
        );
      } else {
        addLog(
          `Ceremonia ${ceremonySnapshot.ceremonyId} lista (${ceremonySnapshot.shareCount}/${ceremonySnapshot.thresholdRequired}).`,
        );
      }

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
        merkleRootPoseidon: string;
        transcript: unknown;
        transcriptHash: string;
      };

      const derivedRoot = tallyData.merkleRoot;
      addLog(`Root hash Merkle (real) derivado desde ciphertexts: ${derivedRoot}`);
      addLog(`Root Merkle Poseidon (Fase 9B): ${tallyData.merkleRootPoseidon}`);
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
          merkleRootPoseidon: tallyData.merkleRootPoseidon,
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
        merkleRootPoseidon: tallyData.merkleRootPoseidon,
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
        merkleRootPoseidon: tallyData.merkleRootPoseidon,
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
        merkleRootPoseidon: tallyComputation.merkleRootPoseidon,
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-amber-700 mb-2">Advertencia Oficial JED</h2>
        <p className="text-sm text-amber-700">
          Esta consola ejecuta descifrado y conteo reales con compromiso de transcript verificable publicado on-chain.
          La prueba ZK completa aún está pendiente de integración; mientras tanto, la auditoría debe validar transcript y hashes.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Consola de Escrutinio Ciego</h2>
          <span className="text-xs font-mono text-slate-500">Elección #{electionId}</span>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded bg-rose-50 border border-rose-200 p-4">
            <span className="text-rose-700 text-sm font-semibold">{errorMsg}</span>
          </div>
        )}

        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Ceremonia de Descifrado 2-de-3</h3>
              <p className="text-xs text-slate-500 mt-1">
                El tally prioriza la reconstrucción de clave desde shares registradas. Si no hay threshold completo, solo continúa con fallback legacy cuando está habilitado en servidor.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void refreshCeremonyState()}
                className="px-3 py-2 text-xs rounded border border-slate-300 text-slate-800 hover:bg-slate-100"
                disabled={ceremonyLoading}
              >
                REFRESCAR
              </button>
              <button
                onClick={handleCreateCeremony}
                className="px-3 py-2 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white"
                disabled={ceremonyLoading}
              >
                ABRIR CEREMONIA
              </button>
              <button
                onClick={handleCloseCeremony}
                className="px-3 py-2 text-xs rounded bg-rose-700 hover:bg-rose-600 text-white disabled:bg-slate-300"
                disabled={ceremonyLoading || !ceremony || ceremony.status === "CLOSED"}
              >
                CERRAR CEREMONIA
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
            {ceremonyLoading ? (
              <span>Cargando estado de ceremonia...</span>
            ) : ceremony ? (
              <div className="space-y-1">
                <div>Ceremony ID: <span className="font-mono">{ceremony.ceremonyId}</span></div>
                <div>Estado: <span className="font-semibold">{ceremony.status}</span></div>
                <div>
                  Shares: <span className="font-semibold">{ceremony.shareCount}</span> / {ceremony.thresholdRequired}
                </div>
                <div>Trustees esperados: {ceremony.trusteeCount}</div>
                {ceremony.trustees.length > 0 && (
                  <div className="pt-2 space-y-1">
                    {ceremony.trustees.map((t) => (
                      <div key={`${t.trusteeId}-${t.submittedAt}`} className="font-mono text-[11px] text-slate-500">
                        {t.trusteeId} @ {new Date(t.submittedAt).toLocaleString()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span>No hay ceremonia registrada todavía.</span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleGenerateShares}
                className="px-3 py-2 text-xs rounded border border-sky-600 text-sky-700 hover:bg-sky-100"
              >
                GENERAR SHARES LOCALES
              </button>
            </div>

            {generatedShares.length > 0 && (
              <div className="space-y-2 rounded border border-sky-200 bg-sky-50 p-3">
                <div className="text-xs text-sky-700">Shares generadas (distribúyelas fuera de banda):</div>
                {generatedShares.map((share, idx) => (
                  <div key={share} className="flex flex-col md:flex-row md:items-center gap-2">
                    <span className="text-[11px] text-sky-700 font-mono">T{idx + 1}</span>
                    <input
                      readOnly
                      value={share}
                      className="w-full rounded bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-mono text-slate-800"
                    />
                    <button
                      onClick={() => {
                        setTrusteeIdInput(`TRUSTEE_${idx + 1}`);
                        setSharePayloadInput(share);
                      }}
                      className="px-2 py-1 text-[11px] rounded border border-slate-300 text-slate-800 hover:bg-slate-100"
                    >
                      CARGAR
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
              <input
                value={trusteeIdInput}
                onChange={(e) => setTrusteeIdInput(e.target.value)}
                placeholder="TRUSTEE_1"
                className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900"
              />
              <input
                value={sharePayloadInput}
                onChange={(e) => setSharePayloadInput(e.target.value)}
                placeholder="BU-PVP-1_THRESHOLD_2_OF_3_V1:x:0x..."
                className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900"
              />
              <button
                onClick={handleSubmitShare}
                disabled={shareSubmitting}
                className="px-3 py-2 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:bg-slate-300"
              >
                {shareSubmitting ? "ENVIANDO..." : "REGISTRAR SHARE"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-[220px_1fr]">
              <select
                value={submissionChannelInput}
                onChange={(e) => setSubmissionChannelInput(e.target.value as "MANUAL" | "API_SIGNED")}
                className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900"
              >
                <option value="MANUAL">MANUAL</option>
                <option value="API_SIGNED">API_SIGNED</option>
              </select>
              <div className="text-xs text-slate-500 flex items-center">
                API_SIGNED valida firma ECDSA del trustee sobre mensaje canónico por share.
              </div>
            </div>

            {submissionChannelInput === "API_SIGNED" && (
              <div className="space-y-2 rounded border border-cyan-200 bg-cyan-50 p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleBuildSigningMessage}
                    disabled={signingMessageLoading}
                    className="px-3 py-2 text-xs rounded border border-cyan-300 text-cyan-700 hover:bg-cyan-100 disabled:bg-slate-300"
                  >
                    {signingMessageLoading ? "GENERANDO..." : "GENERAR MENSAJE A FIRMAR"}
                  </button>
                </div>

                <textarea
                  readOnly
                  value={signingMessage}
                  placeholder="El mensaje canónico aparecerá aquí para firmarlo con la wallet del trustee"
                  className="w-full min-h-24 rounded bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] font-mono text-slate-800"
                />

                <input
                  value={signerAddressInput}
                  onChange={(e) => setSignerAddressInput(e.target.value)}
                  placeholder="0x... signerAddress"
                  className="w-full rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900"
                />
                <input
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  placeholder="0x... signature"
                  className="w-full rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900"
                />
              </div>
            )}

            {ceremonyMsg && <div className="text-xs text-emerald-700">{ceremonyMsg}</div>}
          </div>
        </div>

        <div className="mt-6 flex flex-col space-y-4">
          <button 
            disabled={status !== "IDLE" || ceremonyLoading}
            onClick={handleStartTally}
            className={`px-4 py-3 rounded-md font-bold text-sm tracking-wide ${
              status === "IDLE" && !ceremonyLoading
              ? "bg-indigo-600 hover:bg-indigo-700 text-white" 
              : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {status === "IDLE" ? "INICIAR PROCESAMIENTO TALLY (Batch Job)" : "EJECUTANDO..."}
          </button>
          {status === "DONE" && (
            <>
              <button 
                onClick={handlePublishResults}
                className={`px-4 py-3 rounded-md font-bold text-sm tracking-wide bg-indigo-600 hover:bg-indigo-700 text-white mt-4`}
              >
                PUBLICAR RESULTADOS Y ABRIR AUDITORÍA
              </button>
              {tallyComputation && !zkProofStatus && (
                <button
                  onClick={async () => {
                    try {
                      setErrorMsg("");
                      setZkProofStatus("BUILDING");
                      addLog("Generando Prueba ZK (Groth16 BN-128)...");
                      const res = await generateZkProofAction(
                        electionId,
                        tallyComputation.transcript as any,
                        lastJobId ?? "unknown",
                      );
                      if (!res.ok) {
                        setZkProofStatus("FAILED");
                        throw new Error(res.error ?? "ZK proof generation failed");
                      }
                      setZkProofJobId(res.jobId ?? null);
                      setZkProofStatus(res.status ?? "VERIFIED_OFFCHAIN");
                      addLog(`ZK Proof generada y verificada off-chain. JobId: ${res.jobId}`);
                      addLog(`  Proof system: ${res.proofSystem} | Circuit: ${res.circuitId}`);
                      addLog(`  VKey hash: ${res.verificationKeyHash}`);
                      addLog(`  Status: ${res.status}`);
                      if (res.honesty) {
                        addLog(`  Prueba: ${res.honesty.whatIsProved}`);
                        addLog(`  Pendiente: ${(res.honesty.whatIsNotProved as string[]).join("; ")}`);
                      }
                    } catch (err: any) {
                      setErrorMsg(err.message || String(err));
                    }
                  }}
                  className="px-4 py-3 rounded-md font-bold text-sm tracking-wide bg-violet-600 hover:bg-violet-700 text-white mt-2"
                >
                  GENERAR PRUEBA ZK (Groth16)
                </button>
              )}
              {zkProofStatus && (
                <div className={`mt-2 px-4 py-2 rounded-md text-xs font-mono ${
                  zkProofStatus === "VERIFIED_OFFCHAIN" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                  zkProofStatus === "BUILDING" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                  ZK Proof: {zkProofStatus}
                  {zkProofJobId && <span className="ml-2">| Job: {zkProofJobId}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {logs.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-500 mb-2">Bitácora de Operaciones Tally</h3>
            <div className="bg-white border border-slate-200 rounded-md p-4 space-y-1 h-64 overflow-y-auto">
              {logs.map((L, i) => (
                <div key={i} className="text-xs font-mono text-emerald-700">{L}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
