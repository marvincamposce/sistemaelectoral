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
import {
  buildWitnessFromTranscript,
  proveTally,
  verifyTallyProof,
  parsePublicSignals,
  checkArtifacts,
  MAX_BALLOTS,
  INVALID_SELECTION,
  CIRCUIT_ID,
  PROOF_SYSTEM,
} from "../index.js";

describe("TallyVerifier ZK Proof (Groth16)", () => {
  const candidateOrder = [
    "CANDIDATO_A",
    "CANDIDATO_B",
    "CANDIDATO_C",
    "ABSTENCION",
  ];

  it("should have all build artifacts available", () => {
    const check = checkArtifacts();
    assert.ok(check.ok, `Missing artifacts: ${check.missing.join(", ")}`);
  });

  it("should build correct witness from transcript", () => {
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

    const witness = buildWitnessFromTranscript(transcript, candidateOrder);

    assert.deepStrictEqual(witness.voteCounts, ["3", "4", "2", "1"]);
    assert.strictEqual(witness.totalValid, "10");
    assert.strictEqual(witness.selections.length, MAX_BALLOTS);

    // First 10 should be real selections, rest should be INVALID_SELECTION
    assert.strictEqual(witness.selections[0], "0"); // CANDIDATO_A = index 0
    assert.strictEqual(witness.selections[1], "1"); // CANDIDATO_B = index 1
    assert.strictEqual(witness.selections[10], String(INVALID_SELECTION)); // padding
  });

  it("should generate and verify a valid Groth16 proof", async () => {
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

    const witness = buildWitnessFromTranscript(transcript, candidateOrder);

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
  });

  it("should reject a proof with tampered public signals", async () => {
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

    const witness = buildWitnessFromTranscript(transcript, candidateOrder);
    const proofResult = await proveTally(witness);

    // Tamper: change CANDIDATO_A from 2 to 3
    const tampered = [...proofResult.publicSignals];
    tampered[0] = "3";

    const verifyResult = await verifyTallyProof(proofResult.proof, tampered);
    assert.ok(!verifyResult.valid, "Tampered proof should be rejected");
  });

  it("should handle election with invalid ballots", async () => {
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

    const witness = buildWitnessFromTranscript(transcript, candidateOrder);

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
});
