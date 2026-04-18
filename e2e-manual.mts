import { ethers } from "ethers";
import { deriveCoordinatorPublicKey } from "@blockurna/crypto";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const AEA_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const REA_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // same as AEA for dev
const COORD_KEY = "0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa";
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

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
    e2e: true, ts: Date.now(), coord: coordPubKey 
  })));
  
  const tx = await registry.createElection(manifestHash, aeaWallet.address, coordPubKey);
  const r = await tx.wait();
  const count = Number(await registry.electionCount());
  const eid = count - 1;
  console.log(`✅ Election created: id=${eid}, tx=${tx.hash}, block=${r.blockNumber}`);
  const el = await registry.getElection(eid);
  console.log(`   Phase: ${el.phase} (SETUP=0), coordPubKey stored: ${el.coordinatorPubKey.substring(0,20)}...`);
  return eid;
}

async function openReg(eid: number) {
  const tx = await registry.openRegistry(eid);
  await tx.wait();
  console.log(`✅ Registry opened for election ${eid}, tx=${tx.hash}`);
}

async function signupVoter(eid: number) {
  // Generate voter ephemeral keypair
  const voterWallet = ethers.Wallet.createRandom();
  // CRITICAL: contract requires uncompressed pubkey (65 bytes, 0x04 prefix)
  const votingPubKey = voterWallet.signingKey.publicKey;
  console.log(`Voter ephemeral address: ${voterWallet.address}`);
  console.log(`Voter uncompressed pubkey: ${votingPubKey.substring(0,20)}...`);
  
  // Generate permit: nullifier + REA signature
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
  
  // REA signs the digest
  const reaWallet = new ethers.Wallet(REA_KEY, provider);
  const permitSig = await reaWallet.signMessage(ethers.getBytes(digest));
  
  console.log(`Nullifier: ${registryNullifier}`);
  console.log(`PermitSig: ${permitSig.substring(0, 20)}...`);
  
  // Call signup directly on-chain (bypassing relayer for reliability)
  const tx = await registry.signup(eid, registryNullifier, votingPubKey, permitSig);
  const r = await tx.wait();
  console.log(`✅ Signup successful: tx=${tx.hash}, block=${r.blockNumber}`);
  
  const count = await registry.signupCount(eid);
  console.log(`   Signup count: ${count}`);
  
  // Return data needed for ballot
  return { voterWallet, votingPubKey, registryNullifier };
}

async function closeReg(eid: number) {
  const tx = await registry.closeRegistry(eid);
  await tx.wait();
  console.log(`✅ Registry closed for election ${eid}, tx=${tx.hash}`);
}

async function openVoting(eid: number) {
  const tx = await registry.openVoting(eid);
  await tx.wait();
  console.log(`✅ Voting opened for election ${eid}, tx=${tx.hash}`);
}

async function castBallot(
  eid: number,
  voterPrivKey: string,
  votingPubKey: string,
  selection: string = "cand-1",
) {
  const voterWallet = new ethers.Wallet(voterPrivKey, provider);
  
  // Import the encryption function  
  const { encryptBallotPayload } = await import("@blockurna/crypto");
  
  // Get coordinator pubkey from chain  
  const election = await registry.getElection(eid);
  const coordPubKeyOnChain = election.coordinatorPubKey;
  console.log(`Coordinator pubkey from chain: ${coordPubKeyOnChain.substring(0,20)}...`);
  
  // Encrypt ballot - selectionIndex=0 means first candidate
  const ballotPayload = {
    electionId: String(eid),
    selection,
    selectionIndex: selection === "cand-2" ? 1 : 0,
    candidateId: selection,
    candidateCode: selection === "cand-2" ? "CAND_2" : "CAND_1",
    candidateLabel: selection === "cand-2" ? "Candidate 2" : "Candidate 1",
    timestamp: Date.now(),
  };
  
  const ciphertext = await encryptBallotPayload(
    ballotPayload,
    coordPubKeyOnChain,
    { scheme: "ZK_FRIENDLY_V2" }
  );
  console.log(`Ciphertext length: ${ciphertext.length} chars`);
  
  // Sign the ballot: digest = keccak256(abi.encodePacked("BU-PVP-1:ballot", electionId, keccak256(ciphertext)))
  const ciphertextBytes = ethers.getBytes(ciphertext);
  const ballotHash = ethers.keccak256(ciphertextBytes);
  const ballotDigest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:ballot", BigInt(eid), ballotHash]
    )
  );
  const ballotSig = await voterWallet.signMessage(ethers.getBytes(ballotDigest));
  
  console.log(`BallotHash: ${ballotHash}`);
  console.log(`BallotSig: ${ballotSig.substring(0, 20)}...`);
  
  // Publish ballot directly on-chain
  const tx = await registry.publishBallot(eid, votingPubKey, ciphertextBytes, ballotSig);
  const r = await tx.wait();
  console.log(`✅ Ballot published: tx=${tx.hash}, block=${r.blockNumber}`);
  
  const count = await registry.ballotCount(eid);
  console.log(`   Ballot count: ${count}`);
  
  return { ballotHash, ciphertext };
}

