import { ethers } from "ethers";

const FIELD_PRIME = 65521;
const SHARE_PREFIX = "BU-PVP-1_THRESHOLD_2_OF_3_V1";
const SHARE_HEX_LEN = 128;

type ParsedShare = {
  x: number;
  yHex: string;
};

function mod(n: number, p = FIELD_PRIME): number {
  const r = n % p;
  return r < 0 ? r + p : r;
}

function modInv(a: number, p = FIELD_PRIME): number {
  let t = 0;
  let newT = 1;
  let r = p;
  let newR = mod(a, p);

  while (newR !== 0) {
    const q = Math.floor(r / newR);
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }

  if (r > 1) {
    throw new Error("Value has no modular inverse in selected field");
  }

  return mod(t, p);
}

function randomFieldElement(): number {
  const b = ethers.randomBytes(2);
  const n = (Number(b[0]!) << 8) | Number(b[1]!);
  return n % FIELD_PRIME;
}

function readShareYValues(yHex: string): Uint16Array {
  const bytes = ethers.getBytes(yHex);
  if (bytes.length !== 64) {
    throw new Error("Invalid share payload size");
  }

  const values = new Uint16Array(32);
  for (let i = 0; i < 32; i += 1) {
    const hi = Number(bytes[i * 2]!);
    const lo = Number(bytes[i * 2 + 1]!);
    values[i] = (hi << 8) | lo;
  }
  return values;
}

function encodeShare(x: number, yHex: string): string {
  return `${SHARE_PREFIX}:${x}:${yHex}`;
}

export function parseThresholdSharePayload(payload: string): ParsedShare {
  const raw = String(payload ?? "").trim();
  const re = new RegExp(`^${SHARE_PREFIX}:(\\d+):(0x[0-9a-fA-F]{${SHARE_HEX_LEN}})$`);
  const match = raw.match(re);
  if (!match) {
    throw new Error("Invalid threshold share format");
  }

  const x = Number(match[1]);
  const yHex = String(match[2]).toLowerCase();
  if (!Number.isInteger(x) || x <= 0 || x > 255) {
    throw new Error("Invalid share index x");
  }

  return { x, yHex };
}

function reconstructWithTwoShares(a: ParsedShare, b: ParsedShare): string {
  if (a.x === b.x) {
    throw new Error("Shares must have distinct x coordinates");
  }

  const ya = readShareYValues(a.yHex);
  const yb = readShareYValues(b.yHex);
  const out = new Uint8Array(32);

  for (let i = 0; i < 32; i += 1) {
    const y1 = Number(ya[i]!);
    const y2 = Number(yb[i]!);

    const numerator = mod(y1 * b.x - y2 * a.x);
    const denominator = mod(b.x - a.x);
    const secretByte = mod(numerator * modInv(denominator));

    if (secretByte < 0 || secretByte > 255) {
      throw new Error("Invalid share set: reconstructed byte out of range");
    }

    out[i] = secretByte;
  }

  return ethers.hexlify(out);
}

export function splitCoordinatorKey2of3(secretHex: string): string[] {
  const secret = ethers.getBytes(secretHex);
  if (secret.length !== 32) {
    throw new Error("Expected 32-byte coordinator private key");
  }

  const y1 = new Uint16Array(32);
  const y2 = new Uint16Array(32);
  const y3 = new Uint16Array(32);

  for (let i = 0; i < 32; i += 1) {
    const s = Number(secret[i]!);
    const coeff = randomFieldElement();
    y1[i] = mod(s + coeff * 1);
    y2[i] = mod(s + coeff * 2);
    y3[i] = mod(s + coeff * 3);
  }

  const toShareHex = (arr: Uint16Array): string => {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 32; i += 1) {
      const v = Number(arr[i]!);
      bytes[i * 2] = (v >> 8) & 0xff;
      bytes[i * 2 + 1] = v & 0xff;
    }
    return ethers.hexlify(bytes);
  };

  return [
    encodeShare(1, toShareHex(y1)),
    encodeShare(2, toShareHex(y2)),
    encodeShare(3, toShareHex(y3)),
  ];
}

export function reconstructCoordinatorKeyFromShares(sharePayloads: string[]): string {
  const parsed = sharePayloads.map(parseThresholdSharePayload);
  if (parsed.length < 2) {
    throw new Error("At least 2 shares are required");
  }

  const uniqueByX = new Map<number, ParsedShare>();
  for (const s of parsed) {
    if (!uniqueByX.has(s.x)) uniqueByX.set(s.x, s);
  }

  if (uniqueByX.size < 2) {
    throw new Error("At least 2 shares with distinct trustee indexes are required");
  }

  const shares = Array.from(uniqueByX.values());
  const reconstructed = reconstructWithTwoShares(shares[0]!, shares[1]!);

  if (shares.length >= 3) {
    const reconstructedAlt = reconstructWithTwoShares(shares[0]!, shares[2]!);
    if (reconstructedAlt.toLowerCase() !== reconstructed.toLowerCase()) {
      throw new Error("Inconsistent share set: at least one share is invalid");
    }
  }

  return reconstructed;
}
