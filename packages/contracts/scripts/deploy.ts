import { network } from "hardhat";

const { ethers } = await network.connect();

const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("Missing deployer signer");

const RegistryFactory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
const registry = (await RegistryFactory.connect(deployer).deploy()) as any;
await registry.waitForDeployment();

const Groth16Factory = await ethers.getContractFactory("Groth16Verifier");
const groth16Verifier = (await Groth16Factory.connect(deployer).deploy()) as any;
await groth16Verifier.waitForDeployment();

const TallyVerifierFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
const tallyVerifier = (await TallyVerifierFactory.connect(deployer).deploy(
  await groth16Verifier.getAddress(),
  await registry.getAddress(),
)) as any;
await tallyVerifier.waitForDeployment();
await (await registry.connect(deployer).setTallyVerifier(await tallyVerifier.getAddress())).wait();

const address = await registry.getAddress();
const groth16VerifierAddress = await groth16Verifier.getAddress();
const tallyVerifierAddress = await tallyVerifier.getAddress();
const chain = await ethers.provider.getNetwork();

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "BU_PVP_1_ElectionRegistry",
      address,
      groth16VerifierAddress,
      tallyVerifierAddress,
      chainId: chain.chainId.toString(),
      deployer: await deployer.getAddress(),
    },
    null,
    2,
  ),
);
