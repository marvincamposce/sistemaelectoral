import { network } from "hardhat";
import { deriveCoordinatorPublicKey } from "@blockurna/crypto";

async function main() {
  const { ethers } = await network.connect();
  const [aeaWallet] = await ethers.getSigners();
  const COORD_KEY = "0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa";
  const CONTRACT = "0x173402879dAbeff1B9970be891bD7CA5E2338641";

  const registry = await ethers.getContractAt("BU_PVP_1_ElectionRegistry", CONTRACT, aeaWallet);

  console.log(`\n=== SEPOLIA E2E START ===\n`);
  console.log(`Using account: ${aeaWallet.address}`);

  const coordPubKey = await deriveCoordinatorPublicKey(COORD_KEY);
  const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    e2e: true, ts: Date.now(), network: "sepolia" 
  })));
  
  console.log("1. Creating Election...");
  const tx1 = await registry.createElection(manifestHash, aeaWallet.address, coordPubKey);
  await tx1.wait();
  const eid = Number(await registry.electionCount()) - 1;
  console.log(`✅ Election created: id=${eid}`);

  console.log("2. Opening Registry...");
  await (await registry.openRegistry(eid)).wait();
  console.log(`✅ Registry opened`);

  console.log("3. Signing up Voter...");
  const voterWallet = ethers.Wallet.createRandom();
  const votingPubKey = voterWallet.signingKey.publicKey;
  const votingAddress = ethers.computeAddress(votingPubKey);
  
  const secretHex = ethers.hexlify(ethers.randomBytes(32));
  const registryNullifier = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "bytes32"], ["BU-PVP-1:nullifier", BigInt(eid), secretHex])
  );
  
  // The contract expects: keccak256(abi.encodePacked("BU-PVP-1:signup", electionId, registryNullifier, votingAddress))
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32", "address"],
      ["BU-PVP-1:signup", BigInt(eid), registryNullifier, votingAddress]
    )
  );
  
  const permitSig = await aeaWallet.signMessage(ethers.getBytes(digest));
  await (await registry.signup(eid, registryNullifier, votingPubKey, permitSig)).wait();
  console.log(`✅ Voter signed up: ${voterWallet.address}`);

  console.log("4. Closing Registry...");
  await (await registry.closeRegistry(eid)).wait();
  console.log(`✅ Registry closed`);

  console.log("5. Opening Voting...");
  await (await registry.openVoting(eid)).wait();
  console.log(`✅ Voting opened`);

  console.log("6. Casting Ballot...");
  const { encryptBallotPayload } = await import("@blockurna/crypto");
  const ballotPayload = {
    electionId: String(eid),
    selection: "cand-1",
    selectionIndex: 0,
    candidateId: "cand-1",
    candidateCode: "CAND_1",
    candidateLabel: "Candidate 1",
    timestamp: Date.now(),
  };
  const ciphertext = await encryptBallotPayload(ballotPayload, coordPubKey, { scheme: "ZK_FRIENDLY_V2" });
  const ciphertextBytes = ethers.getBytes(ciphertext);
  const ballotHash = ethers.keccak256(ciphertextBytes);
  const ballotDigest = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "bytes32"], ["BU-PVP-1:ballot", BigInt(eid), ballotHash])
  );
  const ballotSig = await voterWallet.signMessage(ethers.getBytes(ballotDigest));
  await (await registry.publishBallot(eid, votingPubKey, ciphertextBytes, ballotSig)).wait();
  console.log(`✅ Ballot cast`);

  console.log("7. Closing Voting...");
  await (await registry.closeVoting(eid)).wait();
  console.log(`✅ Voting closed`);

  console.log(`\n=== E2E SUCCESSFUL ON SEPOLIA! ===`);
  console.log(`Election ID: ${eid}`);
}

main().catch(e => { console.error(e); process.exit(1); });
