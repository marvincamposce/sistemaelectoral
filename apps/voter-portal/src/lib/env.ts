export function getPublicEnv() {
  const isBrowser = typeof window !== "undefined";
  const rawEvidenceUrl = process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:8000";
  const rawMrdUrl = process.env.NEXT_PUBLIC_MRD_API_URL || "http://localhost:8002";

  return {
    NEXT_PUBLIC_MRD_API_URL: (isBrowser && process.env.NODE_ENV === "production") ? "" : rawMrdUrl,
    NEXT_PUBLIC_EVIDENCE_API_URL: (isBrowser && process.env.NODE_ENV === "production") ? "" : rawEvidenceUrl,
    // Bug 2.2 fix: Dedicated env var instead of fragile port replacement hack.
    NEXT_PUBLIC_OBSERVER_PORTAL_URL: process.env.NEXT_PUBLIC_OBSERVER_PORTAL_URL || "https://sistemaelectoral-observer-portal.vercel.app",
  };
}
