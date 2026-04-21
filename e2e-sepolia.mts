import { ethers } from "ethers";
import { deriveCoordinatorPublicKey } from "@blockurna/crypto";

// SEPOLIA CONFIG
const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth_sepolia/b8ec123d573ff7290be5cc863464f8cec25cb3c06e5b4eded7b84db75b67d60f");
const AEA_KEY = "913c3d7b30d31d0281e6d24b464335ab42abba8e07aaee3ebfb2a98e5f1dd094";
const REA_KEY = AEA_KEY; 
const COORD_KEY = "0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa";
const CONTRACT = "0x173402879dAbeff1B9970be891bD7CA5E2338641";

const aeaWallet = new ethers.Wallet(AEA_KEY, provider);
const coordWallet = new ethers.Wallet(COORD_KEY);

const ABI = [
  "function createElection(bytes32 manifestHash, address registryAuthority, bytes coordinatorPubKey) returns (uint256)",
  "function electionCount() view returns (uint256)",
  "function getElection(uint256) view returns (tuple(bytes32 manifestHash, address authority, address registryAuthority, bytes coordinatorPubKey, uint8 phase, uint64 createdAtBlock))",
  "function openRegistry(uint256 electionId)",
  "function closeRegistry(uint256 electionId)",
  "function openVoting(uint256 electionId)",
  "function closeVoting(uint256 electionId)",
  "function startProcessing(uint256 electionId)",
  "function finalizeProcessing(uint256 electionId)",
  "function publishResults(uint256 electionId)",
  "function publishActa(uint256 electionId, uint8 kind, bytes32 snapshotHash)",
  "function signup(uint256 electionId, bytes32 registryNullifier, bytes votingPubKey, bytes permitSig)",
  "function publishBallot(uint256 electionId, bytes votingPubKey, bytes ciphertext, bytes ballotSig)",
  "function signupCount(uint256) view returns (uint256)",
  "function ballotCount(uint256) view returns (uint256)",
  "function tallyProofVerified(uint256) view returns (bool)",
  "function decryptionProofVerified(uint256) view returns (bool)",
];

const registry = new ethers.Contract(CONTRACT, ABI, aeaWallet);

const step = process.argv[2];

async function createElection() {
  const coordPubKey = await deriveCoordinatorPublicKey(COORD_KEY);
  console.log("Coordinator BabyJub pubkey:", coordPubKey);
  console.log("Coordinator address:", coordWallet.address);
  
  const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    e2e: true, ts: Date.now(), coord: coordPubKey, network: "sepolia" 
  })));
  
  console.log("Sending createElection transaction...");
  const tx = await registry.createElection(manifestHash, aeaWallet.address, coordPubKey);
  const r = await tx.wait();
  const count = Number(await registry.electionCount());
  const eid = count - 1;
  console.log(`✅ Election created: id=${eid}, tx=${tx.hash}, block=${r.blockNumber}`);
  const el = await registry.getElection(eid);
  console.log(`   Phase: ${el.phase} (SETUP=0)`);
  return eid;
}

async function openReg(eid: number) {
  const tx = await registry.openRegistry(eid);
  await tx.wait();
  console.log(`✅ Registry opened for election ${eid}, tx=${tx.hash}`);
}

async function signupVoter(eid: number) {
  const voterWallet = ethers.Wallet.createRandom();
  const votingPubKey = voterWallet.signingKey.publicKey;
  console.log(`Voter ephemeral address: ${voterWallet.address}`);
  
  const secretHex = ethers.hexlify(ethers.randomBytes(32));
  const registryNullifier = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:nullifier", BigInt(eid), secretHex]
    )
  );
  
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:signup", BigInt(eid), registryNullifier]
    )
  );
  
  const reaWallet = new ethers.Wallet(REA_KEY, provider);
  const permitSig = await reaWallet.signMessage(ethers.getBytes(digest));
  
  const tx = await registry.signup(eid, registryNullifier, votingPubKey, permitSig);
  const r = await tx.wait();
  console.log(`✅ Signup successful: tx=${tx.hash}, block=${r.blockNumber}`);
  
  return { voterWallet, votingPubKey, registryNullifier };
}

async function openVoting(eid: number) {
  const tx = await registry.openVoting(eid);
  await tx.wait();
  console.log(`✅ Voting opened for election ${eid}, tx=${tx.hash}`);
}

async function castBallot(eid: number, voterPrivKey: string, votingPubKey: string) {
  const voterWallet = new ethers.Wallet(voterPrivKey, provider);
  const { encryptBallotPayload } = await import("@blockurna/crypto");
  
  const election = await registry.getElection(eid);
  const coordPubKeyOnChain = election.coordinatorPubKey;
  
  const ballotPayload = {
    electionId: String(eid),
    selection: "cand-1",
    selectionIndex: 0,
    candidateId: "cand-1",
    candidateCode: "CAND_1",
    candidateLabel: "Candidate 1",
    timestamp: Date.now(),
  };
  
  const ciphertext = await encryptBallotPayload(ballotPayload, coordPubKeyOnChain, { scheme: "ZK_FRIENDLY_V2" });
  const ciphertextBytes = ethers.getBytes(ciphertext);
  const ballotHash = ethers.keccak256(ciphertextBytes);
  const ballotDigest = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "bytes32"], ["BU-PVP-1:ballot", BigInt(eid), ballotHash])
  );
  const ballotSig = await voterWallet.signMessage(ethers.getBytes(ballotDigest));
  
  const tx = await registry.publishBallot(eid, votingPubKey, ciphertextBytes, ballotSig);
  await tx.wait();
  console.log(`✅ Ballot published: tx=${tx.hash}`);
}

async function closeVotingPhase(eid: number) {
  const tx = await registry.closeVoting(eid);
  await tx.wait();
  console.log(`✅ Voting closed for election ${eid}, tx=${tx.hash}`);
}

async function main() {
  console.log(`\n=== SEPOLIA E2E: ${step} ===\n`);
  if (step === "create") await createElection();
  else if (step === "open-registry") await openReg(Number(process.argv[3]));
  else if (step === "signup") {
    const res = await signupVoter(Number(process.argv[3]));
    console.log(`\n📋 SAVE FOR BALLOT:`);
    console.log(`   voterPrivKey=${res.voterWallet.privateKey}`);
    console.log(`   votingPubKey=${res.votingPubKey}`);
  }
  else if (step === "open-voting") await openVoting(Number(process.argv[3]));
  else if (step === "cast-ballot") await castBallot(Number(process.argv[3]), process.argv[4], process.argv[5]);
  else if (step === "close-voting") await closeVotingPhase(Number(process.argv[3]));
  else if (step === "status") {
    const eid = Number(process.argv[3]);
    const el = await registry.getElection(eid);
    console.log(`Election ${eid} Phase: ${el.phase}`);
    console.log(`Signups: ${await registry.signupCount(eid)}`);
    console.log(`Ballots: ${await registry.ballotCount(eid)}`);
  }
}

main().catch(e => { console.error("❌ ERROR:", e); process.exit(1); });
