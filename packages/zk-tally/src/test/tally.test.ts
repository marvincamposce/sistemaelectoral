/**
 * End-to-end test: Generate a ZK proof for a known tally and verify it.
 *
 * Test scenario:
 *   - 10 ballots total
 *   - 4 candidates: CANDIDATO_A(3), CANDIDATO_B(4), CANDIDATO_C(2), ABSTENCION(1)
 *   - 10 valid, 0 invalid
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPoseidon } from "circomlibjs";
import {
  buildWitnessFromTranscript,
  proveTally,
  verifyTallyProof,
  parsePublicSignals,
  checkArtifacts,
  MAX_BALLOTS,
  MERKLE_TREE_DEPTH,
  INVALID_SELECTION,
  CIRCUIT_ID,
  PROOF_SYSTEM,
} from "../index.js";

const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);
const EMPTY_BALLOT_SLOT_HASH_HEX =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

type PoseidonFn = ((inputs: bigint[]) => unknown) & {
  F: {
    toObject: (value: unknown) => bigint;
  };
};

let poseidonPromise: Promise<PoseidonFn> | undefined;

function normalizeField(value: bigint): bigint {
  const reduced = value % FIELD_PRIME;
  return reduced >= 0n ? reduced : reduced + FIELD_PRIME;
}

function parseFieldElement(value: string | bigint): bigint {
  if (typeof value === "bigint") return normalizeField(value);
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return normalizeField(BigInt(value));
  }
  return normalizeField(BigInt(value));
}

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon().then((poseidon: unknown) => poseidon as PoseidonFn);
  }
  return poseidonPromise;
}

async function poseidonHash2(left: bigint, right: bigint): Promise<bigint> {
  const poseidon = await getPoseidon();
  const out = poseidon([normalizeField(left), normalizeField(right)]);
  return normalizeField(poseidon.F.toObject(out));
}

async function buildMerkleBundle(ballotsCount: number) {
  const hashesHex: string[] = [];
  for (let i = 0; i < ballotsCount; i++) {
    hashesHex.push(`0x${(i + 2).toString(16).padStart(64, "0")}`);
  }

  const leaves = hashesHex.map((hashHex) => parseFieldElement(hashHex));
  const emptyLeaf = parseFieldElement(EMPTY_BALLOT_SLOT_HASH_HEX);

  while (leaves.length < MAX_BALLOTS) {
    leaves.push(emptyLeaf);
  }

  const levels: bigint[][] = [leaves];
  for (let depth = 0; depth < MERKLE_TREE_DEPTH; depth += 1) {
    const current = levels[depth]!;
    const next: bigint[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(await poseidonHash2(current[i]!, current[i + 1]!));
    }
    levels.push(next);
  }

  const merkleProofs: string[][] = [];
  const merklePathIndices: string[][] = [];

  for (let leafIndex = 0; leafIndex < MAX_BALLOTS; leafIndex += 1) {
    const proof: string[] = [];
    const indices: string[] = [];
    let indexAtLevel = leafIndex;

    for (let depth = 0; depth < MERKLE_TREE_DEPTH; depth += 1) {
      const level = levels[depth]!;
      const siblingIndex = indexAtLevel ^ 1;
      proof.push(level[siblingIndex]!.toString());
      indices.push(String(indexAtLevel & 1));
      indexAtLevel = Math.floor(indexAtLevel / 2);
    }

    merkleProofs.push(proof);
    merklePathIndices.push(indices);
  }

  return {
    merkleRoot: levels[MERKLE_TREE_DEPTH]![0]!.toString(),
    ballotHashes: leaves.map((value) => value.toString()),
    merkleProofs,
    merklePathIndices,
  };
}

describe("TallyVerifier ZK Proof (Groth16)", () => {
  const candidateOrder = [
    "CANDIDATO_A",
    "CANDIDATO_B",
    "CANDIDATO_C",
    "ABSTENCION",
  ];

  const artifactCheck = checkArtifacts();
  const proofTestsSkip = artifactCheck.ok
    ? false
    : `Missing artifacts: ${artifactCheck.missing.join(", ")}. Run bash scripts/setup.sh`;

  it("should have all build artifacts available", { skip: proofTestsSkip }, () => {
    assert.ok(artifactCheck.ok, `Missing artifacts: ${artifactCheck.missing.join(", ")}`);
  });

  it("should build correct witness from transcript", async () => {
    const transcript = {
      summary: {
        CANDIDATO_A: 3,
        CANDIDATO_B: 4,
        CANDIDATO_C: 2,
        ABSTENCION: 1,
      },
      ballots: [
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_B" },
        { selection: "CANDIDATO_C" },
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_B" },
        { selection: "CANDIDATO_B" },
        { selection: "ABSTENCION" },
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_C" },
        { selection: "CANDIDATO_B" },
      ],
      ballotsCount: 10,
      decryptedValidCount: 10,
      invalidCount: 0,
    };

    const merkleBundle = await buildMerkleBundle(10);
    const witness = buildWitnessFromTranscript(
      transcript,
      candidateOrder,
      merkleBundle,
    );

    assert.deepStrictEqual(witness.voteCounts, ["3", "4", "2", "1"]);
    assert.strictEqual(witness.totalValid, "10");
    assert.strictEqual(witness.selections.length, MAX_BALLOTS);
    assert.strictEqual(witness.ballotHashes.length, MAX_BALLOTS);
    assert.strictEqual(witness.merkleProofs[0]?.length, MERKLE_TREE_DEPTH);
    assert.strictEqual(witness.merklePathIndices[0]?.length, MERKLE_TREE_DEPTH);

    // First 10 should be real selections, rest should be INVALID_SELECTION
    assert.strictEqual(witness.selections[0], "0"); // CANDIDATO_A = index 0
    assert.strictEqual(witness.selections[1], "1"); // CANDIDATO_B = index 1
    assert.strictEqual(witness.selections[10], String(INVALID_SELECTION)); // padding
  });

  it("should generate and verify a valid Groth16 proof", { skip: proofTestsSkip }, async () => {
    const transcript = {
      summary: {
        CANDIDATO_A: 3,
        CANDIDATO_B: 4,
        CANDIDATO_C: 2,
        ABSTENCION: 1,
      },
      ballots: [
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_B" },
        { selection: "CANDIDATO_C" },
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_B" },
        { selection: "CANDIDATO_B" },
        { selection: "ABSTENCION" },
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_C" },
        { selection: "CANDIDATO_B" },
      ],
      ballotsCount: 10,
      decryptedValidCount: 10,
      invalidCount: 0,
    };

    const merkleBundle = await buildMerkleBundle(10);
    const witness = buildWitnessFromTranscript(
      transcript,
      candidateOrder,
      merkleBundle,
    );

    // Generate proof
    console.time("  prove");
    const proofResult = await proveTally(witness);
    console.timeEnd("  prove");

    assert.ok(proofResult.proof, "Proof should be generated");
    assert.ok(proofResult.publicSignals.length > 0, "Should have public signals");
    assert.strictEqual(proofResult.proofSystem, PROOF_SYSTEM);
    assert.strictEqual(proofResult.circuitId, CIRCUIT_ID);
    assert.ok(proofResult.verificationKeyHash.length === 64, "Should have SHA-256 hash");

    // Verify proof
    console.time("  verify");
    const verifyResult = await verifyTallyProof(
      proofResult.proof,
      proofResult.publicSignals,
    );
    console.timeEnd("  verify");

    assert.ok(verifyResult.valid, "Proof should verify successfully");

    // Parse public signals
    const parsed = parsePublicSignals(proofResult.publicSignals, candidateOrder);
    assert.deepStrictEqual(parsed.voteCounts, {
      CANDIDATO_A: 3,
      CANDIDATO_B: 4,
      CANDIDATO_C: 2,
      ABSTENCION: 1,
    });
    assert.strictEqual(parsed.totalValid, 10);
    assert.strictEqual(parsed.merkleRoot, witness.merkleRoot);
  });

  it("should reject a proof with tampered public signals", { skip: proofTestsSkip }, async () => {
    const transcript = {
      summary: { CANDIDATO_A: 2, CANDIDATO_B: 1, CANDIDATO_C: 0, ABSTENCION: 0 },
      ballots: [
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_B" },
        { selection: "CANDIDATO_A" },
      ],
      ballotsCount: 3,
      decryptedValidCount: 3,
      invalidCount: 0,
    };

    const merkleBundle = await buildMerkleBundle(3);
    const witness = buildWitnessFromTranscript(
      transcript,
      candidateOrder,
      merkleBundle,
    );
    const proofResult = await proveTally(witness);

    // Tamper: change CANDIDATO_A from 2 to 3
    const tampered = [...proofResult.publicSignals];
    tampered[0] = "3";

    const verifyResult = await verifyTallyProof(proofResult.proof, tampered);
    assert.ok(!verifyResult.valid, "Tampered proof should be rejected");
  });

  it("should handle election with invalid ballots", { skip: proofTestsSkip }, async () => {
    const transcript = {
      summary: { CANDIDATO_A: 2, CANDIDATO_B: 0, CANDIDATO_C: 0, ABSTENCION: 0 },
      ballots: [
        { selection: "CANDIDATO_A" },
        { selection: "CANDIDATO_A" },
      ],
      ballotsCount: 5, // 5 ballots total but only 2 valid
      decryptedValidCount: 2,
      invalidCount: 3,
    };

    const merkleBundle = await buildMerkleBundle(5);
    const witness = buildWitnessFromTranscript(
      transcript,
      candidateOrder,
      merkleBundle,
    );

    // Only 2 valid selections, rest are INVALID_SELECTION (4)
    assert.strictEqual(witness.selections[0], "0");
    assert.strictEqual(witness.selections[1], "0");
    assert.strictEqual(witness.selections[2], String(INVALID_SELECTION));
    assert.strictEqual(witness.totalValid, "2");

    const proofResult = await proveTally(witness);
    const verifyResult = await verifyTallyProof(
      proofResult.proof,
      proofResult.publicSignals,
    );
    assert.ok(verifyResult.valid, "Proof with invalid ballots should verify");
  });

  it("should reject invalid merkle path index in witness builder", async () => {
    const transcript = {
      summary: { CANDIDATO_A: 1, CANDIDATO_B: 0, CANDIDATO_C: 0, ABSTENCION: 0 },
      ballots: [{ selection: "CANDIDATO_A" }],
      ballotsCount: 1,
      decryptedValidCount: 1,
      invalidCount: 0,
    };

    const merkleBundle = await buildMerkleBundle(1);
    merkleBundle.merklePathIndices[0]![0] = "2";

    assert.throws(() => {
      buildWitnessFromTranscript(transcript, candidateOrder, merkleBundle);
    }, /merkle path index must be 0 or 1/);
  });
});
