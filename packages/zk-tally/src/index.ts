/**
 * @blockurna/zk-tally — Groth16 Prover & Verifier for TallyVerifier circuit
 *
 * This module provides functions to:
 *   1. Build a witness from a tally transcript
 *   2. Generate a Groth16 proof
 *   3. Verify a proof off-chain
 *
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPoseidon } from "circomlibjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

// Circuit parameters — must match compile-time constants
export const MAX_BALLOTS = 64;
export const NUM_CANDIDATES = 4;
export const INVALID_SELECTION = NUM_CANDIDATES; // value 4 = invalid/unused
export const MERKLE_TREE_DEPTH = 6;

export const TALLY_CIRCUIT_ID = "TallyVerifier_4x64";
export const DECRYPTION_CIRCUIT_ID = "DecryptionVerifier_4x64";
export const CIRCUIT_ID = TALLY_CIRCUIT_ID;
export const PROOF_SYSTEM = "GROTH16_BN128";
export type ZkCircuitKind = "TALLY" | "DECRYPTION";

export type ZkBackend = "rust";
export const ZK_BACKEND: ZkBackend = "rust";

// Paths to build artifacts and keys
type CircuitPaths = {
  r1cs: string;
  wasm: string;
  zkey: string;
  rustProvingKey: string;
  rustVerifyingKey: string;
  vkey: string;
};

const RUST_BINARY_PATH = resolve(PKG_ROOT, "rust-backend/target/release/zk_tally_rs");

export const PATHS: CircuitPaths = {
  r1cs: resolve(PKG_ROOT, "build/tally_verifier.r1cs"),
  wasm: resolve(PKG_ROOT, "build/tally_verifier_js/tally_verifier.wasm"),
  zkey: resolve(PKG_ROOT, "keys/tally_verifier_final.zkey"),
  rustProvingKey: resolve(PKG_ROOT, "keys/tally_verifier_rust.pk.bin"),
  rustVerifyingKey: resolve(PKG_ROOT, "keys/tally_verifier_rust.vk.bin"),
  vkey: resolve(PKG_ROOT, "keys/verification_key.json"),
};

export const DECRYPTION_PATHS: CircuitPaths = {
  r1cs: resolve(PKG_ROOT, "build/decryption_verifier.r1cs"),
  wasm: resolve(PKG_ROOT, "build/decryption_verifier_js/decryption_verifier.wasm"),
  zkey: resolve(PKG_ROOT, "keys/decryption_verifier_final.zkey"),
  rustProvingKey: resolve(PKG_ROOT, "keys/decryption_verifier_rust.pk.bin"),
  rustVerifyingKey: resolve(PKG_ROOT, "keys/decryption_verifier_rust.vk.bin"),
  vkey: resolve(PKG_ROOT, "keys/verification_key_decryption.json"),
};

function getCircuitConfig(circuit: ZkCircuitKind): {
  circuitId: string;
  paths: CircuitPaths;
} {
  if (circuit === "DECRYPTION") {
    return {
      circuitId: DECRYPTION_CIRCUIT_ID,
      paths: DECRYPTION_PATHS,
    };
  }

  return {
    circuitId: TALLY_CIRCUIT_ID,
    paths: PATHS,
  };
}

export interface TallyWitnessInput {
  /** Vote count per candidate (length = NUM_CANDIDATES) */
  voteCounts: string[];
  /** Total number of valid ballots */
  totalValid: string;
  /** Selection per ballot slot (length = MAX_BALLOTS), values 0..NUM_CANDIDATES */
  selections: string[];
  /** Poseidon Merkle root over ballot hashes */
  merkleRoot: string;
  /** Leaf value per slot (length = MAX_BALLOTS) */
  ballotHashes: string[];
  /** Sibling path per slot (MAX_BALLOTS x MERKLE_TREE_DEPTH) */
  merkleProofs: string[][];
  /** Path direction bits per slot (MAX_BALLOTS x MERKLE_TREE_DEPTH) */
  merklePathIndices: string[][];
}

export interface TallyMerkleBundleInput {
  merkleRoot: string;
  ballotHashes: string[];
  merkleProofs: string[][];
  merklePathIndices: string[][];
}

