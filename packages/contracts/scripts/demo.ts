import fs from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";

import { signSnapshot } from "@blockurna/crypto";

const { ethers } = await network.connect();

const [aea, rea] = await ethers.getSigners();
if (!aea || !rea) throw new Error("Missing signers");

const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
const registry = (await Factory.connect(aea).deploy()) as any;
await registry.waitForDeployment();

const registryAddress = await registry.getAddress();

// Deterministic demo constants (research scaffold only)
const manifestHash = ("0x" + "11".repeat(32)) as `0x${string}`;
const coordinatorPubKey = ("0x" + "22".repeat(32)) as `0x${string}`;

await (
  await registry
    .connect(aea)
    .createElection(manifestHash, await rea.getAddress(), coordinatorPubKey)
).wait();

const chain = await ethers.provider.getNetwork();
const toBlock = await ethers.provider.getBlockNumber();

const snapshotBody = {
  snapshotVersion: "1",
  protocolVersion: "BU-PVP-1",
  electionId: "0",
  kind: "ACTA_APERTURA",
  generatedAt: new Date().toISOString(),
  chainId: chain.chainId.toString(),
  blockRange: { fromBlock: 0, toBlock },
  commitments: {
    manifestHash,
  },
  counts: {
    signups: 0,
    ballots: 0,
  },
  notes: "Demo seed generado por scripts/demo.ts",
} as const;

const ed25519PrivateKeyHex =
  "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const signed = await signSnapshot(snapshotBody as any, ed25519PrivateKeyHex);

const outDir = path.join("demo-output");
await fs.mkdir(outDir, { recursive: true });

const outFile = path.join(outDir, "acta_apertura.signed.json");
await fs.writeFile(outFile, JSON.stringify(signed, null, 2) + "\n", "utf8");

// Anchor the acta hash on-chain (kind 0 == ACTA_APERTURA)
await (
  await registry
    .connect(aea)
    .publishActa(0, 0, signed.signature.snapshotHashHex)
).wait();

console.log(
  JSON.stringify(
    {
      ok: true,
      registryAddress,
      chainId: chain.chainId.toString(),
      electionId: 0,
      actaFile: outFile,
      snapshotHashHex: signed.signature.snapshotHashHex,
      registryAuthority: await rea.getAddress(),
      authority: await aea.getAddress(),
    },
    null,
    2,
  ),
);
