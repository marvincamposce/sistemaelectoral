export function getPublicEnv() {
  return {
    NEXT_PUBLIC_MRD_API_URL: process.env.NEXT_PUBLIC_MRD_API_URL || "http://localhost:8002",
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000",
  };
}
