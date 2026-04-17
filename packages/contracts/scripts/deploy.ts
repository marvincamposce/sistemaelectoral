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

const Groth16DecryptionFactory = await ethers.getContractFactory("Groth16DecryptionVerifier");
const groth16DecryptionVerifier = (await Groth16DecryptionFactory.connect(deployer).deploy()) as any;
await groth16DecryptionVerifier.waitForDeployment();

const TallyVerifierFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
const tallyVerifier = (await TallyVerifierFactory.connect(deployer).deploy(
  await groth16Verifier.getAddress(),
  await registry.getAddress(),
)) as any;
await tallyVerifier.waitForDeployment();
await (await registry.connect(deployer).setTallyVerifier(await tallyVerifier.getAddress())).wait();

const DecryptionVerifierFactory = await ethers.getContractFactory("BU_PVP_1_DecryptionVerifier");
const decryptionVerifier = (await DecryptionVerifierFactory.connect(deployer).deploy(
  await groth16DecryptionVerifier.getAddress(),
  await registry.getAddress(),
)) as any;
await decryptionVerifier.waitForDeployment();
await (await registry.connect(deployer).setDecryptionVerifier(await decryptionVerifier.getAddress())).wait();

const address = await registry.getAddress();
const groth16VerifierAddress = await groth16Verifier.getAddress();
const groth16DecryptionVerifierAddress = await groth16DecryptionVerifier.getAddress();
const tallyVerifierAddress = await tallyVerifier.getAddress();
const decryptionVerifierAddress = await decryptionVerifier.getAddress();
const chain = await ethers.provider.getNetwork();

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "BU_PVP_1_ElectionRegistry",
      address,
      groth16VerifierAddress,
      groth16DecryptionVerifierAddress,
      tallyVerifierAddress,
      decryptionVerifierAddress,
      chainId: chain.chainId.toString(),
      deployer: await deployer.getAddress(),
    },
    null,
    2,
  ),
);
