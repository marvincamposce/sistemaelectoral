import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex as nobleBytesToHex } from "@noble/hashes/utils";

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${nobleBytesToHex(bytes)}`;
}

export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  return bytesToHex(sha256(bytes));
}
