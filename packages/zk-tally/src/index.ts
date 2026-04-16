/**
 * @blockurna/zk-tally — Groth16 Prover & Verifier for TallyVerifier circuit
 *
 * This module provides functions to:
 *   1. Build a witness from a tally transcript
 *   2. Generate a Groth16 proof
 *   3. Verify a proof off-chain
 *
 * Backend is selectable via ZK_BACKEND (rust|snarkjs), defaulting to rust.
 */

import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

// Circuit parameters — must match compile-time constants
export const MAX_BALLOTS = 64;
export const NUM_CANDIDATES = 4;
export const INVALID_SELECTION = NUM_CANDIDATES; // value 4 = invalid/unused
export const MERKLE_TREE_DEPTH = 6;

export const CIRCUIT_ID = "TallyVerifier_4x64";
export const PROOF_SYSTEM = "GROTH16_BN128";

export type ZkBackend = "rust" | "snarkjs";

function readBackendFromEnv(): ZkBackend {
  const raw = (process.env.ZK_BACKEND ?? "rust").toLowerCase();
  if (raw === "rust" || raw === "snarkjs") {
    return raw;
  }

  throw new Error(
    `Invalid ZK_BACKEND='${process.env.ZK_BACKEND}'. Use 'rust' or 'snarkjs'.`,
  );
}

export const ZK_BACKEND: ZkBackend = readBackendFromEnv();

// Paths to build artifacts and keys
export const PATHS = {
  r1cs: resolve(PKG_ROOT, "build/tally_verifier.r1cs"),
  wasm: resolve(PKG_ROOT, "build/tally_verifier_js/tally_verifier.wasm"),
  zkey: resolve(PKG_ROOT, "keys/tally_verifier_final.zkey"),
  rustBinary: resolve(PKG_ROOT, "rust-backend/target/release/zk_tally_rs"),
  rustProvingKey: resolve(PKG_ROOT, "keys/tally_verifier_rust.pk.bin"),
  rustVerifyingKey: resolve(PKG_ROOT, "keys/tally_verifier_rust.vk.bin"),
  vkey: resolve(PKG_ROOT, "keys/verification_key.json"),
};

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
 * Check that all required build artifacts exist.
 */
export function checkArtifacts(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  const requiredPaths: Array<[string, string]> =
    ZK_BACKEND === "rust"
      ? [
          ["r1cs", PATHS.r1cs],
          ["wasm", PATHS.wasm],
          ["rustBinary", PATHS.rustBinary],
          ["rustProvingKey", PATHS.rustProvingKey],
          ["rustVerifyingKey", PATHS.rustVerifyingKey],
          ["vkey", PATHS.vkey],
        ]
      : [
          ["wasm", PATHS.wasm],
          ["zkey", PATHS.zkey],
          ["vkey", PATHS.vkey],
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
  const artifacts = checkArtifacts();
  if (!artifacts.ok) {
    throw new Error(
      `Missing ZK artifacts: ${artifacts.missing.join(", ")}. Run setup.sh first.`,
    );
  }

  const proofOutput =
    ZK_BACKEND === "rust"
      ? proveTallyWithRust(input)
      : await snarkjs.groth16.fullProve(
          input as unknown as Record<string, unknown>,
          PATHS.wasm,
          PATHS.zkey,
        );

  // Compute vkey hash for integrity
  const { createHash } = await import("node:crypto");
  const vkeyContent = readFileSync(PATHS.vkey);
  const verificationKeyHash = createHash("sha256")
    .update(vkeyContent)
    .digest("hex");

  return {
    proof: proofOutput.proof,
    publicSignals: proofOutput.publicSignals,
    proofSystem: PROOF_SYSTEM,
    circuitId: CIRCUIT_ID,
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
  const valid =
    ZK_BACKEND === "rust"
      ? verifyTallyWithRust(proof, publicSignals)
      : await verifyTallyWithSnarkjs(proof, publicSignals);

  return {
    valid: Boolean(valid),
    proofSystem: PROOF_SYSTEM,
    circuitId: CIRCUIT_ID,
  };
}

async function verifyTallyWithSnarkjs(
  proof: object,
  publicSignals: string[],
): Promise<boolean> {
  const vkeyJson = JSON.parse(readFileSync(PATHS.vkey, "utf-8"));
  return snarkjs.groth16.verify(vkeyJson, publicSignals, proof);
}

function proveTallyWithRust(
  input: TallyWitnessInput,
): { proof: object; publicSignals: string[] } {
  const args = [
    "prove",
    "--wasm",
    PATHS.wasm,
    "--r1cs",
    PATHS.r1cs,
    "--proving-key",
    PATHS.rustProvingKey,
  ];

  const result = spawnSync(PATHS.rustBinary, args, {
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

function verifyTallyWithRust(proof: object, publicSignals: string[]): boolean {
  const args = [
    "verify",
    "--verifying-key",
    PATHS.rustVerifyingKey,
  ];

  const result = spawnSync(PATHS.rustBinary, args, {
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
