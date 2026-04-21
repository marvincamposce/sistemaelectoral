import { z } from "zod";

const EnvSchema = z
  .object({
    NEXT_PUBLIC_EVIDENCE_API_URL: z.string(),
  })
  .strict();

export type PublicEnv = { NEXT_PUBLIC_EVIDENCE_API_URL: string };

export function getPublicEnv(): PublicEnv {
  const parsed = EnvSchema.safeParse({
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL,
  });

  const isBrowser = typeof window !== "undefined";

  if (!parsed.success && process.env.NODE_ENV !== "production") {
    throw new Error(parsed.error.message);
  }

  // Use absolute URL on server (to bypass proxy issues) and relative URL on client (to avoid Mixed Content)
  const rawUrl = parsed.data?.NEXT_PUBLIC_EVIDENCE_API_URL || "";
  return { 
    NEXT_PUBLIC_EVIDENCE_API_URL: (isBrowser && process.env.NODE_ENV === "production") ? "" : rawUrl 
  };
}
