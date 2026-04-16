import test from "node:test";
import assert from "node:assert/strict";

import {
  parseThresholdSharePayload,
  reconstructCoordinatorKeyFromShares,
  splitCoordinatorKey2of3,
} from "../threshold.js";

test("splitCoordinatorKey2of3 + reconstruct with first two shares", () => {
  const secret = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  const shares = splitCoordinatorKey2of3(secret);

  assert.equal(shares.length, 3);

  const recovered = reconstructCoordinatorKeyFromShares([shares[0]!, shares[1]!]);
  assert.equal(recovered.toLowerCase(), secret.toLowerCase());
});

test("reconstructCoordinatorKeyFromShares accepts any 2-of-3 pair", () => {
  const secret = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const shares = splitCoordinatorKey2of3(secret);

  const recovered12 = reconstructCoordinatorKeyFromShares([shares[0]!, shares[1]!]);
  const recovered13 = reconstructCoordinatorKeyFromShares([shares[0]!, shares[2]!]);
  const recovered23 = reconstructCoordinatorKeyFromShares([shares[1]!, shares[2]!]);

  assert.equal(recovered12.toLowerCase(), secret);
  assert.equal(recovered13.toLowerCase(), secret);
  assert.equal(recovered23.toLowerCase(), secret);
});

test("parseThresholdSharePayload rejects malformed share", () => {
  assert.throws(() => {
    parseThresholdSharePayload("invalid-share");
  });
});

test("reconstruct detects inconsistent share set", () => {
  const secret = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const shares = splitCoordinatorKey2of3(secret);

  const tampered = parseThresholdSharePayload(shares[2]!);
  const tamperedPayload = `BU-PVP-1_THRESHOLD_2_OF_3_V1:${tampered.x}:${tampered.yHex.slice(0, -2)}00`;

  assert.throws(() => {
    reconstructCoordinatorKeyFromShares([shares[0]!, shares[1]!, tamperedPayload]);
  });
});
