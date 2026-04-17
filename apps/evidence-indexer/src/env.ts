import { z } from "zod";

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    RPC_URL: z.string().url(),
    ELECTION_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    ACTA_SOURCE_DIR: z
      .string()
      .min(1)
      .optional()
      .default("packages/contracts/generated-output"),
    START_BLOCK: z.coerce.number().int().nonnegative().optional().default(0),
    CONFIRMATIONS: z.coerce.number().int().nonnegative().optional().default(0),
    BATCH_SIZE: z.coerce.number().int().positive().optional().default(2000),
    POLL_INTERVAL_MS: z.coerce.number().int().positive().optional().default(2000),
  })
  .passthrough();

export type EvidenceIndexerEnv = z.infer<typeof EnvSchema>;

export function getEnv(): EvidenceIndexerEnv {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}
