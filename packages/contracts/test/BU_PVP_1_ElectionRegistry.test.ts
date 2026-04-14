import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("BU_PVP_1_ElectionRegistry", function () {
  it("enforces the BU-PVP-1 phase machine", async function () {
    const [aea, rea] = await ethers.getSigners();
    if (!aea || !rea) throw new Error("Missing signers");

    const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await Factory.connect(aea).deploy()) as any;
    await registry.waitForDeployment();

    const manifestHash = "0x" + "11".repeat(32);
    const coordinatorPubKey = "0x" + "22".repeat(32);

    const tx = await registry
      .connect(aea)
      .createElection(manifestHash, await rea.getAddress(), coordinatorPubKey);
    await tx.wait();

    await expect(registry.connect(aea).openVoting(0)).to.be.revert(ethers);

    await expect(registry.connect(aea).openRegistry(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).closeRegistry(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).openVoting(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).closeVoting(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).startProcessing(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).finalizeProcessing(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).publishResults(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).openAuditWindow(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).archiveElection(0)).to.not.be.revert(ethers);
  });

  it("records signup with REA permit signature and prevents nullifier reuse", async function () {
    const [aea, rea, voter] = await ethers.getSigners();
    if (!aea || !rea || !voter) throw new Error("Missing signers");

    const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await Factory.connect(aea).deploy()) as any;
    await registry.waitForDeployment();

    const manifestHash = "0x" + "11".repeat(32);
    const coordinatorPubKey = "0x" + "22".repeat(32);
    await (await registry.connect(aea).createElection(manifestHash, await rea.getAddress(), coordinatorPubKey)).wait();
    await (await registry.connect(aea).openRegistry(0)).wait();

    const nullifier = "0x" + "33".repeat(32);
    const votingPubKey = "0x" + "44".repeat(32);

    const digest = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256", "bytes32"], ["BU-PVP-1:signup", 0, nullifier]),
    );
    const sig = await rea.signMessage(ethers.getBytes(digest));

    await expect(
      registry.connect(voter).signup(0, nullifier, votingPubKey, sig),
    ).to.not.be.revert(ethers);

    await expect(
      registry.connect(voter).signup(0, nullifier, votingPubKey, sig),
    ).to.be.revert(ethers);
  });
});
