import { z } from "zod";

export const ProtocolVersionSchema = z.literal("BU-PVP-1");
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const Hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 0x-prefixed 32-byte hex");

export const HexBytesSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, "Expected 0x-prefixed hex");

export const Hex24Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{48}$/, "Expected 0x-prefixed 24-byte hex");

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

// --- Ballot encryption envelope (real ciphertext transport) ---

export const BallotCiphertextEnvelopeVersionSchema = z.union([
  z.literal("BU-PVP-1_BALLOT_X25519_XCHACHA20_V1"),
  z.literal("BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2"),
]);

export const BallotCiphertextEnvelopeV1Schema = z
  .object({
    version: z.literal("BU-PVP-1_BALLOT_X25519_XCHACHA20_V1"),
    kdf: z.literal("X25519"),
    aead: z.literal("XCHACHA20POLY1305"),
    ephemeralPublicKeyHex: Hex32Schema,
    nonceHex: Hex24Schema,
    ciphertextHex: HexBytesSchema.refine((v) => v.length > 2, "Expected non-empty ciphertext hex"),
  })
  .strict();

export const BallotCiphertextEnvelopeV2Schema = z
  .object({
    version: z.literal("BU-PVP-1_BALLOT_BABYJUB_POSEIDON_V2"),
    kdf: z.literal("BABYJUB_ECDH"),
    aead: z.literal("POSEIDON_FIELD_ADDITION"),
    ephemeralPublicKeyHex: Hex32Schema,
    nonceHex: Hex32Schema,
    selectionCiphertext: z.string().regex(/^\d+$/, "Expected decimal selection ciphertext"),
    plaintextLength: z.number().int().min(0).max(8192),
    authTag: z.string().regex(/^\d+$/, "Expected decimal auth tag"),
    ciphertextFields: z
      .array(z.string().regex(/^\d+$/, "Expected decimal field element"))
      .min(1, "Expected at least one ciphertext field"),
  })
  .strict();

export const BallotCiphertextEnvelopeSchema = z.union([
  BallotCiphertextEnvelopeV1Schema,
  BallotCiphertextEnvelopeV2Schema,
]);

export type BallotCiphertextEnvelope = z.infer<typeof BallotCiphertextEnvelopeSchema>;

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

// --- Honduras voter registry and wallet linkage ---

export const HondurasDniSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => /^[0-9]{13}$/.test(value), "Expected 13-digit Honduras DNI");

export type HondurasDni = z.infer<typeof HondurasDniSchema>;

export const HondurasCensusStatusSchema = z.enum([
  "HABILITADO",
  "INHABILITADO",
  "SUSPENDIDO",
  "FALLECIDO",
  "OBSERVADO",
]);

export type HondurasCensusStatus = z.infer<typeof HondurasCensusStatusSchema>;

export const HondurasWalletLinkStatusSchema = z.enum(["ACTIVE", "PENDING", "REVOKED"]);
export type HondurasWalletLinkStatus = z.infer<typeof HondurasWalletLinkStatusSchema>;

export const HondurasWalletVerificationMethodSchema = z.enum([
  "MANUAL_AEA",
  "SELF_ATTESTED",
  "CENSUS_VERIFIED",
  "DEMO_SYSTEM",
  "SYSTEM_MANAGED",
]);

export type HondurasWalletVerificationMethod = z.infer<typeof HondurasWalletVerificationMethodSchema>;

export const HondurasCensusRecordSchema = z
  .object({
    dni: HondurasDniSchema,
    fullName: z.string().trim().min(1).max(200),
    firstName: z.string().trim().max(100).optional(),
    middleName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    secondLastName: z.string().trim().max(100).optional(),
    habilitationStatus: HondurasCensusStatusSchema,
    statusReason: z.string().trim().max(300).optional(),
    censusCutoffAt: z.string().datetime().optional(),
    source: z.string().trim().min(1).max(120).default("MANUAL"),
    metadata: z.record(z.string(), z.unknown()).optional(),
    importedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

export type HondurasCensusRecord = z.infer<typeof HondurasCensusRecordSchema>;

export const HondurasWalletLinkSchema = z
  .object({
    dni: HondurasDniSchema,
    walletAddress: EthAddressSchema,
    linkStatus: HondurasWalletLinkStatusSchema.default("ACTIVE"),
    verificationMethod: HondurasWalletVerificationMethodSchema.default("MANUAL_AEA"),
    evidence: z.record(z.string(), z.unknown()).optional(),
    linkedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    revokedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export type HondurasWalletLink = z.infer<typeof HondurasWalletLinkSchema>;
