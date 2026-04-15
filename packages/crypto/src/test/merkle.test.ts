import test from "node:test";
import assert from "node:assert/strict";

import { deriveBallotMerkleRoot } from "../merkle.js";

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
