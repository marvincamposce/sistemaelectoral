import { network } from "hardhat";

const { ethers } = await network.connect();

const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("Missing deployer signer");

const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
const registry = (await Factory.connect(deployer).deploy()) as any;
await registry.waitForDeployment();

const address = await registry.getAddress();
const chain = await ethers.provider.getNetwork();

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "BU_PVP_1_ElectionRegistry",
      address,
      chainId: chain.chainId.toString(),
      deployer: await deployer.getAddress(),
    },
    null,
    2,
  ),
);
