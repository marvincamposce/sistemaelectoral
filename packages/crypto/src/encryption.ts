import { ethers } from "ethers";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";

import {
  BallotCiphertextEnvelopeSchema,
  type BallotCiphertextEnvelope,
} from "@blockurna/shared";

const BALLOT_AAD = ethers.toUtf8Bytes("BU-PVP-1:ballot:v1");

function requireFixedHexBytes(hex: string, expectedLen: number, label: string): Uint8Array {
  const bytes = ethers.getBytes(hex);
  if (bytes.length !== expectedLen) {
    throw new Error(`${label} must be ${expectedLen} bytes`);
  }
  return bytes;
}

/**
 * Creates an experimental Vote Keypair for the Voter Portal.
 * Uses an X25519 keypair to align with real ballot encryption.
 */
export function generateExperimentalVotingKeypair(): { publicKey: string, privateKey: string } {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKey: ethers.hexlify(publicKey),
    privateKey: ethers.hexlify(privateKey),
  };
}

export function encodeBallotCiphertextEnvelope(envelope: BallotCiphertextEnvelope): string {
  const normalized = BallotCiphertextEnvelopeSchema.parse(envelope);
  return ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(normalized)));
}

export function decodeBallotCiphertextEnvelope(ciphertextHex: string): BallotCiphertextEnvelope {
  try {
    const bytes = ethers.getBytes(ciphertextHex);
    const raw = ethers.toUtf8String(bytes);
    return BallotCiphertextEnvelopeSchema.parse(JSON.parse(raw) as unknown);
  } catch (err: unknown) {
    throw new Error(`Invalid ballot ciphertext envelope: ${(err as Error).message}`);
  }
}

export function encryptBallotPayload(payload: unknown, coordinatorPubKeyHex: string): string {
  const coordinatorPubKey = requireFixedHexBytes(coordinatorPubKeyHex, 32, "coordinatorPubKey");
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, coordinatorPubKey);
  const nonce = ethers.randomBytes(24);

  const plaintext = ethers.toUtf8Bytes(JSON.stringify(payload));
  const ciphertext = xchacha20poly1305(sharedSecret, nonce, BALLOT_AAD).encrypt(plaintext);

  return encodeBallotCiphertextEnvelope({
    version: "BU-PVP-1_BALLOT_X25519_XCHACHA20_V1",
    kdf: "X25519",
    aead: "XCHACHA20POLY1305",
    ephemeralPublicKeyHex: ethers.hexlify(ephemeralPublicKey),
    nonceHex: ethers.hexlify(nonce),
    ciphertextHex: ethers.hexlify(ciphertext),
  });
}

export function decryptBallotPayload(ciphertextHex: string, coordinatorPrivateKeyHex: string): unknown {
  const envelope = decodeBallotCiphertextEnvelope(ciphertextHex);
  const coordinatorPrivateKey = requireFixedHexBytes(coordinatorPrivateKeyHex, 32, "coordinatorPrivateKey");
  const ephemeralPublicKey = requireFixedHexBytes(envelope.ephemeralPublicKeyHex, 32, "ephemeralPublicKey");
  const nonce = requireFixedHexBytes(envelope.nonceHex, 24, "nonce");
  const ciphertext = ethers.getBytes(envelope.ciphertextHex);

  const sharedSecret = x25519.getSharedSecret(coordinatorPrivateKey, ephemeralPublicKey);
  const plaintext = xchacha20poly1305(sharedSecret, nonce, BALLOT_AAD).decrypt(ciphertext);
  const decoded = ethers.toUtf8String(plaintext);

  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return decoded;
  }
}

/**
 * @deprecated Use encryptBallotPayload.
 * Kept for compatibility with older callers.
 */
export function mockEncryptBallot(payload: any, coordinatorPubKey: string): string {
  return encryptBallotPayload(payload, coordinatorPubKey);
}
