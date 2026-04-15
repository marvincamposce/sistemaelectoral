import { z } from "zod";

export const ProtocolVersionSchema = z.literal("BU-PVP-1");
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const Hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 0x-prefixed 32-byte hex");

export const HexBytesSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, "Expected 0x-prefixed hex");

export const EthAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected 0x-prefixed 20-byte hex address")
  .transform((v) => v.toLowerCase());

export type EthAddress = z.infer<typeof EthAddressSchema>;

export const ChainIdSchema = z.union([z.string(), z.number()]).transform(String);
export type ChainId = z.infer<typeof ChainIdSchema>;

export const ElectionIdSchema = z.union([z.string(), z.number()]).transform(String);
export type ElectionId = z.infer<typeof ElectionIdSchema>;

export const BlockNumberSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === "number" ? v : Number(v)));

export type BlockNumber = z.infer<typeof BlockNumberSchema>;

export const BlockRangeSchema = z.object({
  fromBlock: BlockNumberSchema,
  toBlock: BlockNumberSchema,
});

export type BlockRange = z.infer<typeof BlockRangeSchema>;

export const SnapshotKindSchema = z.enum([
  "ACTA_APERTURA",
  "ACTA_CIERRE",
  "ACTA_ESCRUTINIO",
  "ACTA_RESULTADOS",
]);

export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;

export const EvidenceCommitmentsSchema = z
  .object({
    manifestHash: Hex32Schema,
    stateRoot: Hex32Schema.optional(),
    messageRoot: Hex32Schema.optional(),
    tallyCommitment: Hex32Schema.optional(),
  })
  .strict();

export type EvidenceCommitments = z.infer<typeof EvidenceCommitmentsSchema>;

export const SnapshotBodySchema = z
  .object({
    snapshotVersion: z.literal("1"),
    protocolVersion: ProtocolVersionSchema,
    electionId: ElectionIdSchema,
    kind: SnapshotKindSchema,
    generatedAt: z.string(),
    chainId: ChainIdSchema,
    blockRange: BlockRangeSchema,
    commitments: EvidenceCommitmentsSchema,
    counts: z
      .object({
        signups: z.number().int().nonnegative().optional(),
        ballots: z.number().int().nonnegative().optional(),
      })
      .partial()
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

export type SnapshotBody = z.infer<typeof SnapshotBodySchema>;

export const SignatureEnvelopeSchema = z
  .object({
    algorithm: z.literal("ed25519-sha256-jcs"),
    publicKeyHex: HexBytesSchema,
    signatureHex: HexBytesSchema,
    snapshotHashHex: Hex32Schema,
  })
  .strict();

export type SignatureEnvelope = z.infer<typeof SignatureEnvelopeSchema>;

export const SignedSnapshotSchema = z
  .object({
    snapshot: SnapshotBodySchema,
    signature: SignatureEnvelopeSchema,
  })
  .strict();

export type SignedSnapshot = z.infer<typeof SignedSnapshotSchema>;

// --- Registry Authority (REA) — experimental eligibility scaffold ---

export const RegistryCredentialSchema = z
  .object({
    credentialVersion: z.literal("1"),
    protocolVersion: ProtocolVersionSchema,
    credentialId: Hex32Schema,
    issuedAt: z.string(),
    registryAuthority: EthAddressSchema.optional(),
    subjectLabel: z.string().max(200).optional(),
    secretHex: Hex32Schema,
  })
  .strict();

export type RegistryCredential = z.infer<typeof RegistryCredentialSchema>;

export const SignupPermitSchema = z
  .object({
    permitVersion: z.literal("1"),
    protocolVersion: ProtocolVersionSchema,
    chainId: ChainIdSchema,
    contractAddress: EthAddressSchema,
    electionId: ElectionIdSchema,
    registryNullifier: Hex32Schema,
    credentialId: Hex32Schema,
    issuedAt: z.string(),
    issuerAddress: EthAddressSchema,
    permitSig: HexBytesSchema,
  })
  .strict();

export type SignupPermit = z.infer<typeof SignupPermitSchema>;
