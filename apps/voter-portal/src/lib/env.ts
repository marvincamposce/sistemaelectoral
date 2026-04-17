export function getPublicEnv() {
  return {
    NEXT_PUBLIC_MRD_API_URL: process.env.NEXT_PUBLIC_MRD_API_URL || "http://localhost:8002",
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000",
    // Bug 2.2 fix: Dedicated env var instead of fragile port replacement hack.
    NEXT_PUBLIC_OBSERVER_PORTAL_URL: process.env.NEXT_PUBLIC_OBSERVER_PORTAL_URL || "http://localhost:3011",
  };
}
