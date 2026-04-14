import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { bytesToHex as bytesToHex0x } from "./hash.js";

// Required by @noble/ed25519 v3+: the hash implementation is injected by the consumer.
ed25519.hashes.sha512 = sha512 as any;

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = strip0x(hex);
  if (normalized.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function getPublicKeyHex(privateKeyHex: string): Promise<string> {
  const pk = hexToBytes(privateKeyHex);
  const pub = await ed25519.getPublicKey(pk);
  return bytesToHex0x(pub);
}

export async function signEd25519Hex(
  message: Uint8Array,
  privateKeyHex: string,
): Promise<string> {
  const sk = hexToBytes(privateKeyHex);
  const sig = await ed25519.sign(message, sk);
  return bytesToHex0x(sig);
}

export async function verifyEd25519Hex(
  signatureHex: string,
  message: Uint8Array,
  publicKeyHex: string,
): Promise<boolean> {
  const sig = hexToBytes(signatureHex);
  const pub = hexToBytes(publicKeyHex);
  return ed25519.verify(sig, message, pub);
}
