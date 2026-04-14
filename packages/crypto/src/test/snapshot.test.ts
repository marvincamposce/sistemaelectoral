import test from "node:test";
import assert from "node:assert/strict";

import { type SnapshotBody } from "@blockurna/shared";

import { signSnapshot, verifySignedSnapshot } from "../snapshot.js";

test("signSnapshot/verifySignedSnapshot roundtrip", async () => {
  // Deterministic private key for test only.
  const privateKeyHex =
    "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

  const snapshot: SnapshotBody = {
    snapshotVersion: "1",
    protocolVersion: "BU-PVP-1",
    electionId: "1",
    kind: "ACTA_APERTURA",
    generatedAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
    chainId: "31337",
    blockRange: { fromBlock: 1, toBlock: 10 },
    commitments: {
      manifestHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };

  const signed = await signSnapshot(snapshot, privateKeyHex);
  const verified = await verifySignedSnapshot(signed);
  assert.equal(verified.ok, true);
  assert.ok(verified.snapshotHashHex);
});
