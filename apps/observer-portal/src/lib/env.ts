import { z } from "zod";

const EnvSchema = z
  .object({
    NEXT_PUBLIC_EVIDENCE_API_URL: z.string().url().optional(),
    NEXT_PUBLIC_RPC_URL: z.string().url().optional(),
    NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      Boolean(v.NEXT_PUBLIC_EVIDENCE_API_URL) ||
      (Boolean(v.NEXT_PUBLIC_RPC_URL) && Boolean(v.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS)),
    {
      message:
        "Set NEXT_PUBLIC_EVIDENCE_API_URL (preferred) OR set NEXT_PUBLIC_RPC_URL + NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS",
    },
  );

export type PublicEnv =
  | { mode: "api"; NEXT_PUBLIC_EVIDENCE_API_URL: string }
  | {
      mode: "rpc";
      NEXT_PUBLIC_RPC_URL: string;
      NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS: string;
    };

export function getPublicEnv(): PublicEnv {
  const parsed = EnvSchema.safeParse({
    NEXT_PUBLIC_EVIDENCE_API_URL: process.env.NEXT_PUBLIC_EVIDENCE_API_URL,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS:
      process.env.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  if (parsed.data.NEXT_PUBLIC_EVIDENCE_API_URL) {
    return {
      mode: "api",
      NEXT_PUBLIC_EVIDENCE_API_URL: parsed.data.NEXT_PUBLIC_EVIDENCE_API_URL,
    };
  }

  return {
    mode: "rpc",
    NEXT_PUBLIC_RPC_URL: parsed.data.NEXT_PUBLIC_RPC_URL!,
    NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS:
      parsed.data.NEXT_PUBLIC_ELECTION_REGISTRY_ADDRESS!,
  };
}
