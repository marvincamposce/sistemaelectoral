import { z } from "zod";

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    CHAIN_ID: z.string().min(1),
    ELECTION_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    REA_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    HOST: z.string().min(1).optional().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().optional().default(3020),
  })
  .passthrough();

export type EvidenceApiEnv = z.infer<typeof EnvSchema>;

export function getEnv(): EvidenceApiEnv {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}
