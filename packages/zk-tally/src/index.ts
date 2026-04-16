/**
 * @blockurna/zk-tally — Groth16 Prover & Verifier for TallyVerifier circuit
 *
 * This module provides functions to:
 *   1. Build a witness from a tally transcript
 *   2. Generate a Groth16 proof
 *   3. Verify a proof off-chain
 *
 * All operations use snarkjs programmatic API.
 */

import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

// Circuit parameters — must match compile-time constants
export const MAX_BALLOTS = 64;
export const NUM_CANDIDATES = 4;
export const INVALID_SELECTION = NUM_CANDIDATES; // value 4 = invalid/unused

export const CIRCUIT_ID = "TallyVerifier_4x64";
export const PROOF_SYSTEM = "GROTH16_BN128";

// Paths to build artifacts and keys
export const PATHS = {
  wasm: resolve(PKG_ROOT, "build/tally_verifier_js/tally_verifier.wasm"),
  zkey: resolve(PKG_ROOT, "keys/tally_verifier_final.zkey"),
  vkey: resolve(PKG_ROOT, "keys/verification_key.json"),
};

export interface TallyWitnessInput {
  /** Vote count per candidate (length = NUM_CANDIDATES) */
  voteCounts: string[];
  /** Total number of valid ballots */
  totalValid: string;
  /** Selection per ballot slot (length = MAX_BALLOTS), values 0..NUM_CANDIDATES */
  selections: string[];
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
  };
}

/**
 * Check that all required build artifacts exist.
 */
export function checkArtifacts(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [name, path] of Object.entries(PATHS)) {
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

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
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
    proof,
    publicSignals,
    proofSystem: PROOF_SYSTEM,
    circuitId: CIRCUIT_ID,
    verificationKeyHash,
  };
}

/**
 * Verify a Groth16 proof off-chain using snarkjs.
 */
export async function verifyTallyProof(
  proof: object,
  publicSignals: string[],
): Promise<ZkTallyVerifyResult> {
  const vkeyJson = JSON.parse(readFileSync(PATHS.vkey, "utf-8"));
  const valid = await snarkjs.groth16.verify(vkeyJson, publicSignals, proof);

  return {
    valid: Boolean(valid),
    proofSystem: PROOF_SYSTEM,
    circuitId: CIRCUIT_ID,
  };
}

/**
 * Parse public signals back into human-readable form.
 * Public signals order matches circuit declaration:
 *   voteCounts[0..3], totalValid
 */
export function parsePublicSignals(
  publicSignals: string[],
  candidateOrder: string[],
): {
  voteCounts: Record<string, number>;
  totalValid: number;
} {
  const voteCounts: Record<string, number> = {};
  for (let i = 0; i < NUM_CANDIDATES; i++) {
    const name = candidateOrder[i] ?? `candidate_${i}`;
    voteCounts[name] = Number(publicSignals[i]);
  }
  return {
    voteCounts,
    totalValid: Number(publicSignals[NUM_CANDIDATES]),
  };
}
