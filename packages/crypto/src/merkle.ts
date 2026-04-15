import { ethers } from "ethers";

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
