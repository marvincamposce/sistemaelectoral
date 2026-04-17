import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

import { signSnapshot } from "@blockurna/crypto";

const { ethers } = await network.connect();

const [aea, rea] = await ethers.getSigners();
if (!aea || !rea) throw new Error("Missing signers");

const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
const registry = (await Factory.connect(aea).deploy()) as any;
await registry.waitForDeployment();

const registryAddress = await registry.getAddress();

const seedTimestamp = process.env.BU_SEED_TIMESTAMP ?? "2025-01-01T00:00:00.000Z";
const coordinatorPubKey = ("0x" + "22".repeat(32)) as `0x${string}`;

const candidateCatalog = [
  {
    id: "presidencia-2025-lucia-ferrer",
    candidateCode: "LUCIA_FERRER",
    displayName: "Lucia Ferrer",
    shortName: "L. Ferrer",
    partyName: "Movimiento Horizonte",
    ballotOrder: 1,
    status: "ACTIVE",
    colorHex: "#1d4ed8",
    metadata: {
      office: "PRESIDENCIA",
      region: "NACIONAL",
      coalition: "Horizonte Ciudadano",
    },
  },
  {
    id: "presidencia-2025-mateo-ibarra",
    candidateCode: "MATEO_IBARRA",
    displayName: "Mateo Ibarra",
    shortName: "M. Ibarra",
    partyName: "Alianza Popular Cívica",
    ballotOrder: 2,
    status: "ACTIVE",
    colorHex: "#b91c1c",
    metadata: {
      office: "PRESIDENCIA",
      region: "NACIONAL",
      coalition: "Frente Cívico",
    },
  },
  {
    id: "presidencia-2025-voto-en-blanco",
    candidateCode: "VOTO_EN_BLANCO",
    displayName: "Voto en Blanco",
    shortName: "Blanco",
    partyName: "Sin partido",
    ballotOrder: 3,
    status: "ACTIVE",
    colorHex: "#475569",
    metadata: {
      office: "PRESIDENCIA",
      region: "NACIONAL",
      classification: "ABSTENCION_EXPLICITA",
    },
  },
] as const;

const manifestBody = {
  manifestVersion: "1.0.0",
  protocolVersion: "BU-PVP-1",
  electionId: "0",
  generatedAt: seedTimestamp,
  authority: (await aea.getAddress()).toLowerCase(),
  registryAuthority: (await rea.getAddress()).toLowerCase(),
  coordinatorPubKey,
  catalogSource: "SEED_EXPERIMENTAL",
  candidates: candidateCatalog,
} as const;

const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(manifestBody))) as `0x${string}`;

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
  generatedAt: seedTimestamp,
  chainId: chain.chainId.toString(),
  blockRange: { fromBlock: 0, toBlock },
  commitments: {
    manifestHash,
  },
  counts: {
    signups: 0,
    ballots: 0,
  },
  notes: "Seed generado para pruebas reproducibles",
} as const;

const ed25519PrivateKeyHex =
  "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

const signed = await signSnapshot(snapshotBody as any, ed25519PrivateKeyHex);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = path.join(REPO_ROOT, "packages", "contracts", "generated-output");
await fs.mkdir(outDir, { recursive: true });

const manifestFile = path.join(outDir, "manifest.current.json");
await fs.writeFile(manifestFile, JSON.stringify(manifestBody, null, 2) + "\n", "utf8");

const outFile = path.join(outDir, `election_0_acta_apertura_${signed.signature.snapshotHashHex}.signed.json`);
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
      manifestFile,
      actaFile: outFile,
      manifestHash,
      candidates: candidateCatalog.length,
      snapshotHashHex: signed.signature.snapshotHashHex,
      registryAuthority: await rea.getAddress(),
      authority: await aea.getAddress(),
    },
    null,
    2,
  ),
);
