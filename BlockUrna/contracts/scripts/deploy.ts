import fs from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";

const { ethers } = await network.connect();

const initialParties = [
  "Partido Azul",
  "Partido Verde",
  "Partido Rojo",
];

const ElectionFactory = await ethers.getContractFactory("BlockUrnaElection");
const election = await ElectionFactory.deploy(initialParties);
await election.waitForDeployment();

const address = await election.getAddress();
const { chainId } = await ethers.provider.getNetwork();

const abi = JSON.parse(ElectionFactory.interface.formatJson());

const out = {
  address,
  chainId: chainId.toString(),
  abi,
};

const outDir = path.join(process.cwd(), "..", "web", "src", "contracts");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(
  path.join(outDir, "BlockUrnaElection.json"),
  JSON.stringify(out, null, 2),
);

console.log(`BlockUrnaElection deployed: ${address} (chainId ${out.chainId})`);
console.log(
  `Exported ABI+address to: ${path.join("..", "web", "src", "contracts", "BlockUrnaElection.json")}`,
);
