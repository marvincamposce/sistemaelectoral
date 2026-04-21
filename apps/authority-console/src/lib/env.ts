import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { ethers } from "ethers";

const REPO_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const Hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 0x-prefixed 32-byte hex");

const PrivateKeySchema = Hex32Schema;

const Bytes32Schema = Hex32Schema;

const CoordinatorPubKeySchema = Bytes32Schema;

const EnvSchema = z
  .object({
    EVIDENCE_API_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),
    RPC_URL: z.string().url(),
    CHAIN_ID: z.union([z.string(), z.number()]).transform(String),
    ELECTION_REGISTRY_ADDRESS: z.string().min(1),
    AEA_PRIVATE_KEY: PrivateKeySchema,
    AEA_ED25519_PRIVATE_KEY_HEX: PrivateKeySchema,
    ACTA_OUTPUT_DIR: z.string().min(1),
  })
  .strict();

const REQUIRED_ENV_KEYS = [
  "EVIDENCE_API_URL",
  "DATABASE_URL",
  "RPC_URL",
  "CHAIN_ID",
  "ELECTION_REGISTRY_ADDRESS",
  "AEA_PRIVATE_KEY",
  "AEA_ED25519_PRIVATE_KEY_HEX",
  "ACTA_OUTPUT_DIR",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

export type AuthorityEnvProblem = {
  key: string;
  message: string;
};

export type AuthorityEnvResult =
  | {
      ok: true;
      env: AuthorityEnv;
    }
  | {
      ok: false;
      message: string;
      missingKeys: RequiredEnvKey[];
      problems: AuthorityEnvProblem[];
    };

export type AuthorityEnv = {
  EVIDENCE_API_URL: string;
  DATABASE_URL: string;
  RPC_URL: string;
  CHAIN_ID: string;
  CONTRACT_ADDRESS: string;
  AEA_PRIVATE_KEY: string;
  AEA_ED25519_PRIVATE_KEY_HEX: string;
  ACTA_OUTPUT_DIR: string;
  CoordinatorPubKeySchema: typeof CoordinatorPubKeySchema;
};

function resolveRepoPath(maybeRelativePath: string): string {
  if (path.isAbsolute(maybeRelativePath)) return maybeRelativePath;
  return path.resolve(REPO_ROOT_DIR, maybeRelativePath);
}

function getMissingKeysFromProcessEnv(): RequiredEnvKey[] {
  return REQUIRED_ENV_KEYS.filter((k) => {
    const v = process.env[k];
    return v === undefined || String(v).trim() === "";
  });
}

function formatEnvErrorMessage(params: {
  missingKeys: RequiredEnvKey[];
  problems: AuthorityEnvProblem[];
}): string {
  const { missingKeys, problems } = params;

  const lines: string[] = [
    "Authority Console (AEA) env misconfigured.",
    "Create apps/authority-console/.env.local based on apps/authority-console/.env.example.",
  ];

  if (missingKeys.length > 0) {
    lines.push(`Missing: ${missingKeys.join(", ")}`);
  }

  const uniqueProblems = new Map<string, string>();
  for (const p of problems) {
    if (!uniqueProblems.has(p.key)) uniqueProblems.set(p.key, p.message);
  }
  if (uniqueProblems.size > 0) {
    lines.push(
      "Problems: " +
        Array.from(uniqueProblems.entries())
          .map(([k, m]) => `${k}: ${m}`)
          .join("; "),
    );
  }

  return lines.join("\n");
}

export function getEnvResult(): AuthorityEnvResult {
  const rawEvidenceUrl = (process.env.EVIDENCE_API_URL || "").trim();
  const rawDbUrl = (process.env.DATABASE_URL || "").trim();
  const rawRpcUrl = (process.env.RPC_URL || "").trim();
  const rawChainId = (process.env.CHAIN_ID || "").trim();
  const rawRegistry = (process.env.ELECTION_REGISTRY_ADDRESS || "").trim();
  const rawAeaKey = (process.env.AEA_PRIVATE_KEY || "").trim();
  const rawEdKey = (process.env.AEA_ED25519_PRIVATE_KEY_HEX || "").trim();
  const rawActaDir = (process.env.ACTA_OUTPUT_DIR || "").trim();

  const parsed = EnvSchema.safeParse({
    EVIDENCE_API_URL: rawEvidenceUrl || "http://20.106.239.100:3020",
    DATABASE_URL: rawDbUrl,
    RPC_URL: rawRpcUrl || "https://rpc.ankr.com/eth_sepolia/b8ec123d573ff7290be5cc863464f8cec25cb3c06e5b4eded7b84db75b67d60f",
    CHAIN_ID: rawChainId || "11155111",
    ELECTION_REGISTRY_ADDRESS: rawRegistry || "0x173402879dAbeff1B9970be891bD7CA5E2338641",
    AEA_PRIVATE_KEY: rawAeaKey,
    AEA_ED25519_PRIVATE_KEY_HEX: rawEdKey || "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ACTA_OUTPUT_DIR: rawActaDir || "/tmp",
  });

  if (!parsed.success) {
    const missingKeys = getMissingKeysFromProcessEnv();
    const problems: AuthorityEnvProblem[] = parsed.error.issues.map((i) => ({
      key: String(i.path[0] ?? "ENV"),
      message: i.message,
    }));

    return {
      ok: false,
      missingKeys,
      problems,
      message: formatEnvErrorMessage({ missingKeys, problems }),
    };
  }

  let contractAddress: string;
  try {
    contractAddress = ethers.getAddress(parsed.data.ELECTION_REGISTRY_ADDRESS).toLowerCase();
  } catch {
    return {
      ok: false,
      missingKeys: [],
      problems: [{ key: "ELECTION_REGISTRY_ADDRESS", message: "Invalid address" }],
      message: "ELECTION_REGISTRY_ADDRESS is not a valid Ethereum address.",
    };
  }

  return {
    ok: true,
    env: {
      EVIDENCE_API_URL: parsed.data.EVIDENCE_API_URL.replace(/\/$/, ""),
      DATABASE_URL: parsed.data.DATABASE_URL,
      RPC_URL: parsed.data.RPC_URL,
      CHAIN_ID: parsed.data.CHAIN_ID,
      CONTRACT_ADDRESS: contractAddress,
      AEA_PRIVATE_KEY: parsed.data.AEA_PRIVATE_KEY,
      AEA_ED25519_PRIVATE_KEY_HEX: parsed.data.AEA_ED25519_PRIVATE_KEY_HEX,
      ACTA_OUTPUT_DIR: resolveRepoPath(parsed.data.ACTA_OUTPUT_DIR),
      CoordinatorPubKeySchema,
    },
  };
}

export function getEnv(): AuthorityEnv {
  const res = getEnvResult();
  if (!res.ok) {
    throw new Error(res.message);
  }
  return res.env;
}