export interface DecryptionWitnessInput {
  /** Vote count per candidate (length = NUM_CANDIDATES) */
  voteCounts: string[];
  /** Total number of valid ballots */
  totalValid: string;
  /** Compact public commitment over decryption witness lanes */
  decryptionCommitment: string;
  /** Active slot selector (length = MAX_BALLOTS): 1=real ballot, 0=padding */
  activeSlots: string[];
  /** Decrypted selection index per slot (length = MAX_BALLOTS), values 0..NUM_CANDIDATES */
  selections: string[];
  /** selectionCiphertext lane value per slot */
  selectionCiphertexts: string[];
  /** Nonce field per slot */
  selectionNonces: string[];
  /** Shared-key field per slot */
  selectionSharedKeys: string[];
}

export interface ZkTallyProofResult {
  proof: object;
  publicSignals: string[];
  proofSystem: string;
  circuitId: string;
  /** SHA-256 of verification key file for integrity */
  verificationKeyHash: string;
}

export interface ZkTallyVerifyResult {
  valid: boolean;
  proofSystem: string;
  circuitId: string;
}

export interface DecryptionWitnessEntry {
  selectionCiphertext: string;
  selectionNonce: string;
  selectionSharedKey: string;
  decryptedSelection: string;
}

export interface BuildDecryptionWitnessParams {
  summary: Record<string, number>;
  candidateOrder: string[];
  /** Per-real-ballot witness entries in deterministic ballot order */
  entries: DecryptionWitnessEntry[];
}

type PoseidonFn = ((inputs: bigint[]) => unknown) & {
  F: {
    toObject(value: unknown): bigint;
  };
};

let poseidonPromise: Promise<PoseidonFn> | undefined;

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function normalizeField(value: bigint): bigint {
  const modded = value % FIELD_MODULUS;
  return modded >= 0n ? modded : modded + FIELD_MODULUS;
}

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon().then((poseidon: unknown) => poseidon as PoseidonFn);
  }
  return poseidonPromise;
}

async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const out = poseidon(inputs.map((value) => normalizeField(value)));
  return normalizeField(BigInt(poseidon.F.toObject(out)));
}

/**
 * Build witness input from a real tally transcript.
 *
 * @param transcript - The tally transcript produced by computeRealTallyAction
 * @param candidateOrder - Ordered list of candidate keys matching the circuit's index mapping
 */
