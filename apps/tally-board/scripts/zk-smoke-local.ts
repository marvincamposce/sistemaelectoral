import fs from "node:fs";
import path from "node:path";

import { NonceManager, ethers } from "ethers";
import {
  canonicalizeJson,
  deriveCoordinatorPublicKey,
  encryptBallotPayload,
  getPublicKeyHex,
  sha256Hex,
  signEd25519Hex,
  utf8ToBytes,
} from "@blockurna/crypto";
import { Pool } from "pg";

import {
  ensureSchema,
  getPool,
  insertAdminLogEntry,
  upsertCandidate,
  upsertElectionManifest,
} from "../../authority-console/src/lib/db";
import {
  getRegistry,
  parseElectionCreatedFromReceipt,
  REGISTRY_ABI,
} from "../../authority-console/src/lib/registry";

type ActionsModule = Record<string, unknown> & {
  default?: Record<string, unknown>;
};

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const intervalMs = options?.intervalMs ?? 1_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function getAction<T extends (...args: any[]) => any>(mod: ActionsModule, name: string): T {
  const value = (mod as Record<string, unknown>)[name] ?? mod.default?.[name];
  if (typeof value !== "function") {
    throw new Error(`Missing action export: ${name}`);
  }
  return value as T;
}

async function main() {
  const appDir = process.cwd();
  const repoRoot = path.resolve(appDir, "../..");
  loadEnvFile(path.join(appDir, ".env.local"));
  loadEnvFile(path.join(repoRoot, "apps/authority-console/.env.local"));
  loadEnvFile(path.join(repoRoot, "apps/evidence-api/.env"));
  loadEnvFile(path.join(repoRoot, "apps/evidence-indexer/.env"));

  const RPC_URL = requiredEnv("RPC_URL");
  const DATABASE_URL = requiredEnv("DATABASE_URL");
  const ELECTION_REGISTRY_ADDRESS = requiredEnv("ELECTION_REGISTRY_ADDRESS");
  const CONTRACT_ADDRESS = ELECTION_REGISTRY_ADDRESS.toLowerCase();
  const AEA_PRIVATE_KEY = requiredEnv("AEA_PRIVATE_KEY");
  const AEA_ED25519_PRIVATE_KEY_HEX = requiredEnv("AEA_ED25519_PRIVATE_KEY_HEX");
  const REA_PRIVATE_KEY = requiredEnv("REA_PRIVATE_KEY");
  const COORDINATOR_PRIVATE_KEY = requiredEnv("COORDINATOR_PRIVATE_KEY");
  const CHAIN_ID = requiredEnv("CHAIN_ID");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const chain = await provider.getNetwork();
  if (chain.chainId.toString() !== CHAIN_ID) {
    throw new Error(`RPC chainId mismatch: expected ${CHAIN_ID}, got ${chain.chainId}`);
  }

  const registryCode = await provider.getCode(ELECTION_REGISTRY_ADDRESS);
  if (!registryCode || registryCode === "0x") {
    throw new Error(`No bytecode at ELECTION_REGISTRY_ADDRESS=${ELECTION_REGISTRY_ADDRESS}`);
  }

  const pool = getPool(DATABASE_URL);
  await ensureSchema(pool);

  const actionModule = (await import("../src/app/actions")) as ActionsModule;
  const createDecryptionCeremonyAction = getAction(actionModule, "createDecryptionCeremonyAction");
  const generateCoordinatorSharesAction = getAction(actionModule, "generateCoordinatorSharesAction");
  const submitDecryptionShareAction = getAction(actionModule, "submitDecryptionShareAction");
  const closeDecryptionCeremonyAction = getAction(actionModule, "closeDecryptionCeremonyAction");
  const computeRealTallyAction = getAction(actionModule, "computeRealTallyAction");
  const createProcessingBatchAction = getAction(actionModule, "createProcessingBatchAction");
  const updateProcessingBatchStatusAction = getAction(actionModule, "updateProcessingBatchStatusAction");
  const createTallyJobAction = getAction(actionModule, "createTallyJobAction");
  const publishTranscriptCommitmentAction = getAction(actionModule, "publishTranscriptCommitmentAction");
  const updateTallyJobStatusAction = getAction(actionModule, "updateTallyJobStatusAction");
  const publishActaWithContentAction = getAction(actionModule, "publishActaWithContentAction");
  const generateZkProofAction = getAction(actionModule, "generateZkProofAction");
  const submitOnchainZkProofAction = getAction(actionModule, "submitOnchainZkProofAction");
  const createResultPayloadAction = getAction(actionModule, "createResultPayloadAction");
  const advanceToResultsPublishedAction = getAction(actionModule, "advanceToResultsPublishedAction");
  const openAuditWindowAction = getAction(actionModule, "openAuditWindowAction");
  const persistAuditBundleAction = getAction(actionModule, "persistAuditBundleAction");

  const authorityWallet = new NonceManager(new ethers.Wallet(AEA_PRIVATE_KEY, provider));
  const reaWallet = new ethers.Wallet(REA_PRIVATE_KEY, provider);
  const authorityAddress = await authorityWallet.getAddress();
  const registryAuthority = authorityAddress;
  const coordinatorPubKey = await deriveCoordinatorPublicKey(COORDINATOR_PRIVATE_KEY);
  const stamp = Date.now();
  const candidatesCatalog = [
    {
      id: `smoke-${stamp}-cand-a`,
      candidateCode: "SMKA",
      displayName: "Smoke Candidate A",
      shortName: "Smoke A",
      partyName: "Smoke Party A",
      ballotOrder: 1,
      status: "ACTIVE" as const,
      colorHex: "#1D4ED8",
    },
    {
      id: `smoke-${stamp}-cand-b`,
      candidateCode: "SMKB",
      displayName: "Smoke Candidate B",
      shortName: "Smoke B",
      partyName: "Smoke Party B",
      ballotOrder: 2,
      status: "ACTIVE" as const,
      colorHex: "#0F766E",
    },
  ];

  const manifestBody = {
    manifestVersion: "1",
    protocolVersion: "BU-PVP-1",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    title: `Smoke ZK ${stamp}`,
    authority: { address: authorityAddress },
    registryAuthority: { address: registryAuthority },
    coordinatorPubKey,
    notes: "Automated localhost smoke test for zk end-to-end",
    catalogSource: "DB_PROJECTED",
    candidates: candidatesCatalog.map((candidate) => ({ ...candidate, metadata: {} })),
  } as const;

  const manifestHashHex = sha256Hex(canonicalizeJson(manifestBody)).toLowerCase();
  const publicKeyHex = await getPublicKeyHex(AEA_ED25519_PRIVATE_KEY_HEX);
  const signatureHex = await signEd25519Hex(
    utf8ToBytes(manifestHashHex),
    AEA_ED25519_PRIVATE_KEY_HEX,
  );
  const signedManifest = {
    manifest: manifestBody,
    signature: {
      algorithm: "ed25519-sha256-jcs",
      publicKeyHex,
      signatureHex,
      manifestHashHex,
    },
  } as const;

  const registry = getRegistry(ELECTION_REGISTRY_ADDRESS, authorityWallet);
  const createTx = await (registry as any).createElection(
    manifestHashHex,
    registryAuthority,
    coordinatorPubKey,
  );
  const createReceipt = await createTx.wait();
  const electionId = createReceipt
    ? parseElectionCreatedFromReceipt({
        receipt: createReceipt,
        contractAddress: ELECTION_REGISTRY_ADDRESS,
      })
    : null;
  if (electionId === null) {
    throw new Error("Could not parse ElectionCreated receipt");
  }

  for (const candidate of candidatesCatalog) {
    await upsertCandidate({
      pool,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT_ADDRESS,
      electionId,
      id: candidate.id,
      candidateCode: candidate.candidateCode,
      displayName: candidate.displayName,
      shortName: candidate.shortName,
      partyName: candidate.partyName,
      ballotOrder: candidate.ballotOrder,
      status: candidate.status,
      colorHex: candidate.colorHex,
      metadataJson: {},
    });
  }

  await upsertElectionManifest({
    pool,
    chainId: CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    electionId,
    manifestHash: manifestHashHex,
    manifestJson: signedManifest,
    source: "DB_PROJECTED",
  });

  await insertAdminLogEntry({
    pool,
    chainId: CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    electionId,
    code: "SMOKE_ZK_CREATE_ELECTION",
    message: "Automated localhost smoke test election created",
    details: { manifestHashHex },
    evidencePointers: [],
    actorAddress: authorityAddress,
    relatedTxHash: createReceipt?.hash ?? null,
    relatedBlockNumber: createReceipt?.blockNumber ?? null,
    relatedBlockTimestampIso: null,
  });

  const voterWallet = ethers.Wallet.createRandom();
  const votingPubKey = ethers.SigningKey.computePublicKey(voterWallet.privateKey, false);
  const secretHex = ethers.hexlify(ethers.randomBytes(32));
  const registryNullifier = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:nullifier", BigInt(electionId), secretHex],
    ),
  );
  const permitDigest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:signup", BigInt(electionId), registryNullifier],
    ),
  );
  const permitSig = await reaWallet.signMessage(ethers.getBytes(permitDigest));

  const phaseRegistry = new ethers.Contract(ELECTION_REGISTRY_ADDRESS, REGISTRY_ABI, authorityWallet);
  await (await phaseRegistry.openRegistry(BigInt(electionId))).wait();
  await (
    await new ethers.Contract(
      ELECTION_REGISTRY_ADDRESS,
      [
        ...REGISTRY_ABI,
        "function signup(uint256 electionId, bytes32 registryNullifier, bytes votingPubKey, bytes permitSig)",
      ],
      authorityWallet,
    ).signup(BigInt(electionId), registryNullifier, votingPubKey, permitSig)
  ).wait();
  await (await phaseRegistry.closeRegistry(BigInt(electionId))).wait();
  await (await phaseRegistry.openVoting(BigInt(electionId))).wait();

  const ciphertext = await encryptBallotPayload(
    {
      electionId: String(electionId),
      selection: candidatesCatalog[0].id,
      selectionIndex: 0,
      candidateId: candidatesCatalog[0].id,
      candidateCode: candidatesCatalog[0].candidateCode,
      candidateLabel: candidatesCatalog[0].displayName,
      timestamp: Date.now(),
    },
    coordinatorPubKey,
    { scheme: "ZK_FRIENDLY_V2" },
  );
  const ballotBytes = ethers.getBytes(ciphertext);
  const ballotHash = ethers.keccak256(ballotBytes);
  const ballotDigest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:ballot", BigInt(electionId), ballotHash],
    ),
  );
  const ballotSig = await voterWallet.signMessage(ethers.getBytes(ballotDigest));
  await (
    await new ethers.Contract(
      ELECTION_REGISTRY_ADDRESS,
      [
        ...REGISTRY_ABI,
        "function publishBallot(uint256 electionId, bytes votingPubKey, bytes ciphertext, bytes ballotSig)",
      ],
      authorityWallet,
    ).publishBallot(BigInt(electionId), votingPubKey, ballotBytes, ballotSig)
  ).wait();
  await (await phaseRegistry.closeVoting(BigInt(electionId))).wait();
  await (await phaseRegistry.startProcessing(BigInt(electionId))).wait();
  await (await phaseRegistry.finalizeProcessing(BigInt(electionId))).wait();

  await waitFor(
    "indexer signup_records",
    async () => {
      const result = await pool.query(
        `SELECT 1 FROM signup_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 LIMIT 1`,
        [CHAIN_ID, CONTRACT_ADDRESS, electionId],
      );
      return result.rowCount ? true : null;
    },
    { timeoutMs: 30_000 },
  );

  await waitFor(
    "indexer ballot_records",
    async () => {
      const result = await pool.query(
        `SELECT 1 FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 LIMIT 1`,
        [CHAIN_ID, CONTRACT_ADDRESS, electionId],
      );
      return result.rowCount ? true : null;
    },
    { timeoutMs: 30_000 },
  );

  const ceremonyRes = await createDecryptionCeremonyAction(String(electionId));
  if (!ceremonyRes.ok || !ceremonyRes.ceremony) {
    throw new Error(ceremonyRes.error ?? "Failed to create decryption ceremony");
  }
  const sharesRes = await generateCoordinatorSharesAction();
  if (!sharesRes.ok) {
    throw new Error(sharesRes.error ?? "Failed to generate coordinator shares");
  }
  for (const [index, trusteeId] of ["TRUSTEE_1", "TRUSTEE_2"].entries()) {
    const shareRes = await submitDecryptionShareAction({
      electionId: String(electionId),
      ceremonyId: ceremonyRes.ceremony.ceremonyId,
      trusteeId,
      sharePayload: sharesRes.shares[index],
    });
    if (!shareRes.ok) {
      throw new Error(shareRes.error ?? `Failed to submit share for ${trusteeId}`);
    }
  }
  const ceremonyCloseRes = await closeDecryptionCeremonyAction({
    electionId: String(electionId),
    ceremonyId: ceremonyRes.ceremony.ceremonyId,
  });
  if (!ceremonyCloseRes.ok) {
    throw new Error(ceremonyCloseRes.error ?? "Failed to close ceremony");
  }

  const tallyRes = await computeRealTallyAction(String(electionId));
  if (!tallyRes.ok) {
    throw new Error(tallyRes.error ?? "Failed to compute tally");
  }

  const batchRes = await createProcessingBatchAction(
    String(electionId),
    tallyRes.ballotsCount,
    tallyRes.merkleRoot,
  );
  if (!batchRes.ok || !batchRes.batchId) {
    throw new Error(batchRes.error ?? "Failed to create processing batch");
  }
  await updateProcessingBatchStatusAction(batchRes.batchId, "RUNNING");
  await updateProcessingBatchStatusAction(batchRes.batchId, "COMPLETED");

  const tallyJobRes = await createTallyJobAction(String(electionId), batchRes.batchId);
  if (!tallyJobRes.ok || !tallyJobRes.jobId) {
    throw new Error(tallyJobRes.error ?? "Failed to create tally job");
  }

  const transcriptHash = tallyRes.transcriptHash;
  const commitmentPayload = ethers.solidityPacked(
    ["string", "bytes32", "bytes32", "uint256"],
    [
      "BU-PVP-1:TALLY_TRANSCRIPT_V1",
      tallyRes.merkleRoot,
      transcriptHash,
      BigInt(tallyRes.ballotsCount),
    ],
  );
  const commitmentRes = await publishTranscriptCommitmentAction(
    String(electionId),
    commitmentPayload,
  );
  if (!commitmentRes.ok || !commitmentRes.txHash) {
    throw new Error(commitmentRes.error ?? "Failed to publish transcript commitment");
  }
  await updateTallyJobStatusAction(
    tallyJobRes.jobId,
    "COMPLETED",
    "TRANSCRIPT_COMMITTED",
    commitmentRes.txHash,
    {
      summary: tallyRes.summary,
      validCount: tallyRes.validCount,
      invalidCount: tallyRes.invalidCount,
      ballotsCount: tallyRes.ballotsCount,
      merkleRoot: tallyRes.merkleRoot,
      merkleRootPoseidon: tallyRes.merkleRootPoseidon,
      transcriptHash,
    },
  );

  const actaEscrutinioRes = await publishActaWithContentAction(
    String(electionId),
    {
      kind: "ACTA_ESCRUTINIO",
      electionId,
      tallyMode: "REAL_TRANSCRIPT_COMMITTED",
      note: "Automated localhost smoke test tally commitment.",
      totalProcessed: tallyRes.ballotsCount,
      validBallots: tallyRes.validCount,
      invalidBallots: tallyRes.invalidCount,
      summary: tallyRes.summary,
      merkleRoot: tallyRes.merkleRoot,
      merkleRootPoseidon: tallyRes.merkleRootPoseidon,
      transcriptHash,
      commitmentPayload,
      timestamp: new Date().toISOString(),
    },
    2,
  );
  if (!actaEscrutinioRes.ok) {
    throw new Error(actaEscrutinioRes.error ?? "Failed to publish tally acta");
  }

  const zkRes = await generateZkProofAction(
    String(electionId),
    tallyRes.transcript,
    tallyJobRes.jobId,
  );
  if (!zkRes.ok) {
    throw new Error(zkRes.error ?? "Failed to generate zk proof");
  }

  const onchainRes = await submitOnchainZkProofAction(String(electionId));
  if (!onchainRes.ok || !onchainRes.publicationReady) {
    throw new Error(onchainRes.error ?? "On-chain proof verification did not reach ready state");
  }

  const resultJson = {
    electionId: String(electionId),
    tallyJobId: tallyJobRes.jobId,
    proofState: "VERIFIED",
    ballotsCount: tallyRes.ballotsCount,
    batchesCount: 1,
    resultMode: "VERIFIED",
    summary: tallyRes.summary,
    validBallots: tallyRes.validCount,
    invalidBallots: tallyRes.invalidCount,
    merkleRoot: tallyRes.merkleRoot,
    merkleRootPoseidon: tallyRes.merkleRootPoseidon,
    transcriptHash,
    commitmentTxHash: commitmentRes.txHash,
    publicationTimestamp: new Date().toISOString(),
  };
  const payloadRes = await createResultPayloadAction(
    String(electionId),
    tallyJobRes.jobId,
    resultJson,
    { proofState: "VERIFIED", resultKind: "TALLY_VERIFIED" },
  );
  if (!payloadRes.ok || !payloadRes.payloadHash) {
    throw new Error(payloadRes.error ?? "Failed to create result payload");
  }

  const actaResultadosRes = await publishActaWithContentAction(
    String(electionId),
    {
      kind: "ACTA_RESULTADOS",
      electionId,
      tallyMode: "REAL_ZK_VERIFIED",
      note: "Automated localhost smoke test final results.",
      summary: tallyRes.summary,
      validBallots: tallyRes.validCount,
      invalidBallots: tallyRes.invalidCount,
      payloadHash: payloadRes.payloadHash,
      timestamp: new Date().toISOString(),
    },
    3,
  );
  if (!actaResultadosRes.ok) {
    throw new Error(actaResultadosRes.error ?? "Failed to publish results acta");
  }

  const publishRes = await advanceToResultsPublishedAction(String(electionId));
  if (!publishRes.ok || !publishRes.txHash) {
    throw new Error(publishRes.error ?? "Failed to publish final results phase");
  }

  const auditWindowRes = await openAuditWindowAction(String(electionId));
  if (!auditWindowRes.ok) {
    throw new Error(auditWindowRes.error ?? "Failed to open audit window");
  }

  const auditBundleRes = await persistAuditBundleAction(String(electionId));
  if (!auditBundleRes.ok || !auditBundleRes.bundleHash) {
    throw new Error(auditBundleRes.error ?? "Failed to persist audit bundle");
  }

  const finalRegistry = new ethers.Contract(
    ELECTION_REGISTRY_ADDRESS,
    [
      ...REGISTRY_ABI,
      "function tallyProofVerified(uint256) view returns (bool)",
      "function decryptionProofVerified(uint256) view returns (bool)",
    ],
    provider,
  );
  const election = await finalRegistry.getElection(BigInt(electionId));

  console.log(
    JSON.stringify(
      {
        ok: true,
        electionId,
        phase: Number(election.phase),
        tallyProofVerified: await finalRegistry.tallyProofVerified(BigInt(electionId)),
        decryptionProofVerified: await finalRegistry.decryptionProofVerified(BigInt(electionId)),
        signupCount: String(await finalRegistry.signupCount(BigInt(electionId))),
        ballotCount: String(await finalRegistry.ballotCount(BigInt(electionId))),
        tx: {
          createElection: createReceipt?.hash ?? null,
          transcriptCommitment: commitmentRes.txHash,
          actaEscrutinio: actaEscrutinioRes.txHash ?? null,
          tallyProofOnchain: onchainRes.tallyTxHash ?? null,
          decryptionProofOnchain: onchainRes.decryptionTxHash ?? null,
          actaResultados: actaResultadosRes.txHash ?? null,
          publishResults: publishRes.txHash,
          openAuditWindow: auditWindowRes.txHash ?? null,
        },
        ids: {
          tallyJobId: tallyJobRes.jobId,
          tallyProofJobId: zkRes.jobId,
          decryptionProofJobId: zkRes.decryptionProofJob?.jobId ?? null,
        },
        payloadHash: payloadRes.payloadHash,
        auditBundleHash: auditBundleRes.bundleHash,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
