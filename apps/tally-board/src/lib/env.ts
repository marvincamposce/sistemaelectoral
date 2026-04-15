export function getEnv() {
  return {
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    ELECTION_REGISTRY_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS as string,
    AE_PRIVATE_KEY: process.env.AE_PRIVATE_KEY as string, 
    JED_PRIVATE_KEY: (process.env.JED_PRIVATE_KEY || process.env.AE_PRIVATE_KEY) as string,
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000",
    DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/blockurna"
  };
}
