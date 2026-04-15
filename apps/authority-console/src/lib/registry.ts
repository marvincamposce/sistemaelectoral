import { ethers } from "ethers";
import { assertValidTransition, type ElectoralEventType, type ElectoralPhase } from "@blockurna/shared";

export const REGISTRY_ABI = [
  "function createElection(bytes32 manifestHash,address registryAuthority,bytes coordinatorPubKey) returns (uint256)",
  "function getElection(uint256 electionId) view returns (tuple(bytes32 manifestHash,address authority,address registryAuthority,bytes coordinatorPubKey,uint8 phase,uint64 createdAtBlock))",
  "function signupCount(uint256 electionId) view returns (uint256)",
  "function ballotCount(uint256 electionId) view returns (uint256)",
  "function openRegistry(uint256 electionId)",
  "function closeRegistry(uint256 electionId)",
  "function openVoting(uint256 electionId)",
  "function closeVoting(uint256 electionId)",
  "function startProcessing(uint256 electionId)",
  "function finalizeProcessing(uint256 electionId)",
  "function publishResults(uint256 electionId)",
  "function openAuditWindow(uint256 electionId)",
  "function archiveElection(uint256 electionId)",
  "function publishActa(uint256 electionId,uint8 kind,bytes32 snapshotHash)",
  "event ElectionCreated(uint256 indexed electionId, bytes32 indexed manifestHash, address indexed authority, address registryAuthority, bytes coordinatorPubKey)",
] as const;

const PHASE_LABELS = [
  "SETUP",
  "REGISTRY_OPEN",
  "REGISTRY_CLOSED",
  "VOTING_OPEN",
  "VOTING_CLOSED",
  "PROCESSING",
  "TALLYING",
  "RESULTS_PUBLISHED",
  "AUDIT_WINDOW",
  "ARCHIVED",
] as const;

export function phaseLabelFromNumber(phase: number): ElectoralPhase {
  const label = PHASE_LABELS[phase] ?? "SETUP";
  return label as ElectoralPhase;
}

export const EVENT_TO_FUNCTION: Record<ElectoralEventType, string> = {
  OPEN_REGISTRY: "openRegistry",
  CLOSE_REGISTRY: "closeRegistry",
  OPEN_VOTING: "openVoting",
  CLOSE_VOTING: "closeVoting",
  START_PROCESSING: "startProcessing",
  FINALIZE_PROCESSING: "finalizeProcessing",
  PUBLISH_RESULTS: "publishResults",
  OPEN_AUDIT_WINDOW: "openAuditWindow",
  ARCHIVE_ELECTION: "archiveElection",
};

export function validateTransitionOrThrow(params: {
  currentPhase: ElectoralPhase;
  event: ElectoralEventType;
}): void {
  assertValidTransition(params.currentPhase, params.event);
}

export function getRegistry(address: string, signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(address, REGISTRY_ABI, signer);
}

export function parseElectionCreatedFromReceipt(params: {
  receipt: ethers.TransactionReceipt;
  contractAddress: string;
}): number | null {
  const iface = new ethers.Interface(REGISTRY_ABI);
  const target = params.contractAddress.toLowerCase();

  for (const log of params.receipt.logs) {
    if (String(log.address ?? "").toLowerCase() !== target) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "ElectionCreated") {
        const id = Number((parsed.args as any)?.electionId ?? (parsed.args as any)?.[0]);
        if (Number.isFinite(id)) return id;
      }
    } catch {
      continue;
    }
  }

  return null;
}
