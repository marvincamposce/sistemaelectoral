export function getEnv() {
  return {
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    ELECTION_REGISTRY_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS as string,
    TALLY_VERIFIER_ADDRESS:
      (process.env.TALLY_VERIFIER_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as string,
    AE_PRIVATE_KEY: process.env.AE_PRIVATE_KEY as string, 
    JED_PRIVATE_KEY: (process.env.JED_PRIVATE_KEY || process.env.AE_PRIVATE_KEY) as string,
    COORDINATOR_PRIVATE_KEY: process.env.COORDINATOR_PRIVATE_KEY || "",
    ALLOW_LEGACY_COORDINATOR_KEY: String(process.env.ALLOW_LEGACY_COORDINATOR_KEY || "false").toLowerCase() === "true",
    REMOTE_TRUSTEE_API_KEY: process.env.REMOTE_TRUSTEE_API_KEY || "",
    ENFORCE_REMOTE_TRUSTEE_API_KEY:
      String(process.env.ENFORCE_REMOTE_TRUSTEE_API_KEY || "false").toLowerCase() === "true",
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000",
    DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/blockurna"
  };
}
