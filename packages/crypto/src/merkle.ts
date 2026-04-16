import { ethers } from "ethers";
import { buildPoseidon } from "circomlibjs";

const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

export const POSEIDON_MAX_BALLOTS = 64;
export const POSEIDON_TREE_DEPTH = 6;

const EMPTY_BALLOT_SLOT_HASH_HEX = ethers.keccak256(
  ethers.toUtf8Bytes("BU-PVP-1:POSEIDON_EMPTY_BALLOT_SLOT"),
);

type PoseidonFn = ((inputs: bigint[]) => unknown) & {
  F: {
    toObject: (value: unknown) => bigint;
  };
};

export interface PoseidonMerkleBundle {
  merkleRoot: string;
  ballotHashes: string[];
  merkleProofs: string[][];
  merklePathIndices: string[][];
}

let poseidonPromise: Promise<PoseidonFn> | undefined;

function normalizeField(value: bigint): bigint {
  const reduced = value % FIELD_PRIME;
  return reduced >= 0n ? reduced : reduced + FIELD_PRIME;
}

function parseFieldElement(value: string | bigint | number): bigint {
  if (typeof value === "bigint") return normalizeField(value);
  if (typeof value === "number") return normalizeField(BigInt(value));

  const raw = String(value).trim();
  if (raw.length === 0) {
    throw new Error("Field element cannot be empty");
  }

  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return normalizeField(BigInt(raw));
  }

  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid field element: ${raw}`);
  }

  return normalizeField(BigInt(raw));
}

function fieldToDecimal(value: bigint): string {
  return normalizeField(value).toString();
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

function keccakPair(leftHex: string, rightHex: string): string {
  const left = ethers.getBytes(leftHex);
  const right = ethers.getBytes(rightHex);
  return ethers.keccak256(ethers.concat([left, right]));
}

export function deriveBallotMerkleRoot(ciphertexts: string[]): string {
  if (!Array.isArray(ciphertexts) || ciphertexts.length === 0) {
    return ethers.keccak256(ethers.toUtf8Bytes("BU-PVP-1:EMPTY_BALLOT_SET"));
  }

  let level = ciphertexts.map((ciphertext) => ethers.keccak256(ciphertext));

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(keccakPair(left, right));
    }
    level = next;
  }

  return level[0]!;
}

export async function buildPoseidonMerkleBundleFromBallotHashes(
  ballotHashesHex: string[],
): Promise<PoseidonMerkleBundle> {
  if (!Array.isArray(ballotHashesHex)) {
    throw new Error("ballotHashesHex must be an array");
  }

  if (ballotHashesHex.length > POSEIDON_MAX_BALLOTS) {
    throw new Error(
      `Poseidon Merkle bundle supports max ${POSEIDON_MAX_BALLOTS} ballot hashes, got ${ballotHashesHex.length}`,
    );
  }

  const emptyLeaf = parseFieldElement(EMPTY_BALLOT_SLOT_HASH_HEX);
  const leaves: bigint[] = ballotHashesHex.map((hashHex) => parseFieldElement(hashHex));

  while (leaves.length < POSEIDON_MAX_BALLOTS) {
    leaves.push(emptyLeaf);
  }

  const levels: bigint[][] = [leaves];
  for (let depth = 0; depth < POSEIDON_TREE_DEPTH; depth += 1) {
    const current = levels[depth]!;
    const next: bigint[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1]!;
      next.push(await poseidonHash2(left, right));
    }
    levels.push(next);
  }

  const merkleProofs: string[][] = [];
  const merklePathIndices: string[][] = [];

  for (let leafIndex = 0; leafIndex < POSEIDON_MAX_BALLOTS; leafIndex += 1) {
    const proof: string[] = [];
    const indices: string[] = [];
    let indexAtLevel = leafIndex;

    for (let depth = 0; depth < POSEIDON_TREE_DEPTH; depth += 1) {
      const level = levels[depth]!;
      const siblingIndex = indexAtLevel ^ 1;
      proof.push(fieldToDecimal(level[siblingIndex]!));
      indices.push(String(indexAtLevel & 1));
      indexAtLevel = Math.floor(indexAtLevel / 2);
    }

    merkleProofs.push(proof);
    merklePathIndices.push(indices);
  }

  return {
    merkleRoot: fieldToDecimal(levels[POSEIDON_TREE_DEPTH]![0]!),
    ballotHashes: leaves.map(fieldToDecimal),
    merkleProofs,
    merklePathIndices,
  };
}

export async function deriveBallotPoseidonMerkleBundle(
  ciphertexts: string[],
): Promise<PoseidonMerkleBundle> {
  const ballotHashes = Array.isArray(ciphertexts)
    ? ciphertexts.map((ciphertext) => ethers.keccak256(ciphertext))
    : [];
  return buildPoseidonMerkleBundleFromBallotHashes(ballotHashes);
}

export async function deriveBallotMerkleRootPoseidon(
  ciphertexts: string[],
): Promise<string> {
  const bundle = await deriveBallotPoseidonMerkleBundle(ciphertexts);
  return bundle.merkleRoot;
}

export async function verifyPoseidonMerklePath(params: {
  leaf: string;
  merkleProof: string[];
  merklePathIndices: string[];
  expectedRoot: string;
}): Promise<boolean> {
  const { leaf, merkleProof, merklePathIndices, expectedRoot } = params;

  if (merkleProof.length !== POSEIDON_TREE_DEPTH) {
    throw new Error(
      `merkleProof must have ${POSEIDON_TREE_DEPTH} siblings, got ${merkleProof.length}`,
    );
  }

  if (merklePathIndices.length !== POSEIDON_TREE_DEPTH) {
    throw new Error(
      `merklePathIndices must have ${POSEIDON_TREE_DEPTH} entries, got ${merklePathIndices.length}`,
    );
  }

  let current = parseFieldElement(leaf);
  for (let depth = 0; depth < POSEIDON_TREE_DEPTH; depth += 1) {
    const sibling = parseFieldElement(merkleProof[depth]!);
    const direction = merklePathIndices[depth];
    if (direction !== "0" && direction !== "1") {
      throw new Error(`Invalid path index at depth ${depth}: ${direction}`);
    }
    current =
      direction === "0"
        ? await poseidonHash2(current, sibling)
        : await poseidonHash2(sibling, current);
  }

  return current === parseFieldElement(expectedRoot);
}
