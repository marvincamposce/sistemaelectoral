import { network } from "hardhat";

async function main() {
  const registryAddress = process.env.ELECTION_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error("ELECTION_REGISTRY_ADDRESS is required");
  }

  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  const groth16VerifierFactory = await ethers.getContractFactory("Groth16Verifier", deployer);
  const groth16Verifier = await groth16VerifierFactory.deploy();
  await groth16Verifier.waitForDeployment();

  const tallyVerifierFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier", deployer);
  const tallyVerifier = await tallyVerifierFactory.deploy(
    await groth16Verifier.getAddress(),
    registryAddress,
  );
  await tallyVerifier.waitForDeployment();

  const groth16DecryptionVerifierFactory = await ethers.getContractFactory(
    "Groth16DecryptionVerifier",
    deployer,
  );
  const groth16DecryptionVerifier = await groth16DecryptionVerifierFactory.deploy();
  await groth16DecryptionVerifier.waitForDeployment();

  const decryptionVerifierFactory = await ethers.getContractFactory(
    "BU_PVP_1_DecryptionVerifier",
    deployer,
  );
  const decryptionVerifier = await decryptionVerifierFactory.deploy(
    await groth16DecryptionVerifier.getAddress(),
    registryAddress,
  );
  await decryptionVerifier.waitForDeployment();

  const registry = await ethers.getContractAt("BU_PVP_1_ElectionRegistry", registryAddress, deployer);
  await (await registry.setTallyVerifier(await tallyVerifier.getAddress())).wait();
  await (await registry.setDecryptionVerifier(await decryptionVerifier.getAddress())).wait();

  console.log(
    JSON.stringify(
      {
        ok: true,
        deployer: await deployer.getAddress(),
        registryAddress,
        groth16VerifierAddress: await groth16Verifier.getAddress(),
        tallyVerifierAddress: await tallyVerifier.getAddress(),
        groth16DecryptionVerifierAddress: await groth16DecryptionVerifier.getAddress(),
        decryptionVerifierAddress: await decryptionVerifier.getAddress(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
