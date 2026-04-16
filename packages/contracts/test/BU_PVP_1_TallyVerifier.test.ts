import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("BU_PVP_1_TallyVerifier", function () {
  it("requires a non-zero verifier address", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const Factory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
    await expect(Factory.connect(deployer).deploy(ethers.ZeroAddress)).to.be.revert(ethers);
  });

  it("rejects empty job ids", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const GrothFactory = await ethers.getContractFactory("Groth16Verifier");
    const groth = (await GrothFactory.connect(deployer).deploy()) as any;
    await groth.waitForDeployment();

    const TallyFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
    const tallyVerifier = (await TallyFactory.connect(deployer).deploy(await groth.getAddress())) as any;
    await tallyVerifier.waitForDeployment();

    await expect(
      tallyVerifier.verifyTallyProof(0n, "", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], []),
    ).to.be.revert(ethers);
  });

  it("reverts when proof is invalid", async function () {
    const [deployer] = await ethers.getSigners();
    if (!deployer) throw new Error("Missing deployer signer");

    const GrothFactory = await ethers.getContractFactory("Groth16Verifier");
    const groth = (await GrothFactory.connect(deployer).deploy()) as any;
    await groth.waitForDeployment();

    const TallyFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
    const tallyVerifier = (await TallyFactory.connect(deployer).deploy(await groth.getAddress())) as any;
    await tallyVerifier.waitForDeployment();

    await expect(
      tallyVerifier.verifyTallyProof(0n, "job-invalid", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], [0n, 0n]),
    ).to.be.revert(ethers);
  });
});