async function closeVotingPhase(eid: number) {
  const tx = await registry.closeVoting(eid);
  await tx.wait();
  console.log(`✅ Voting closed for election ${eid}, tx=${tx.hash}`);
}

async function startProc(eid: number) {
  const tx = await registry.startProcessing(eid);
  await tx.wait();
  console.log(`✅ Processing started for election ${eid}, tx=${tx.hash}`);
}

async function finalizeProc(eid: number) {
  const tx = await registry.finalizeProcessing(eid);
  await tx.wait();
  console.log(`✅ Processing finalized (TALLYING) for election ${eid}, tx=${tx.hash}`);
}

async function checkStatus(eid: number) {
  const el = await registry.getElection(eid);
  const phases = ["SETUP","REGISTRY_OPEN","REGISTRY_CLOSED","VOTING_OPEN","VOTING_CLOSED","PROCESSING","TALLYING","RESULTS_PUBLISHED","AUDIT_WINDOW","ARCHIVED"];
  console.log(`Election ${eid}: phase=${el.phase} (${phases[el.phase]})`);
  console.log(`  Signups: ${await registry.signupCount(eid)}`);
  console.log(`  Ballots: ${await registry.ballotCount(eid)}`);
  console.log(`  TallyProofVerified: ${await registry.tallyProofVerified(eid)}`);
  console.log(`  DecryptionProofVerified: ${await registry.decryptionProofVerified(eid)}`);
}

// Main dispatcher
async function main() {
  console.log(`\n=== E2E Step: ${step} ===\n`);
  
  if (step === "create") {
    await createElection();
  } else if (step === "open-registry") {
    await openReg(Number(process.argv[3]));
  } else if (step === "signup") {
    const eid = Number(process.argv[3]);
    const result = await signupVoter(eid);
    // Print voter private key for next step
    console.log(`\n📋 SAVE FOR BALLOT STEP:`);
    console.log(`   voterPrivKey=${result.voterWallet.privateKey}`);
    console.log(`   votingPubKey=${result.votingPubKey}`);
  } else if (step === "close-registry") {
    await closeReg(Number(process.argv[3]));
  } else if (step === "open-voting") {
    await openVoting(Number(process.argv[3]));
  } else if (step === "cast-ballot") {
    const eid = Number(process.argv[3]);
    const voterPrivKey = process.argv[4];
    const votingPubKey = process.argv[5];
    const selection = process.argv[6] ?? "cand-1";
    if (!voterPrivKey || !votingPubKey) {
      console.error("Usage: cast-ballot <eid> <voterPrivKey> <votingPubKey> [selection]");
      process.exit(1);
    }
    await castBallot(eid, voterPrivKey, votingPubKey, selection);
  } else if (step === "close-voting") {
    await closeVotingPhase(Number(process.argv[3]));
  } else if (step === "start-processing") {
    await startProc(Number(process.argv[3]));
  } else if (step === "finalize-processing") {
    await finalizeProc(Number(process.argv[3]));
  } else if (step === "status") {
    await checkStatus(Number(process.argv[3]));
  } else {
    console.log("Steps: create, open-registry, signup, close-registry, open-voting, cast-ballot, close-voting, start-processing, finalize-processing, status");
  }
}

main().catch(e => { console.error("❌ ERROR:", e.message || e); process.exit(1); });
