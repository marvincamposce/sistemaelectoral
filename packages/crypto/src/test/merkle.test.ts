import test from "node:test";
import assert from "node:assert/strict";

import {
  POSEIDON_MAX_BALLOTS,
  POSEIDON_TREE_DEPTH,
  buildPoseidonMerkleBundleFromBallotHashes,
  deriveBallotMerkleRoot,
  deriveBallotPoseidonMerkleBundle,
  verifyPoseidonMerklePath,
} from "../merkle.js";

test("deriveBallotMerkleRoot deterministic for same input", () => {
  const ballots = [
    "0x1234",
    "0xabcd",
    "0xdeadbeef",
  ];

  const rootA = deriveBallotMerkleRoot(ballots);
  const rootB = deriveBallotMerkleRoot(ballots);

  assert.equal(rootA, rootB);
});

test("deriveBallotMerkleRoot changes when order changes", () => {
  const ballots = ["0x1234", "0xabcd", "0xdeadbeef"];
  const reordered = ["0xabcd", "0x1234", "0xdeadbeef"];

  const rootA = deriveBallotMerkleRoot(ballots);
  const rootB = deriveBallotMerkleRoot(reordered);

  assert.notEqual(rootA, rootB);
});

test("deriveBallotMerkleRoot handles empty set", () => {
  const root = deriveBallotMerkleRoot([]);
  assert.match(root, /^0x[0-9a-f]{64}$/);
});

test("deriveBallotPoseidonMerkleBundle deterministic for same input", async () => {
  const ciphertexts = ["0x1234", "0xabcd", "0xdeadbeef"];

  const bundleA = await deriveBallotPoseidonMerkleBundle(ciphertexts);
  const bundleB = await deriveBallotPoseidonMerkleBundle(ciphertexts);

  assert.equal(bundleA.merkleRoot, bundleB.merkleRoot);
  assert.deepEqual(bundleA.ballotHashes, bundleB.ballotHashes);
});

test("poseidon bundle uses fixed-size tree and proof depth", async () => {
  const ciphertexts = ["0x1234", "0xabcd", "0xdeadbeef"];
  const bundle = await deriveBallotPoseidonMerkleBundle(ciphertexts);

  assert.equal(bundle.ballotHashes.length, POSEIDON_MAX_BALLOTS);
  assert.equal(bundle.merkleProofs.length, POSEIDON_MAX_BALLOTS);
  assert.equal(bundle.merklePathIndices.length, POSEIDON_MAX_BALLOTS);
  assert.equal(bundle.merkleProofs[0]?.length, POSEIDON_TREE_DEPTH);
  assert.equal(bundle.merklePathIndices[0]?.length, POSEIDON_TREE_DEPTH);
});

test("verifyPoseidonMerklePath validates generated proof", async () => {
  const ballotHashes = [
    "0x01",
    "0x02",
    "0x03",
    "0x04",
  ];
  const bundle = await buildPoseidonMerkleBundleFromBallotHashes(ballotHashes);

  const valid = await verifyPoseidonMerklePath({
    leaf: bundle.ballotHashes[0]!,
    merkleProof: bundle.merkleProofs[0]!,
    merklePathIndices: bundle.merklePathIndices[0]!,
    expectedRoot: bundle.merkleRoot,
  });

  assert.equal(valid, true);
});

test("verifyPoseidonMerklePath rejects tampered sibling", async () => {
  const ballotHashes = ["0x01", "0x02", "0x03", "0x04"];
  const bundle = await buildPoseidonMerkleBundleFromBallotHashes(ballotHashes);

  const tamperedProof = [...bundle.merkleProofs[1]!];
  tamperedProof[0] = "123456789";

  const valid = await verifyPoseidonMerklePath({
    leaf: bundle.ballotHashes[1]!,
    merkleProof: tamperedProof,
    merklePathIndices: bundle.merklePathIndices[1]!,
    expectedRoot: bundle.merkleRoot,
  });

  assert.equal(valid, false);
});
