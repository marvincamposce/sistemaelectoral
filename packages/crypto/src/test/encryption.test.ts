import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBallotCiphertextEnvelope,
  decryptBallotPayload,
  encryptBallotPayload,
  generateExperimentalVotingKeypair,
} from "../encryption.js";

test("encryptBallotPayload/decryptBallotPayload roundtrip", () => {
  const coordinator = generateExperimentalVotingKeypair();
  const ballotPayload = {
    electionId: "42",
    selection: "CANDIDATO_A",
    timestamp: 1760000000000,
  };

  const ciphertext = encryptBallotPayload(ballotPayload, coordinator.publicKey);
  const envelope = decodeBallotCiphertextEnvelope(ciphertext);

  assert.equal(envelope.version, "BU-PVP-1_BALLOT_X25519_XCHACHA20_V1");
  assert.equal(envelope.kdf, "X25519");
  assert.equal(envelope.aead, "XCHACHA20POLY1305");

  const decrypted = decryptBallotPayload(ciphertext, coordinator.privateKey);
  assert.deepEqual(decrypted, ballotPayload);
});

test("decryptBallotPayload fails with tampered ciphertext", () => {
  const coordinator = generateExperimentalVotingKeypair();
  const ciphertext = encryptBallotPayload({ selection: "CANDIDATO_B" }, coordinator.publicKey);

  const envelope = decodeBallotCiphertextEnvelope(ciphertext);
  const tamperedEnvelope = {
    ...envelope,
    ciphertextHex: envelope.ciphertextHex.slice(0, -2) + "00",
  };

  const tamperedCiphertext = Buffer.from(JSON.stringify(tamperedEnvelope), "utf8").toString("hex");

  assert.throws(() => {
    decryptBallotPayload(`0x${tamperedCiphertext}`, coordinator.privateKey);
  });
});
