import { ethers, type Provider } from "ethers";

export type ElectionRegistryElection = {
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: bigint;
  createdAtBlock: bigint;
};

// Minimal ABI fragments required by BU-PVP-1 observer/audit scaffolds.
// TODO: replace with generated ABI exported from packages/contracts artifacts.
export const BU_PVP_1_ELECTION_REGISTRY_ABI = [
  "function electionCount() view returns (uint256)",
  "function getElection(uint256 electionId) view returns (tuple(bytes32 manifestHash,address authority,address registryAuthority,bytes coordinatorPubKey,uint8 phase,uint64 createdAtBlock))",
  "function signupCount(uint256 electionId) view returns (uint256)",
  "function ballotCount(uint256 electionId) view returns (uint256)",
  "function tallyVerifier() view returns (address)",
  "function tallyProofVerified(uint256 electionId) view returns (bool)",
  "function createElection(bytes32 manifestHash,address registryAuthority,bytes coordinatorPubKey) returns (uint256)",
  "function setTallyVerifier(address verifier)",
  "function openRegistry(uint256 electionId)",
  "function closeRegistry(uint256 electionId)",
  "function openVoting(uint256 electionId)",
  "function closeVoting(uint256 electionId)",
  "function startProcessing(uint256 electionId)",
  "function finalizeProcessing(uint256 electionId)",
  "function publishResults(uint256 electionId)",
  "function openAuditWindow(uint256 electionId)",
  "function archiveElection(uint256 electionId)",
  "function signup(uint256 electionId, bytes32 registryNullifier, bytes votingPubKey, bytes permitSig)",
  "function publishBallot(uint256 electionId, bytes votingPubKey, bytes ciphertext, bytes ballotSig)",
  "function publishActa(uint256 electionId, uint8 kind, bytes32 snapshotHash)",
  "function publishTallyTranscriptCommitment(uint256 electionId, bytes commitmentPayload)",
  "function recordTallyProofVerification(uint256 electionId)",
  "event ElectionCreated(uint256 indexed electionId, bytes32 indexed manifestHash, address indexed authority, address registryAuthority, bytes coordinatorPubKey)",
  "event PhaseChanged(uint256 indexed electionId, uint8 previousPhase, uint8 newPhase)",
  "event SignupRecorded(uint256 indexed electionId, bytes32 indexed registryNullifier, bytes votingPubKey)",
  "event BallotPublished(uint256 indexed electionId, uint256 indexed ballotIndex, bytes32 indexed ballotHash, bytes ciphertext)",
  "event ActaPublished(uint256 indexed electionId, uint8 kind, bytes32 indexed snapshotHash)",
  "event TallyTranscriptCommitmentPublished(uint256 indexed electionId, bytes32 indexed commitmentHash, bytes commitmentPayload)",
  "event TallyVerifierUpdated(address indexed previousVerifier, address indexed newVerifier)",
  "event TallyProofVerificationRecorded(uint256 indexed electionId, address indexed verifier)",
] as const;

export const BU_PVP_1_TALLY_VERIFIER_ABI = [
  "function groth16Verifier() view returns (address)",
  "function electionRegistry() view returns (address)",
  "function verifyTallyProof(uint256 electionId, string jobId, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] input) returns (bool)",
  "event TallyProofVerifiedOnChain(uint256 indexed electionId, bytes32 indexed jobIdHash, bytes32 indexed proofHash, bytes32 publicInputsHash, address verifierContract)",
] as const;

type ElectionRegistryContract = ethers.Contract & {
  electionCount: () => Promise<bigint>;
  getElection: (electionId: number) => Promise<ElectionRegistryElection>;
  signupCount: (electionId: number) => Promise<bigint>;
  ballotCount: (electionId: number) => Promise<bigint>;
  filters: {
    ActaPublished: (electionId?: number) => ethers.EventFilter;
  };
  queryFilter: (
    event: ethers.EventFilter,
    fromBlock?: number | string,
    toBlock?: number | string,
  ) => Promise<Array<ethers.Log | ethers.EventLog>>;
};

export function getElectionRegistry(
  address: string,
  provider: Provider,
): ethers.Contract {
  return new ethers.Contract(address, BU_PVP_1_ELECTION_REGISTRY_ABI, provider);
}

export async function fetchElectionCount(
  address: string,
  provider: Provider,
): Promise<number> {
  const c = getElectionRegistry(address, provider) as unknown as ElectionRegistryContract;
  const count = await c.electionCount();
  return Number(count);
}

export async function fetchElection(
  address: string,
  provider: Provider,
  electionId: number,
): Promise<ElectionRegistryElection> {
  const c = getElectionRegistry(address, provider) as unknown as ElectionRegistryContract;
  const e = await c.getElection(electionId);
  return e;
}

export async function fetchElectionCounters(
  address: string,
  provider: Provider,
  electionId: number,
): Promise<{ signups: bigint; ballots: bigint }> {
  const c = getElectionRegistry(address, provider) as unknown as ElectionRegistryContract;
  const [signups, ballots] = await Promise.all([
    c.signupCount(electionId),
    c.ballotCount(electionId),
  ]);
  return { signups, ballots };
}

export async function fetchActaAnchors(
  address: string,
  provider: Provider,
  electionId: number,
): Promise<Array<{ kind: number; snapshotHash: string; blockNumber: number; txHash: string }>> {
  const c = getElectionRegistry(address, provider) as unknown as ElectionRegistryContract;
  const filter = c.filters.ActaPublished(electionId);
  const logs = await c.queryFilter(filter, 0, "latest");

  return logs
    .filter((l): l is ethers.EventLog => "args" in l)
    .map((l) => {
      const kind = Number((l.args as any)?.kind ?? 0);
      const snapshotHash = String((l.args as any)?.snapshotHash ?? "0x");
      return {
        kind,
        snapshotHash,
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
      };
    });
}
