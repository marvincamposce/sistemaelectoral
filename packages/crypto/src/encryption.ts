import { ethers } from "ethers";

import * as circomlibjs from "circomlibjs";

import {
  BallotCiphertextEnvelopeSchema,
  type BallotCiphertextEnvelope,
} from "@blockurna/shared";

const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);
const CHUNK_BYTES = 30;
const MAX_PAYLOAD_BYTES = 4096;
const SELECTION_MASK_DOMAIN = 0n;

export type BallotEncryptionScheme = "ZK_FRIENDLY_V2";

type PoseidonFn = ((inputs: bigint[]) => unknown) & {
  F: {
    toObject: (value: unknown) => bigint;
  };
};

type BabyJubPoint = [unknown, unknown];

type BabyJub = {
  F: {
    toObject: (value: unknown) => bigint;
  };
  Base8: BabyJubPoint;
  subOrder: bigint;
  mulPointEscalar: (base: BabyJubPoint, e: bigint) => BabyJubPoint;
  unpackPoint: (buff: Uint8Array) => BabyJubPoint | null;
  packPoint: (point: BabyJubPoint) => Uint8Array;
};

let poseidonPromise: Promise<PoseidonFn> | undefined;
let babyJubPromise: Promise<BabyJub> | undefined;

const buildPoseidon = (circomlibjs as any).buildPoseidon as () => Promise<PoseidonFn>;
const buildBabyjub = (circomlibjs as any).buildBabyjub as () => Promise<BabyJub>;

function normalizeField(value: bigint): bigint {
  const reduced = value % FIELD_PRIME;
  return reduced >= 0n ? reduced : reduced + FIELD_PRIME;
}