export function buildWitnessFromTranscript(
  transcript: {
    summary: Record<string, number>;
    ballots: Array<{ selection: string }>;
    ballotsCount: number;
    decryptedValidCount: number;
    invalidCount: number;
  },
  candidateOrder: string[],
  merkleBundle: TallyMerkleBundleInput,
): TallyWitnessInput {
  if (candidateOrder.length !== NUM_CANDIDATES) {
    throw new Error(
      `candidateOrder must have exactly ${NUM_CANDIDATES} entries, got ${candidateOrder.length}`,
    );
  }

  if (transcript.ballotsCount > MAX_BALLOTS) {
    throw new Error(
      `Circuit supports max ${MAX_BALLOTS} ballots, transcript has ${transcript.ballotsCount}`,
    );
  }

  if (!merkleBundle || typeof merkleBundle !== "object") {
    throw new Error("merkleBundle is required for Phase 9B witness generation");
  }

  if (merkleBundle.ballotHashes.length !== MAX_BALLOTS) {
    throw new Error(
      `merkleBundle.ballotHashes must have length ${MAX_BALLOTS}, got ${merkleBundle.ballotHashes.length}`,
    );
  }

  if (merkleBundle.merkleProofs.length !== MAX_BALLOTS) {
    throw new Error(
      `merkleBundle.merkleProofs must have length ${MAX_BALLOTS}, got ${merkleBundle.merkleProofs.length}`,
    );
  }

  if (merkleBundle.merklePathIndices.length !== MAX_BALLOTS) {
    throw new Error(
      `merkleBundle.merklePathIndices must have length ${MAX_BALLOTS}, got ${merkleBundle.merklePathIndices.length}`,
    );
  }

  for (let i = 0; i < MAX_BALLOTS; i++) {
    const proof = merkleBundle.merkleProofs[i] ?? [];
    const indices = merkleBundle.merklePathIndices[i] ?? [];

    if (proof.length !== MERKLE_TREE_DEPTH) {
      throw new Error(
        `merkle proof at index ${i} must have depth ${MERKLE_TREE_DEPTH}, got ${proof.length}`,
      );
    }

    if (indices.length !== MERKLE_TREE_DEPTH) {
      throw new Error(
        `merkle path indices at index ${i} must have depth ${MERKLE_TREE_DEPTH}, got ${indices.length}`,
      );
    }

    for (let d = 0; d < MERKLE_TREE_DEPTH; d++) {
      const direction = String(indices[d]);
      if (direction !== "0" && direction !== "1") {
        throw new Error(
          `merkle path index must be 0 or 1 at [${i}][${d}], got ${direction}`,
        );
      }
    }
  }

  // Map candidate name → circuit index
  const candidateIndex = new Map<string, number>();
  for (let i = 0; i < candidateOrder.length; i++) {
    candidateIndex.set(candidateOrder[i]!, i);
  }

  // Build voteCounts array
  const voteCounts: string[] = candidateOrder.map(
    (name) => String(transcript.summary[name] ?? 0),
  );

  // Build selections array (pad unused slots with INVALID_SELECTION)
  const selections: string[] = new Array(MAX_BALLOTS).fill(
    String(INVALID_SELECTION),
  );

  for (let i = 0; i < transcript.ballots.length; i++) {
    const ballot = transcript.ballots[i]!;
    const idx = candidateIndex.get(ballot.selection);
    if (idx !== undefined) {
      selections[i] = String(idx);
    } else {
      // Unknown selection → mark as invalid
      selections[i] = String(INVALID_SELECTION);
    }
  }

  return {
    voteCounts,
    totalValid: String(transcript.decryptedValidCount),
    selections,
    merkleRoot: String(merkleBundle.merkleRoot),
    ballotHashes: merkleBundle.ballotHashes.map((value) => String(value)),
    merkleProofs: merkleBundle.merkleProofs.map((proof) => proof.map((value) => String(value))),
    merklePathIndices: merkleBundle.merklePathIndices.map((indices) =>
      indices.map((value) => String(value)),
    ),
  };
}

/**
 * Build witness input for decryption verification circuit (Phase 9D).
 */
export async function buildDecryptionWitness(params: BuildDecryptionWitnessParams): Promise<DecryptionWitnessInput> {
  const { summary, candidateOrder, entries } = params;

  if (candidateOrder.length !== NUM_CANDIDATES) {
    throw new Error(
      `candidateOrder must have exactly ${NUM_CANDIDATES} entries, got ${candidateOrder.length}`,
    );
  }

  if (entries.length > MAX_BALLOTS) {
    throw new Error(
      `decryption witness supports max ${MAX_BALLOTS} entries, got ${entries.length}`,
    );
  }

  const voteCounts = candidateOrder.map((name) => String(summary[name] ?? 0));

  const activeSlots: string[] = new Array(MAX_BALLOTS).fill("0");
  const selections: string[] = new Array(MAX_BALLOTS).fill(String(INVALID_SELECTION));
  const selectionCiphertexts: string[] = new Array(MAX_BALLOTS).fill("0");
  const selectionNonces: string[] = new Array(MAX_BALLOTS).fill("0");
  const selectionSharedKeys: string[] = new Array(MAX_BALLOTS).fill("0");

  let totalValid = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const decryptedSelection = Number(entry.decryptedSelection);
    if (!Number.isInteger(decryptedSelection) || decryptedSelection < 0 || decryptedSelection > INVALID_SELECTION) {
      throw new Error(`Invalid decryptedSelection at index ${i}: ${entry.decryptedSelection}`);
    }

    activeSlots[i] = "1";
    selections[i] = String(decryptedSelection);
    selectionCiphertexts[i] = String(entry.selectionCiphertext);
    selectionNonces[i] = String(entry.selectionNonce);
    selectionSharedKeys[i] = String(entry.selectionSharedKey);

    if (decryptedSelection < NUM_CANDIDATES) {
      totalValid += 1;
    }
  }

  let decryptionCommitment = 0n;
  for (let i = 0; i < MAX_BALLOTS; i++) {
    decryptionCommitment = await poseidonHash([
      decryptionCommitment,
      BigInt(selectionCiphertexts[i] ?? "0"),
      BigInt(selectionNonces[i] ?? "0"),
      BigInt(selectionSharedKeys[i] ?? "0"),
      BigInt(selections[i] ?? String(INVALID_SELECTION)),
    ]);
  }

  return {
    voteCounts,
    totalValid: String(totalValid),
    decryptionCommitment: decryptionCommitment.toString(),
    activeSlots,
    selections,
    selectionCiphertexts,
    selectionNonces,
    selectionSharedKeys,
  };
}

