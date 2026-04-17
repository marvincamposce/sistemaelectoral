import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("BU_PVP_1_DecryptionVerifier", function () {
  it("requires a non-zero verifier address", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const RegistryFactory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await RegistryFactory.connect(deployer).deploy()) as any;
    await registry.waitForDeployment();

    const Factory = await ethers.getContractFactory("BU_PVP_1_DecryptionVerifier");
    await expect(
      Factory.connect(deployer).deploy(ethers.ZeroAddress, await registry.getAddress()),
    ).to.be.revert(ethers);
  });

  it("rejects empty job ids", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const GrothFactory = await ethers.getContractFactory("Groth16DecryptionVerifier");
    const groth = (await GrothFactory.connect(deployer).deploy()) as any;
    await groth.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await RegistryFactory.connect(deployer).deploy()) as any;
    await registry.waitForDeployment();

    const Factory = await ethers.getContractFactory("BU_PVP_1_DecryptionVerifier");
    const verifier = (await Factory.connect(deployer).deploy(
      await groth.getAddress(),
      await registry.getAddress(),
    )) as any;
    await verifier.waitForDeployment();
    await (await registry.connect(deployer).setDecryptionVerifier(await verifier.getAddress())).wait();

    await expect(
      verifier.verifyDecryptionProof(0n, "", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], []),
    ).to.be.revert(ethers);
  });

  it("reverts when proof is invalid", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const GrothFactory = await ethers.getContractFactory("Groth16DecryptionVerifier");
    const groth = (await GrothFactory.connect(deployer).deploy()) as any;
    await groth.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await RegistryFactory.connect(deployer).deploy()) as any;
    await registry.waitForDeployment();

    const Factory = await ethers.getContractFactory("BU_PVP_1_DecryptionVerifier");
    const verifier = (await Factory.connect(deployer).deploy(
      await groth.getAddress(),
      await registry.getAddress(),
    )) as any;
    await verifier.waitForDeployment();
    await (await registry.connect(deployer).setDecryptionVerifier(await verifier.getAddress())).wait();

    await expect(
      verifier.verifyDecryptionProof(0n, "job-invalid", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], [0n, 0n]),
    ).to.be.revert(ethers);
  });
});
