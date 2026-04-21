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

  if (!parsed.success && process.env.NODE_ENV !== "production") {
    throw new Error(parsed.error.message);
  }

  return { 
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NODE_ENV === "production" ? "" : (parsed.data?.NEXT_PUBLIC_EVIDENCE_API_URL || "") 
  };
}