/**
 * Check that all required build artifacts exist.
 */
export function checkArtifacts(): { ok: boolean; missing: string[] } {
  return checkArtifactsForCircuit("TALLY");
}

export function checkArtifactsForCircuit(circuit: ZkCircuitKind): {
  ok: boolean;
  missing: string[];
} {
  const { paths } = getCircuitConfig(circuit);
  const missing: string[] = [];

  const requiredPaths: Array<[string, string]> = [
    ["r1cs", paths.r1cs],
    ["wasm", paths.wasm],
    ["rustBinary", RUST_BINARY_PATH],
    ["rustProvingKey", paths.rustProvingKey],
    ["rustVerifyingKey", paths.rustVerifyingKey],
    ["vkey", paths.vkey],
  ];

  for (const [name, path] of requiredPaths) {
    if (!existsSync(path)) {
      missing.push(`${name}: ${path}`);
    }
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Generate a Groth16 proof for the tally verification circuit.
 */
export async function proveTally(
  input: TallyWitnessInput,
): Promise<ZkTallyProofResult> {
  const artifacts = checkArtifactsForCircuit("TALLY");
  if (!artifacts.ok) {
    throw new Error(
      `Missing ZK artifacts: ${artifacts.missing.join(", ")}. Run setup.sh first.`,
    );
  }

  const { paths, circuitId } = getCircuitConfig("TALLY");

  const proofOutput = proveWithRust(input as unknown as Record<string, unknown>, paths);

  // Compute vkey hash for integrity
  const { createHash } = await import("node:crypto");
  const vkeyContent = readFileSync(paths.vkey);
  const verificationKeyHash = createHash("sha256")
    .update(vkeyContent)
    .digest("hex");

  return {
    proof: proofOutput.proof,
    publicSignals: proofOutput.publicSignals,
    proofSystem: PROOF_SYSTEM,
    circuitId,
    verificationKeyHash,
  };
}

export async function proveDecryption(
  input: DecryptionWitnessInput,
): Promise<ZkTallyProofResult> {
  const artifacts = checkArtifactsForCircuit("DECRYPTION");
  if (!artifacts.ok) {
    throw new Error(
      `Missing ZK artifacts: ${artifacts.missing.join(", ")}. Run setup.sh first.`,
    );
  }

  const { paths, circuitId } = getCircuitConfig("DECRYPTION");

  const proofOutput = proveWithRust(input as unknown as Record<string, unknown>, paths);

  const { createHash } = await import("node:crypto");
  const vkeyContent = readFileSync(paths.vkey);
  const verificationKeyHash = createHash("sha256")
    .update(vkeyContent)
    .digest("hex");

  return {
    proof: proofOutput.proof,
    publicSignals: proofOutput.publicSignals,
    proofSystem: PROOF_SYSTEM,
    circuitId,
    verificationKeyHash,
  };
}

/**
 * Verify a Groth16 proof off-chain.
 */
export async function verifyTallyProof(
  proof: object,
  publicSignals: string[],
): Promise<ZkTallyVerifyResult> {
  return verifyProofForCircuit("TALLY", proof, publicSignals);
}

export async function verifyDecryptionProof(
  proof: object,
  publicSignals: string[],
): Promise<ZkTallyVerifyResult> {
  return verifyProofForCircuit("DECRYPTION", proof, publicSignals);
}

async function verifyProofForCircuit(
  circuit: ZkCircuitKind,
  proof: object,
  publicSignals: string[],
): Promise<ZkTallyVerifyResult> {
  const { paths, circuitId } = getCircuitConfig(circuit);
  const valid = verifyWithRust(paths, proof, publicSignals);

  return {
    valid: Boolean(valid),
    proofSystem: PROOF_SYSTEM,
    circuitId,
  };
}

function proveWithRust(
  input: Record<string, unknown>,
  paths: CircuitPaths,
): { proof: object; publicSignals: string[] } {
  const args = [
    "prove",
    "--wasm",
    paths.wasm,
    "--r1cs",
    paths.r1cs,
    "--proving-key",
    paths.rustProvingKey,
  ];

  const result = spawnSync(RUST_BINARY_PATH, args, {
    input: JSON.stringify(input),
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Rust prover execution failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`Rust prover failed with exit code ${result.status}: ${details}`);
  }

  const payload = (result.stdout || "").trim();
  if (!payload) {
    throw new Error("Rust prover returned empty output");
  }

  const parsed = JSON.parse(payload) as {
    proof?: object;
    public_signals?: Array<string | number>;
  };

  if (!parsed.proof || !Array.isArray(parsed.public_signals)) {
    throw new Error("Rust prover returned malformed JSON output");
  }

  return {
    proof: parsed.proof,
    publicSignals: parsed.public_signals.map((value) => String(value)),
  };
}

function verifyWithRust(paths: CircuitPaths, proof: object, publicSignals: string[]): boolean {
  const args = [
    "verify",
    "--verifying-key",
    paths.rustVerifyingKey,
  ];

  const result = spawnSync(RUST_BINARY_PATH, args, {
    input: JSON.stringify({ proof, public_signals: publicSignals }),
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Rust verifier execution failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`Rust verifier failed with exit code ${result.status}: ${details}`);
  }

  const payload = (result.stdout || "").trim();
  if (!payload) {
    throw new Error("Rust verifier returned empty output");
  }

  const parsed = JSON.parse(payload) as { valid?: boolean };
  if (typeof parsed.valid !== "boolean") {
    throw new Error("Rust verifier returned malformed JSON output");
  }

  return parsed.valid;
}

/**
 * Parse public signals back into human-readable form.
 * Public signals order matches circuit declaration:
 *   voteCounts[0..3], totalValid, merkleRoot
 */
export function parsePublicSignals(
  publicSignals: string[],
  candidateOrder: string[],
): {
  voteCounts: Record<string, number>;
  totalValid: number;
  merkleRoot: string;
} {
  const voteCounts: Record<string, number> = {};
  for (let i = 0; i < NUM_CANDIDATES; i++) {
    const name = candidateOrder[i] ?? `candidate_${i}`;
    voteCounts[name] = Number(publicSignals[i]);
  }

  const merkleRootIndex = NUM_CANDIDATES + 1;
  return {
    voteCounts,
    totalValid: Number(publicSignals[NUM_CANDIDATES]),
    merkleRoot: String(publicSignals[merkleRootIndex] ?? ""),
  };
}

/**
 * Parse decryption verifier public signals.
 * Public signals order matches decryption circuit declaration:
 *   voteCounts[0..3], totalValid, decryptionCommitment
 */
export function parseDecryptionPublicSignals(
  publicSignals: string[],
  candidateOrder: string[],
): {
  voteCounts: Record<string, number>;
  totalValid: number;
  decryptionCommitment: string;
} {
  const voteCounts: Record<string, number> = {};
  for (let i = 0; i < NUM_CANDIDATES; i++) {
    const name = candidateOrder[i] ?? `candidate_${i}`;
    voteCounts[name] = Number(publicSignals[i]);
  }

  const commitmentIndex = NUM_CANDIDATES + 1;
  return {
    voteCounts,
    totalValid: Number(publicSignals[NUM_CANDIDATES]),
    decryptionCommitment: String(publicSignals[commitmentIndex] ?? ""),
  };
}
