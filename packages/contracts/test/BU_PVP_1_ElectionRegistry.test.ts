import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

function uncompressedPublicKey(privateKey: string): string {
  return ethers.SigningKey.computePublicKey(privateKey, false);
}

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
    await expect(registry.connect(aea).publishResults(0)).to.be.revert(ethers);
    await expect(registry.connect(aea).setTallyVerifier(await rea.getAddress())).to.not.be.revert(ethers);
    await expect(registry.connect(aea).setDecryptionVerifier(await rea.getAddress())).to.not.be.revert(ethers);
    await expect(registry.connect(rea).recordTallyProofVerification(0)).to.not.be.revert(ethers);
    await expect(registry.connect(rea).recordDecryptionProofVerification(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).publishResults(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).openAuditWindow(0)).to.not.be.revert(ethers);
    await expect(registry.connect(aea).archiveElection(0)).to.not.be.revert(ethers);
  });

  it("only allows final publication after verifier callback records proof verification", async function () {
    const [aea, rea] = await ethers.getSigners();
    if (!aea || !rea) throw new Error("Missing signers");

    const RegistryFactory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await RegistryFactory.connect(aea).deploy()) as any;
    await registry.waitForDeployment();

    const GrothFactory = await ethers.getContractFactory("MockAlwaysValidGroth16Verifier");
    const groth = (await GrothFactory.connect(aea).deploy()) as any;
    await groth.waitForDeployment();

    const TallyFactory = await ethers.getContractFactory("BU_PVP_1_TallyVerifier");
    const tallyVerifier = (await TallyFactory.connect(aea).deploy(
      await groth.getAddress(),
      await registry.getAddress(),
    )) as any;
    await tallyVerifier.waitForDeployment();

    const DecryptionFactory = await ethers.getContractFactory("BU_PVP_1_DecryptionVerifier");
    const decryptionVerifier = (await DecryptionFactory.connect(aea).deploy(
      await groth.getAddress(),
      await registry.getAddress(),
    )) as any;
    await decryptionVerifier.waitForDeployment();

    await (await registry.connect(aea).setTallyVerifier(await tallyVerifier.getAddress())).wait();
    await (await registry.connect(aea).setDecryptionVerifier(await decryptionVerifier.getAddress())).wait();
    await (
      await registry
        .connect(aea)
        .createElection("0x" + "11".repeat(32), await rea.getAddress(), "0x" + "22".repeat(32))
    ).wait();
    await (await registry.connect(aea).openRegistry(0)).wait();
    await (await registry.connect(aea).closeRegistry(0)).wait();
    await (await registry.connect(aea).openVoting(0)).wait();
    await (await registry.connect(aea).closeVoting(0)).wait();
    await (await registry.connect(aea).startProcessing(0)).wait();
    await (await registry.connect(aea).finalizeProcessing(0)).wait();

    await expect(registry.connect(aea).publishResults(0)).to.be.revert(ethers);

    await expect(
      tallyVerifier.verifyTallyProof(0n, "job-ok", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], []),
    ).to.not.be.revert(ethers);

    expect(await registry.tallyProofVerified(0)).to.equal(true);
    expect(await registry.decryptionProofVerified(0)).to.equal(false);
    await expect(registry.connect(aea).publishResults(0)).to.be.revert(ethers);

    await expect(
      decryptionVerifier.verifyDecryptionProof(0n, "job-dec", [0n, 0n], [[0n, 0n], [0n, 0n]], [0n, 0n], []),
    ).to.not.be.revert(ethers);

    expect(await registry.decryptionProofVerified(0)).to.equal(true);
    await expect(registry.connect(aea).publishResults(0)).to.not.be.revert(ethers);
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
    const signupWallet = ethers.Wallet.createRandom();
    const votingPubKey = uncompressedPublicKey(signupWallet.privateKey);

    const digest = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256", "bytes32", "address"], ["BU-PVP-1:signup", 0, nullifier, signupWallet.address]),
    );
    const sig = await rea.signMessage(ethers.getBytes(digest));

    await expect(
      registry.connect(voter).signup(0, nullifier, votingPubKey, sig),
    ).to.not.be.revert(ethers);

    await expect(
      registry.connect(voter).signup(0, nullifier, votingPubKey, sig),
    ).to.be.revert(ethers);
  });

  it("requires a registered voting key and prevents double ballot casting", async function () {
    const [aea, rea, relayer] = await ethers.getSigners();
    if (!aea || !rea || !relayer) throw new Error("Missing signers");

    const Factory = await ethers.getContractFactory("BU_PVP_1_ElectionRegistry");
    const registry = (await Factory.connect(aea).deploy()) as any;
    await registry.waitForDeployment();

    await (
      await registry
        .connect(aea)
        .createElection("0x" + "11".repeat(32), await rea.getAddress(), "0x" + "22".repeat(32))
    ).wait();
    await (await registry.connect(aea).openRegistry(0)).wait();

    const votingWallet = ethers.Wallet.createRandom();
    const votingPubKey = uncompressedPublicKey(votingWallet.privateKey);
    const nullifier = "0x" + "33".repeat(32);
    const digest = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256", "bytes32", "address"], ["BU-PVP-1:signup", 0, nullifier, votingWallet.address]),
    );
    const permitSig = await rea.signMessage(ethers.getBytes(digest));

    await (
      await registry.connect(relayer).signup(0, nullifier, votingPubKey, permitSig)
    ).wait();
    await (await registry.connect(aea).closeRegistry(0)).wait();
    await (await registry.connect(aea).openVoting(0)).wait();

    const ciphertext = "0x1234";
    const ballotDigest = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256", "bytes32"], ["BU-PVP-1:ballot", 0, ethers.keccak256(ciphertext)]),
    );
    const ballotSig = await votingWallet.signMessage(ethers.getBytes(ballotDigest));
    const rogueWallet = ethers.Wallet.createRandom();

    await expect(
      registry.connect(relayer).publishBallot(0, votingPubKey, ciphertext, ballotSig),
    ).to.not.be.revert(ethers);

    await expect(
      registry.connect(relayer).publishBallot(0, votingPubKey, ciphertext, ballotSig),
    ).to.be.revert(ethers);

    await expect(
      registry.connect(relayer).publishBallot(
        0,
        uncompressedPublicKey(rogueWallet.privateKey),
        ciphertext,
        ballotSig,
      ),
    ).to.be.revert(ethers);
  });
});
