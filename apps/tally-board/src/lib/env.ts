export function getEnv() {
  const trusteeAllowlist = String(process.env.REMOTE_TRUSTEE_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [rawTrusteeId, rawAddress] = entry.split("=");
      const trusteeId = String(rawTrusteeId || "").trim().toUpperCase();
      const address = String(rawAddress || "").trim().toLowerCase();
      if (trusteeId && /^0x[0-9a-f]{40}$/.test(address)) {
        acc[trusteeId] = address;
      }
      return acc;
    }, {});

  return {
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    CHAIN_ID: String(process.env.CHAIN_ID || "31337"),
    ELECTION_REGISTRY_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS as string,
    TALLY_VERIFIER_ADDRESS:
      (process.env.TALLY_VERIFIER_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as string,
    DECRYPTION_VERIFIER_ADDRESS:
      (process.env.DECRYPTION_VERIFIER_ADDRESS || "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707") as string,
    AE_PRIVATE_KEY: process.env.AE_PRIVATE_KEY as string, 
    JED_PRIVATE_KEY: (process.env.JED_PRIVATE_KEY || process.env.AE_PRIVATE_KEY) as string,
    COORDINATOR_PRIVATE_KEY: process.env.COORDINATOR_PRIVATE_KEY || "",
    REMOTE_TRUSTEE_API_KEY: process.env.REMOTE_TRUSTEE_API_KEY || "",
    ENFORCE_REMOTE_TRUSTEE_API_KEY:
      String(process.env.ENFORCE_REMOTE_TRUSTEE_API_KEY || "false").toLowerCase() === "true",
    REMOTE_TRUSTEE_ALLOWLIST: trusteeAllowlist,
    NEXT_PUBLIC_EVIDENCE_API_URL: (typeof window !== "undefined" && process.env.NODE_ENV === "production") ? "" : (process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000"),
    DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/blockurna"
  };
}
