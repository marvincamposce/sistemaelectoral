import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { x25519 } from "@noble/curves/ed25519.js";

import {
  decodeBallotCiphertextEnvelope,
  decryptBallotPayload,
  encryptBallotPayload,
  generateExperimentalVotingKeypair,
} from "../encryption.js";

test("encryptBallotPayload/decryptBallotPayload roundtrip (zk-friendly V2)", async () => {
  const coordinator = await generateExperimentalVotingKeypair();
  const ballotPayload = {
    electionId: "42",
    selection: "CANDIDATO_A",
    selectionIndex: 0,
    timestamp: 1760000000000,
  };

  const ciphertext = await encryptBallotPayload(ballotPayload, coordinator.publicKey, {
    scheme: "ZK_FRIENDLY_V2",
  });
  const envelope = decodeBallotCiphertextEnvelope(ciphertext);

  assert.equal(envelope.version, "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2");
  assert.equal(envelope.kdf, "BABYJUB_ECDH");
  assert.equal(envelope.aead, "POSEIDON_FIELD_ADDITION");

  const decrypted = await decryptBallotPayload(ciphertext, coordinator.privateKey);
  assert.deepEqual(decrypted, ballotPayload);
});

test("decryptBallotPayload fails with tampered ciphertext (V2)", async () => {
  const coordinator = await generateExperimentalVotingKeypair();
  const ciphertext = await encryptBallotPayload(
    { selection: "CANDIDATO_B", selectionIndex: 1 },
    coordinator.publicKey,
    {
      scheme: "ZK_FRIENDLY_V2",
    },
  );

  const envelope = decodeBallotCiphertextEnvelope(ciphertext);

  if (envelope.version !== "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2") {
    throw new Error("Expected V2 envelope for tamper test");
  }

  const tamperedEnvelope = { ...envelope };
  const first = BigInt(tamperedEnvelope.ciphertextFields[0] ?? "0");
  tamperedEnvelope.ciphertextFields[0] = (first + 1n).toString();

  const tamperedCiphertext = Buffer.from(JSON.stringify(tamperedEnvelope), "utf8").toString("hex");

  await assert.rejects(async () => {
    await decryptBallotPayload(`0x${tamperedCiphertext}`, coordinator.privateKey);
  });
});

test("encryptBallotPayload/decryptBallotPayload fallback legacy V1 with X25519 key", async () => {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  const coordinator = {
    privateKey: ethers.hexlify(privateKey),
    publicKey: ethers.hexlify(publicKey),
  };

  const payload = { electionId: "7", selection: "CANDIDATO_LEGACY" };
  const ciphertext = await encryptBallotPayload(payload, coordinator.publicKey);
  const envelope = decodeBallotCiphertextEnvelope(ciphertext);

  assert.equal(envelope.version, "BU-PVP-1_BALLOT_X25519_XCHACHA20_V1");

  const decrypted = await decryptBallotPayload(ciphertext, coordinator.privateKey);
  assert.deepEqual(decrypted, payload);
});