function parseFieldElement(value: string | bigint | number): bigint {
  if (typeof value === "bigint") return normalizeField(value);
  if (typeof value === "number") return normalizeField(BigInt(value));

  const raw = String(value).trim();
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return normalizeField(BigInt(raw));
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid field element: ${raw}`);
  }

  return normalizeField(BigInt(raw));
}

function fieldElementToHex32(value: bigint): string {
  const normalized = normalizeField(value);
  return ethers.toBeHex(normalized, 32);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  return BigInt(ethers.hexlify(bytes));
}

function bigIntToFixedBytes(value: bigint, len: number): Uint8Array {
  return ethers.getBytes(ethers.toBeHex(value, len));
}

function chunkBytesToField(chunk: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < chunk.length; i += 1) {
    value += BigInt(chunk[i] ?? 0) << BigInt(8 * i);
  }
  return value;
}

function fieldToChunkBytes(value: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let acc = value;
  for (let i = 0; i < len; i += 1) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function splitIntoChunks(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    out.push(data.slice(i, i + chunkSize));
  }
  return out.length > 0 ? out : [new Uint8Array(0)];
}

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon().then((poseidon: unknown) => poseidon as PoseidonFn);
  }
  return poseidonPromise;
}

async function getBabyJub(): Promise<BabyJub> {
  if (!babyJubPromise) {
    babyJubPromise = buildBabyjub().then((babyJub: unknown) => babyJub as BabyJub);
  }
  return babyJubPromise!;
}

async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const out = poseidon(inputs.map((value) => normalizeField(value)));
  return normalizeField(poseidon.F.toObject(out));
}

function parseCoordinatorPrivateScalar(privateKeyHex: string, subOrder: bigint): bigint {
  const bytes = requireFixedHexBytes(privateKeyHex, 32, "coordinatorPrivateKey");
  const raw = bytesToBigInt(bytes);
  const scalar = raw % subOrder;
  return scalar === 0n ? 1n : scalar;
}

function randomNonZeroScalar(subOrder: bigint): bigint {
  while (true) {
    const raw = bytesToBigInt(ethers.randomBytes(32));
    const scalar = raw % subOrder;
    if (scalar !== 0n) {
      return scalar;
    }
  }
}

function unpackBabyJubPoint(hex: string, babyJub: BabyJub): BabyJubPoint | null {
  try {
    const bytes = requireFixedHexBytes(hex, 32, "coordinatorPubKey");
    return babyJub.unpackPoint(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function packBabyJubPoint(point: BabyJubPoint, babyJub: BabyJub): string {
  return ethers.hexlify(babyJub.packPoint(point));
}

function pointCoordinates(point: BabyJubPoint, babyJub: BabyJub): [bigint, bigint] {
  return [
    normalizeField(babyJub.F.toObject(point[0])),
    normalizeField(babyJub.F.toObject(point[1])),
  ];
}

async function deriveSharedKey(point: BabyJubPoint, scalar: bigint, babyJub: BabyJub): Promise<bigint> {
  const sharedPoint = babyJub.mulPointEscalar(point, scalar);
  const [x, y] = pointCoordinates(sharedPoint, babyJub);
  return poseidonHash([x, y]);
}

async function computeV2AuthTag(
  sharedKey: bigint,
  nonceField: bigint,
  ciphertextFields: bigint[],
): Promise<bigint> {
  let acc = await poseidonHash([sharedKey, nonceField, BigInt(ciphertextFields.length)]);
  for (let i = 0; i < ciphertextFields.length; i += 1) {
    acc = await poseidonHash([acc, ciphertextFields[i]!, BigInt(i + 1)]);
  }
  return acc;
}

function extractSelectionIndexForV2Payload(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("ZK_FRIENDLY_V2 requires object payload with selectionIndex");
  }

  const value = (payload as Record<string, unknown>).selectionIndex;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1024) {
    throw new Error("ZK_FRIENDLY_V2 requires payload.selectionIndex as integer in [0,1024]");
  }

  return value;
}

function requireFixedHexBytes(hex: string, expectedLen: number, label: string): Uint8Array {
  const bytes = ethers.getBytes(hex);
  if (bytes.length !== expectedLen) {
    throw new Error(`${label} must be ${expectedLen} bytes`);
  }
  return bytes;
}

/**
 * Creates a Vote Keypair for the voter flow.
 * Uses a BabyJub scalar/public point pair for zk-friendly ballot encryption.
 */
export async function generateExperimentalVotingKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const babyJub = await getBabyJub();
  const privateScalar = randomNonZeroScalar(babyJub.subOrder);
  const publicPoint = babyJub.mulPointEscalar(babyJub.Base8, privateScalar);
  return {
    publicKey: packBabyJubPoint(publicPoint, babyJub),
    privateKey: ethers.toBeHex(privateScalar, 32),
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

async function encryptBallotPayloadZkFriendly(
  payload: unknown,
  coordinatorPubKeyHex: string,
  babyJub: BabyJub,
): Promise<string> {
  const coordinatorPoint = unpackBabyJubPoint(coordinatorPubKeyHex, babyJub);
  if (!coordinatorPoint) {
    throw new Error("Invalid zk-friendly coordinator public key");
  }

  const ephemeralScalar = randomNonZeroScalar(babyJub.subOrder);
  const ephemeralPublicPoint = babyJub.mulPointEscalar(babyJub.Base8, ephemeralScalar);
  const sharedKey = await deriveSharedKey(coordinatorPoint, ephemeralScalar, babyJub);

  const nonceField = parseFieldElement(ethers.toBeHex(bytesToBigInt(ethers.randomBytes(32)), 32));
  const selectionIndex = extractSelectionIndexForV2Payload(payload);
  const selectionMask = await poseidonHash([sharedKey, nonceField, SELECTION_MASK_DOMAIN]);
  const selectionCiphertext = normalizeField(BigInt(selectionIndex) + selectionMask);
  const plaintext = ethers.toUtf8Bytes(JSON.stringify(payload));

  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`ballot payload too large (${plaintext.length} bytes), max ${MAX_PAYLOAD_BYTES}`);
  }

  const chunks = splitIntoChunks(plaintext, CHUNK_BYTES);
  const ciphertextFields: bigint[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const messageField = chunkBytesToField(chunks[i]!);
    const mask = await poseidonHash([sharedKey, nonceField, BigInt(i + 1)]);
    ciphertextFields.push(normalizeField(messageField + mask));
  }

  const authTag = await computeV2AuthTag(sharedKey, nonceField, ciphertextFields);

  return encodeBallotCiphertextEnvelope({
    version: "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2",
    kdf: "BABYJUB_ECDH",
    aead: "POSEIDON_FIELD_ADDITION",
    ephemeralPublicKeyHex: packBabyJubPoint(ephemeralPublicPoint, babyJub),
    nonceHex: fieldElementToHex32(nonceField),
    selectionCiphertext: selectionCiphertext.toString(),
    plaintextLength: plaintext.length,
    authTag: authTag.toString(),
    ciphertextFields: ciphertextFields.map((value) => value.toString()),
  });
}

async function deriveV2SelectionDecryption(
  envelope: Extract<BallotCiphertextEnvelope, { version: "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2" }>,
  coordinatorPrivateKeyHex: string,
): Promise<{
  sharedKey: bigint;
  nonceField: bigint;
  selectionCiphertext: bigint;
  decryptedSelection: bigint;
}> {
  const babyJub = await getBabyJub();
  const ephemeralPoint = unpackBabyJubPoint(envelope.ephemeralPublicKeyHex, babyJub);

  if (!ephemeralPoint) {
    throw new Error("Invalid ephemeral public key for zk-friendly envelope");
  }

  const coordinatorScalar = parseCoordinatorPrivateScalar(coordinatorPrivateKeyHex, babyJub.subOrder);
  const sharedKey = await deriveSharedKey(ephemeralPoint, coordinatorScalar, babyJub);
  const nonceField = parseFieldElement(envelope.nonceHex);
  const selectionCiphertext = parseFieldElement(envelope.selectionCiphertext);
  const selectionMask = await poseidonHash([sharedKey, nonceField, SELECTION_MASK_DOMAIN]);
  const decryptedSelection = normalizeField(selectionCiphertext - selectionMask);

  return { sharedKey, nonceField, selectionCiphertext, decryptedSelection };
}

async function decryptBallotPayloadZkFriendly(
  envelope: Extract<BallotCiphertextEnvelope, { version: "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2" }>,
  coordinatorPrivateKeyHex: string,
): Promise<unknown> {
  const { sharedKey, nonceField, decryptedSelection } = await deriveV2SelectionDecryption(
    envelope,
    coordinatorPrivateKeyHex,
  );
  const ciphertextFields = envelope.ciphertextFields.map((value) => parseFieldElement(value));

  const expectedAuthTag = await computeV2AuthTag(sharedKey, nonceField, ciphertextFields);
  if (expectedAuthTag.toString() !== envelope.authTag) {
    throw new Error("Invalid zk-friendly ciphertext auth tag");
  }

  const maxChunkValue = 1n << BigInt(CHUNK_BYTES * 8);
  const plainChunks: Uint8Array[] = [];

  for (let i = 0; i < ciphertextFields.length; i += 1) {
    const mask = await poseidonHash([sharedKey, nonceField, BigInt(i + 1)]);
    const messageField = normalizeField(ciphertextFields[i]! - mask);

    if (messageField >= maxChunkValue) {
      throw new Error("Invalid zk-friendly plaintext chunk");
    }

    plainChunks.push(fieldToChunkBytes(messageField, CHUNK_BYTES));
  }

  const fullPlaintext = concatChunks(plainChunks);
  if (envelope.plaintextLength < 0 || envelope.plaintextLength > fullPlaintext.length) {
    throw new Error("Invalid plaintext length in zk-friendly envelope");
  }

  const plaintext = fullPlaintext.slice(0, envelope.plaintextLength);
  const decoded = ethers.toUtf8String(plaintext);

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    return decoded;
  }

  if (typeof parsed === "object" && parsed !== null && "selectionIndex" in parsed) {
    const selectionIndex = (parsed as Record<string, unknown>).selectionIndex;
    if (typeof selectionIndex !== "number" || !Number.isInteger(selectionIndex)) {
      throw new Error("Invalid selectionIndex in decrypted V2 payload");
    }
    if (BigInt(selectionIndex) !== decryptedSelection) {
      throw new Error("V2 selection ciphertext mismatch against decrypted payload selectionIndex");
    }
  }

  return parsed;
}

export async function deriveZkFriendlySelectionWitnessData(
  ciphertextHex: string,
  coordinatorPrivateKeyHex: string,
): Promise<{
  selectionCiphertext: string;
  selectionNonce: string;
  selectionSharedKey: string;
  decryptedSelection: string;
}> {
  const envelope = decodeBallotCiphertextEnvelope(ciphertextHex);
  if (envelope.version !== "BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2") {
    throw new Error("deriveZkFriendlySelectionWitnessData requires V2 ciphertext envelope");
  }

  const decryption = await deriveV2SelectionDecryption(envelope, coordinatorPrivateKeyHex);
  return {
    selectionCiphertext: decryption.selectionCiphertext.toString(),
    selectionNonce: decryption.nonceField.toString(),
    selectionSharedKey: decryption.sharedKey.toString(),
    decryptedSelection: decryption.decryptedSelection.toString(),
  };
}

export async function encryptBallotPayload(
  payload: unknown,
  coordinatorPubKeyHex: string,
  options?: { scheme?: BallotEncryptionScheme },
): Promise<string> {
  const scheme = options?.scheme ?? "ZK_FRIENDLY_V2";
  if (scheme !== "ZK_FRIENDLY_V2") {
    throw new Error(`Unsupported ballot encryption scheme: ${scheme}`);
  }
  const babyJub = await getBabyJub();
  return encryptBallotPayloadZkFriendly(payload, coordinatorPubKeyHex, babyJub);
}

export async function decryptBallotPayload(
  ciphertextHex: string,
  coordinatorPrivateKeyHex: string,
): Promise<unknown> {
  const envelope = decodeBallotCiphertextEnvelope(ciphertextHex);
  return decryptBallotPayloadZkFriendly(envelope, coordinatorPrivateKeyHex);
}

/**
 * @deprecated Use encryptBallotPayload.
 * Kept for compatibility with older callers.
 */
export async function mockEncryptBallot(payload: any, coordinatorPubKey: string): Promise<string> {
  return encryptBallotPayload(payload, coordinatorPubKey, { scheme: "ZK_FRIENDLY_V2" });
}
