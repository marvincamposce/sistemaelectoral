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
  publishTranscriptCommitmentAction, 
  publishActaWithContentAction, 
  advanceToResultsPublishedAction,
  createProcessingBatchAction,
  updateProcessingBatchStatusAction,
  createTallyJobAction,
  submitDecryptionShareAction,
  updateTallyJobStatusAction,
  logIncidentAction,
  createResultPayloadAction,
  getZkPublicationGateAction,
  openAuditWindowAction,
  persistAuditBundleAction,
  generateZkProofAction,
  submitOnchainZkProofAction,
} from "../../actions";

// Recreate public env inline for simplicity
function getClientEnv() {
  return {
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:3020"
  };
}

type TallyStatus = "IDLE" | "FETCHING_CIPHERTEXTS" | "COMPUTING_TALLY" | "PUBLISHING_TRANSCRIPT" | "PUBLISHING_ACTA" | "DONE";

type RealTallyComputation = {
  summary: Record<string, number>;
  validCount: number;
  invalidCount: number;
  ballotsCount: number;
  merkleRoot: string;
  merkleRootPoseidon: string;
  transcriptHash: string;
  transcript: Parameters<typeof generateZkProofAction>[1];
  commitmentPayload: string;
  commitmentTxHash: string;
};

type BallotsApiResponse = {
  ballots?: Array<{ ciphertext: string }>;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

type ZkPublicationGateState = {
  ready: boolean;
  proofState: string;
  blockers: string[];
};

export default function TallyPage({ params }: { params: Promise<{ electionId: string }> }) {
  const resolvedParams = use(params);
  const electionId = resolvedParams.electionId;

  const [status, setStatus] = useState<TallyStatus>("IDLE");
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
  const [onchainVerifyTx, setOnchainVerifyTx] = useState<string | null>(null);
  const [onchainSubmitting, setOnchainSubmitting] = useState(false);
  const [zkGate, setZkGate] = useState<ZkPublicationGateState | null>(null);

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
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
      return null;
    } finally {
      if (!options?.silent) setCeremonyLoading(false);
    }
  };

  useEffect(() => {
    void refreshCeremonyState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electionId]);

  const refreshZkGate = async (jobId?: string | null) => {
    const res = await getZkPublicationGateAction(electionId, { tallyJobId: jobId ?? lastJobId });
    if (res.ok) {
      setZkGate({
        ready: res.ready,
        proofState: res.proofState,
        blockers: res.blockers,
      });
    }
    return res;
  };

  const handleCreateCeremony = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      setCeremonyLoading(true);
      const res = await createDecryptionCeremonyAction(electionId);
      if (!res.ok) throw new Error(res.error ?? "No se pudo crear la ceremonia");
      setCeremony((res.ceremony as DecryptionCeremonyState | null) ?? null);
      setCeremonyMsg(res.created ? "Ceremonia 2-de-3 abierta." : "Ya existía una ceremonia abierta/reutilizable.");
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setCeremonyLoading(false);
    }
  };

  const handleGenerateShares = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");
      const res = await generateCoordinatorSharesAction();
      if (!res.ok) throw new Error(res.error ?? "No se pudieron generar fragmentos de clave.");
      setGeneratedShares(res.shares);
      setCeremonyMsg("Fragmentos de clave generados para distribución operativa (2 de 3).");
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
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
      setCeremonyMsg(res.closed ? "Ceremonia cerrada. Ya no se aceptan nuevos fragmentos." : "La ceremonia ya estaba cerrada.");
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setCeremonyLoading(false);
    }
  };

  const handleSubmitShare = async () => {
    try {
      setErrorMsg("");
      setCeremonyMsg("");

      if (!trusteeIdInput.trim()) {
        throw new Error("Ingresa el identificador del custodio (trusteeId) antes de enviar el fragmento.");
      }
      if (!sharePayloadInput.trim()) {
        throw new Error("Ingresa el contenido del fragmento (sharePayload) antes de enviarlo.");
      }
      if (submissionChannelInput === "API_SIGNED") {
        if (!ceremony?.ceremonyId) {
          throw new Error("El canal API_SIGNED requiere una ceremonia activa.");
        }
        if (!signerAddressInput.trim()) {
          throw new Error("Ingresa la dirección firmante (signerAddress) para usar API_SIGNED.");
        }
        if (!signatureInput.trim()) {
          throw new Error("Ingresa la firma (signature) para usar API_SIGNED.");
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
        throw new Error(res.error ?? "No se pudo registrar el fragmento.");
      }

      setCeremony((res.ceremony as DecryptionCeremonyState | null) ?? null);
      setCeremonyMsg(
        res.ready
          ? "Fragmento registrado. Ceremonia lista para descifrado (umbral cumplido)."
          : "Fragmento registrado. Aún faltan fragmentos para alcanzar el umbral.",
      );
      setSharePayloadInput("");
      if (submissionChannelInput === "API_SIGNED") {
        setSignatureInput("");
      }
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
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
        throw new Error("Ingresa trusteeId para generar el mensaje de firma.");
      }
      if (!sharePayloadInput.trim()) {
        throw new Error("Ingresa el contenido del fragmento (sharePayload) para generar el mensaje de firma.");
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
  setCeremonyMsg("Mensaje de firma generado. Firma este contenido con la billetera del custodio.");
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
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
      setZkProofStatus(null);
      setZkProofJobId(null);
      setOnchainVerifyTx(null);
      setZkGate(null);

      const ceremonySnapshot = await refreshCeremonyState({ silent: true });
      if (!ceremonySnapshot) {
        addLog("No existe una ceremonia 2-de-3 activa. El escrutinio no continuará hasta que existan shares válidas suficientes.");
      } else if (ceremonySnapshot.shareCount < ceremonySnapshot.thresholdRequired) {
        addLog(
          `Advertencia: ceremonia ${ceremonySnapshot.ceremonyId} con ${ceremonySnapshot.shareCount}/${ceremonySnapshot.thresholdRequired} fragmentos. ` +
            "Sin umbral completo, el escrutinio permanece bloqueado.",
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
      if (!res.ok) throw new Error("Fallo al descargar boletas desde la API de evidencias.");
      
      const data = (await res.json()) as BallotsApiResponse;
      const ciphertexts = Array.isArray(data.ballots)
        ? data.ballots.map((ballot) => String(ballot.ciphertext))
        : [];
      addLog(`Se obtuvieron ${ciphertexts.length} cifrados listos para procesar.`);
      const pointer = [{ source: "ballots", count: ciphertexts.length }];
      if (ciphertexts.length === 0) {
        await logIncidentAction(electionId, "TALLY_NO_BALLOTS", "TALLY_ERROR", "Se intentó ejecutar un lote de procesamiento sin boletas publicadas.", "CRITICAL", pointer);
        throw new Error("No hay boletas (input_count=0). Abortando. Incidente registrado.");
      }

      setStatus("COMPUTING_TALLY");
      addLog("Descifrando boletas y calculando resumen real...");
      const tallyRes = await computeRealTallyAction(electionId);
      if (!tallyRes.ok) {
        await logIncidentAction(
          electionId,
          `TALLY_DECRYPTION_FAILED:${new Date().toISOString()}`,
          "TALLY_DECRYPTION_FAILED",
          `Fallo en descifrado/conteo real: ${tallyRes.error ?? "desconocido"}`,
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
        transcript: Parameters<typeof generateZkProofAction>[1];
        transcriptHash: string;
      };

      const derivedRoot = tallyData.merkleRoot;
      addLog(`Raíz Merkle real (hash) derivada desde los ciphertexts: ${derivedRoot}`);
      addLog(`Raíz Merkle Poseidon (inclusión verificable): ${tallyData.merkleRootPoseidon}`);
      addLog(
        `Conteo real listo. Válidas=${tallyData.validCount}, inválidas=${tallyData.invalidCount}. Resumen=${JSON.stringify(tallyData.summary)}`,
      );

      addLog("Creando lote de procesamiento (processing batch) en base de datos...");
      const batchRes = await createProcessingBatchAction(electionId, ciphertexts.length, derivedRoot);
      if (!batchRes.ok) throw new Error(`Error creando el lote: ${batchRes.error}`);
      const batchId = batchRes.batchId;
      addLog(`Lote creado. ID: ${batchId}`);

      await updateProcessingBatchStatusAction(batchId!, "RUNNING");

      addLog("Procesando lote de forma determinista (sin simulación temporal)...");
      await updateProcessingBatchStatusAction(batchId!, "COMPLETED");
      addLog("Lote procesado y completado.");

      addLog("Creando proceso de escrutinio (tally job) en base de datos...");
      const jobRes = await createTallyJobAction(electionId, batchId!);
      if (!jobRes.ok) throw new Error(`Error creando el proceso de escrutinio: ${jobRes.error}`);
      const jobId = jobRes.jobId;
      addLog(`Proceso de escrutinio creado. ID: ${jobId}`);

      const transcriptHash = tallyData.transcriptHash;
      const commitmentPayload = ethers.solidityPacked(
        ["string", "bytes32", "bytes32", "uint256"],
        ["BU-PVP-1:TALLY_TRANSCRIPT_V1", derivedRoot, transcriptHash, BigInt(ciphertexts.length)],
      );

      setStatus("PUBLISHING_TRANSCRIPT");
  addLog("Publicando compromiso del transcript de escrutinio en cadena...");
      const commitmentResult = await publishTranscriptCommitmentAction(electionId, commitmentPayload);
  if (!commitmentResult.ok) throw new Error(`Fallo publicando el compromiso de transcript: ${commitmentResult.error}`);
  addLog(`Compromiso de transcript publicado en cadena. Tx: ${commitmentResult.txHash}`);

      await updateTallyJobStatusAction(
        jobId!,
        "COMPLETED",
        "TRANSCRIPT_COMMITTED",
        commitmentResult.txHash!,
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
      setZkGate({
        ready: false,
        proofState: "TRANSCRIPT_COMMITTED",
        blockers: ["La publicación final sigue bloqueada hasta completar la verificación ZK obligatoria."],
      });
      setTallyComputation({
        summary: tallyData.summary,
        validCount: tallyData.validCount,
        invalidCount: tallyData.invalidCount,
        ballotsCount: tallyData.ballotsCount,
        merkleRoot: derivedRoot,
        merkleRootPoseidon: tallyData.merkleRootPoseidon,
        transcriptHash,
        transcript: tallyData.transcript,
        commitmentPayload,
        commitmentTxHash: commitmentResult.txHash!,
      });

      setStatus("PUBLISHING_ACTA");
      addLog("Generando ACTA_ESCRUTINIO firmada y anclando huella (hash) en la cadena de bloques...");
      
      const actaJson = {
        kind: "ACTA_ESCRUTINIO",
        electionId,
        tallyMode: "REAL_TRANSCRIPT_COMMITTED",
        note: "Descifrado y conteo reales ejecutados. El transcript quedó comprometido en cadena, pero la elección no puede publicar resultados finales hasta completar la verificación ZK.",
        totalProcessed: tallyData.ballotsCount,
        validBallots: tallyData.validCount,
        invalidBallots: tallyData.invalidCount,
        summary: tallyData.summary,
        merkleRoot: derivedRoot,
        merkleRootPoseidon: tallyData.merkleRootPoseidon,
        transcriptHash,
        commitmentPayload,
        timestamp: new Date().toISOString()
      };
      
      // kind=2 = ACTA_ESCRUTINIO in Solidity enum
      const actaResult = await publishActaWithContentAction(electionId, actaJson, 2);
      if (!actaResult.ok) throw new Error(`Fallo anclando acta: ${actaResult.error}`);
      addLog(`ACTA_ESCRUTINIO anclada en cadena. Tx: ${actaResult.txHash} | actId: ${actaResult.actId}`);

      setStatus("DONE");
      addLog("Escrutinio base completado. Falta la prueba ZK y su verificación para publicar resultados finales.");
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
      setStatus("IDLE");
    }
  };

  const handlePublishResults = async () => {
    try {
      setErrorMsg("");
      if (!tallyComputation) {
        throw new Error("No existe un resultado real de escrutinio para publicar. Ejecuta primero el procesamiento.");
      }

      const jobId = lastJobId ?? "proceso-desconocido";
      const gateRes = await refreshZkGate(jobId);
      if (!gateRes.ok) throw new Error(gateRes.error ?? "No se pudo validar el gate ZK.");
      if (!gateRes.ready) {
        throw new Error(`No se puede publicar resultados finales: ${gateRes.blockers.join(" ")}`);
      }
      addLog(`Generando contenido de resultados (payload) basado en tallyJobId: ${jobId}...`);
      const resultJson = {
        electionId,
        tallyJobId: jobId,
        proofState: "VERIFIED",
        ballotsCount: tallyComputation.ballotsCount,
        batchesCount: 1,
        resultMode: "VERIFIED",
        summary: tallyComputation.summary,
        validBallots: tallyComputation.validCount,
        invalidBallots: tallyComputation.invalidCount,
        merkleRoot: tallyComputation.merkleRoot,
        merkleRootPoseidon: tallyComputation.merkleRootPoseidon,
        transcriptHash: tallyComputation.transcriptHash,
        commitmentPayload: tallyComputation.commitmentPayload,
        commitmentTxHash: tallyComputation.commitmentTxHash,
        honesty: {
          note: "El resumen de resultados proviene de descifrado y conteo reales cerrados por verificación ZK antes de publicar.",
          whatIsReal: "Descifrado, conteo, raíz Merkle, compromiso en cadena, prueba ZK y verificación final",
          whatIsPending: "Nada en el pipeline obligatorio antes de la publicación final."
        },
        publicationTimestamp: new Date().toISOString(),
      };

      const payloadRes = await createResultPayloadAction(electionId, jobId, resultJson, {
        proofState: "VERIFIED",
        resultKind: "TALLY_VERIFIED",
      });
      if (!payloadRes.ok) throw new Error(`Fallo guardando payload: ${payloadRes.error}`);
      addLog(`Contenido de resultados publicado (payload). Hash: ${payloadRes.payloadHash} | modo=${payloadRes.resultMode}`);

      addLog("Generando ACTA_RESULTADOS (kind=3) y anclando en cadena...");
      const actaJson = {
        kind: "ACTA_RESULTADOS",
        electionId,
        tallyMode: "REAL_ZK_VERIFIED",
        note: "Resultados publicados únicamente después de completar la verificación ZK obligatoria.",
        summary: tallyComputation.summary,
        validBallots: tallyComputation.validCount,
        invalidBallots: tallyComputation.invalidCount,
        payloadHash: payloadRes.payloadHash,
        timestamp: new Date().toISOString()
      };
      // kind=3 = ACTA_RESULTADOS in Solidity enum
      const actaResult = await publishActaWithContentAction(electionId, actaJson, 3);
      if (!actaResult.ok) throw new Error(`Fallo anclando acta de resultados: ${actaResult.error}`);
      addLog(`ACTA_RESULTADOS anclada en cadena. Tx: ${actaResult.txHash} | actId: ${actaResult.actId}`);

      addLog("Notificando contrato para transicionar de TALLYING a RESULTS_PUBLISHED...");
      const resultsResult = await advanceToResultsPublishedAction(electionId);
      if (!resultsResult.ok) throw new Error(`Fallo cambiando la fase publicada: ${resultsResult.error}`);
      addLog(`Fase de resultados publicados activada. Tx: ${resultsResult.txHash}`);

      addLog("Abriendo Ventana de Auditoría...");
      const auditRes = await openAuditWindowAction(electionId);
      if (!auditRes.ok) throw new Error(`Fallo abriendo auditoría: ${auditRes.error}`);
      addLog("Ventana de auditoría abierta.");

      addLog("Materializando paquete de auditoría (audit bundle)...");
      const bundleRes = await persistAuditBundleAction(electionId);
      if (!bundleRes.ok) throw new Error(`Fallo materializando bundle: ${bundleRes.error}`);
      addLog(`Paquete de auditoría materializado. bundleHash: ${bundleRes.bundleHash}`);
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  return (
    <main className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-amber-700 mb-2">Resumen operativo JED</h2>
        <p className="text-sm text-amber-700">
          Esta consola ejecuta descifrado y conteo reales, publica un compromiso de transcript y exige prueba ZK antes de habilitar la publicación final.
          El compromiso inicial no reemplaza la verificación criptográfica obligatoria.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Panel de escrutinio guiado</h2>
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
                El escrutinio requiere reconstrucción de clave desde fragmentos registrados. Si no hay umbral completo, el proceso queda bloqueado.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void refreshCeremonyState()}
                className="px-3 py-2 text-xs rounded border border-slate-300 text-slate-800 hover:bg-slate-100"
                disabled={ceremonyLoading}
              >
                Actualizar
              </button>
              <button
                onClick={handleCreateCeremony}
                className="px-3 py-2 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white"
                disabled={ceremonyLoading}
              >
                Abrir ceremonia
              </button>
              <button
                onClick={handleCloseCeremony}
                className="px-3 py-2 text-xs rounded bg-rose-700 hover:bg-rose-600 text-white disabled:bg-slate-300"
                disabled={ceremonyLoading || !ceremony || ceremony.status === "CLOSED"}
              >
                Cerrar ceremonia
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
            {ceremonyLoading ? (
              <span>Cargando estado de ceremonia...</span>
            ) : ceremony ? (
              <div className="space-y-1">
                <div>ID de ceremonia: <span className="font-mono">{ceremony.ceremonyId}</span></div>
                <div>Estado: <span className="font-semibold">{ceremony.status}</span></div>
                <div>
                  Fragmentos: <span className="font-semibold">{ceremony.shareCount}</span> / {ceremony.thresholdRequired}
                </div>
                <div>Custodios esperados: {ceremony.trusteeCount}</div>
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
                Generar fragmentos locales
              </button>
            </div>

            {generatedShares.length > 0 && (
              <div className="space-y-2 rounded border border-sky-200 bg-sky-50 p-3">
                <div className="text-xs text-sky-700">Fragmentos generados (distribúyelos por canal seguro):</div>
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
                      Usar
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
                {shareSubmitting ? "Enviando..." : "Registrar fragmento"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-[220px_1fr]">
              <select
                value={submissionChannelInput}
                onChange={(e) => setSubmissionChannelInput(e.target.value as "MANUAL" | "API_SIGNED")}
                className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900"
              >
                <option value="MANUAL">Manual</option>
                <option value="API_SIGNED">Firmada por API (API_SIGNED)</option>
              </select>
              <div className="text-xs text-slate-500 flex items-center">
                API_SIGNED valida firma ECDSA del custodio sobre el mensaje canónico del fragmento.
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
                    {signingMessageLoading ? "Generando..." : "Generar mensaje de firma"}
                  </button>
                </div>

                <textarea
                  readOnly
                  value={signingMessage}
                  placeholder="El mensaje canónico aparecerá aquí para firmarlo con la billetera del custodio"
                  className="w-full min-h-24 rounded bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] font-mono text-slate-800"
                />

                <input
                  value={signerAddressInput}
                  onChange={(e) => setSignerAddressInput(e.target.value)}
                  placeholder="0x... dirección firmante (signerAddress)"
                  className="w-full rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900"
                />
                <input
                  value={signatureInput}
                  onChange={(e) => setSignatureInput(e.target.value)}
                  placeholder="0x... firma (signature)"
                  className="w-full rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900"
                />
              </div>
            )}

            {ceremonyMsg && <div className="text-xs text-emerald-700">{ceremonyMsg}</div>}
          </div>
        </div>

        <div className="mt-8 flex flex-col space-y-5 border-t border-slate-200 pt-6">
          <button 
            disabled={status !== "IDLE" || ceremonyLoading}
            onClick={handleStartTally}
            className={`w-full px-6 py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-3 transition-all ${
              status === "IDLE" && !ceremonyLoading
              ? "bg-slate-900 hover:bg-black text-white shadow-lg hover:shadow-xl ring-2 ring-transparent focus:ring-slate-400" 
              : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {status === "IDLE" ? (
              <>
                <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                Iniciar descifrado y escrutinio
              </>
            ) : (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                Ejecutando cálculos de conteo...
              </>
            )}
          </button>
          
          {status === "DONE" && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
              
              <div className="space-y-2">
                <button 
                  onClick={handlePublishResults}
                  disabled={!zkGate?.ready}
                  className="w-full px-6 py-4 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-md flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:hover:bg-slate-300"
                >
                  <svg className="w-5 h-5 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  Publicar resultados y abrir auditoría pública
                </button>
                <p className="text-center text-xs text-slate-500 font-medium">Publica el acta matemática y abre la ventana temporal para impugnaciones públicas solo cuando el gate ZK esté completo.</p>
                {zkGate && !zkGate.ready && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {zkGate.blockers.join(" ")}
                  </div>
                )}
              </div>

              <div className="h-px w-full bg-slate-200" />

              <div className="bg-violet-50 border border-violet-100 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-violet-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                  <div>
                    <h3 className="text-sm font-bold text-violet-900">Prueba de conocimiento cero (ZK)</h3>
                    <p className="text-xs text-violet-700 mt-1 mb-4">
                      El cierre final exige dos pruebas: tally on-chain y descifrado verificado. Sin ambas, no se publican resultados.
                    </p>

                    {tallyComputation && !zkProofStatus && (
                      <button
                        onClick={async () => {
                          try {
                            setErrorMsg("");
                            setZkProofStatus("BUILDING");
                            setOnchainVerifyTx(null);
                            addLog("Generando prueba ZK (Groth16 BN-128)...");
                            const res = await generateZkProofAction(
                              electionId,
                              tallyComputation.transcript,
                              lastJobId ?? "proceso-desconocido",
                            );
                            if (!res.ok) {
                              setZkProofStatus("FAILED");
                              throw new Error(res.error ?? "Falló la generación de la prueba ZK.");
                            }
                            setZkProofJobId(res.jobId ?? null);
                            setZkProofStatus(res.status ?? "VERIFIED_OFFCHAIN");
                            await refreshZkGate(lastJobId);
                            addLog(`Pruebas ZK generadas y verificadas fuera de cadena. JobId tally: ${res.jobId}`);
                          } catch (err: unknown) {
                            setErrorMsg(getErrorMessage(err));
                          }
                        }}
                        className="w-full px-5 py-3.5 rounded-xl font-bold tracking-wide text-sm bg-violet-600 hover:bg-violet-700 text-white transition-all shadow-md group border border-violet-700"
                      >
                        Generar prueba ZK (Groth16 local)
                      </button>
                    )}

                    {zkProofStatus && (
                      <div className={`mt-3 px-4 py-3 rounded-xl text-xs font-mono font-bold flex items-center gap-3 ${
                        zkProofStatus === "VERIFIED_OFFCHAIN" || zkProofStatus === "VERIFIED_ONCHAIN" || zkProofStatus === "VERIFIED"
                          ? "bg-emerald-100 text-emerald-800 border-2 border-emerald-300" :
                        zkProofStatus === "BUILDING" 
                          ? "bg-amber-100 text-amber-800 border-2 border-amber-300" :
                        "bg-rose-100 text-rose-800 border-2 border-rose-300"
                      }`}>
                        {zkProofStatus === "BUILDING" && <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-amber-800" />}
                        {zkProofStatus === "VERIFIED_OFFCHAIN" && <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>}
                        
                        <div>
                          Estado ZK: <span className="uppercase">{zkProofStatus}</span>
                          {zkProofJobId && <div className="text-[10px] font-normal text-emerald-700/80 mt-0.5">ID de prueba: {zkProofJobId}</div>}
                        </div>
                      </div>
                    )}

                    {zkGate && (
                      <div className={`mt-3 rounded-xl border p-3 text-xs ${
                        zkGate.ready
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}>
                        <div className="font-semibold">Gate de publicación: {zkGate.ready ? "LISTO" : "BLOQUEADO"}</div>
                        <div className="mt-1">Estado criptográfico actual: {zkGate.proofState}</div>
                        {zkGate.blockers.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {zkGate.blockers.map((blocker) => (
                              <div key={blocker}>- {blocker}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {zkProofStatus === "VERIFIED_OFFCHAIN" && (
                      <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                         <h4 className="text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                           Registrar prueba en cadena (blockchain)
                         </h4>
                         <p className="text-xs text-emerald-700 mb-4 font-medium">
                           Envía la proof de tally al contrato inteligente. La publicación final seguirá bloqueada hasta que también exista la proof obligatoria de descifrado.
                         </p>
                         <button
                          onClick={async () => {
                            try {
                              setErrorMsg("");
                              setOnchainSubmitting(true);
                              addLog("Enviando prueba al verificador en cadena...");
                              const res = await submitOnchainZkProofAction(electionId, { jobId: zkProofJobId ?? undefined });
                              if (!res.ok) throw new Error(res.error ?? "Falló la verificación en cadena.");
                              setZkProofStatus(res.status ?? "VERIFIED_ONCHAIN");
                              setOnchainVerifyTx(res.txHash ?? null);
                              const gateRes = await refreshZkGate(lastJobId);
                              if (gateRes.ok && gateRes.ready) {
                                addLog("Gate ZK satisfecho. Ya se puede publicar el resultado final.");
                              }
                            } catch (err: unknown) {
                              setErrorMsg(getErrorMessage(err));
                            } finally {
                              setOnchainSubmitting(false);
                            }
                          }}
                          disabled={onchainSubmitting}
                          className="w-full px-5 py-3.5 rounded-xl font-bold tracking-wide text-sm bg-emerald-700 hover:bg-emerald-800 text-white transition-all shadow-md border border-emerald-900 flex items-center justify-center gap-3 disabled:bg-emerald-300"
                        >
                          {onchainSubmitting ? (
                            <>
                              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              Ejecutando transacción en cadena...
                            </>
                          ) : (
                            "Verificar prueba en cadena"
                          )}
                        </button>
                      </div>
                    )}

                    {onchainVerifyTx && (
                      <div className="mt-3 text-[11px] font-mono text-emerald-800 bg-emerald-100/50 p-2 rounded-lg border border-emerald-200">
                        Transacción blockchain: {onchainVerifyTx}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {logs.length > 0 && (
          <div className="mt-8 bg-slate-900 rounded-2xl overflow-hidden shadow-xl border border-slate-700">
            <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="ml-2 text-xs font-semibold text-slate-300 uppercase tracking-widest">Registro del proceso</span>
            </div>
            <div className="p-5 space-y-2 h-64 overflow-y-auto custom-scrollbar">
              {logs.map((L, i) => (
                <div key={i} className="text-xs font-mono text-emerald-400 break-all leading-relaxed">
                  <span className="text-slate-500 select-none mr-2">{'>'}</span>{L}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
