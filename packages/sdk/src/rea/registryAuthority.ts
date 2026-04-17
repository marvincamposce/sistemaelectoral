import { ethers } from "ethers";

import {
  RegistryCredentialSchema,
  SignupPermitSchema,
  type ChainId,
  type RegistryCredential,
  type SignupPermit,
} from "@blockurna/shared";

function normalizeAddress(address: string): string {
  return ethers.getAddress(address).toLowerCase();
}

export function deriveCredentialId(secretHex: string): string {
  return ethers.keccak256(secretHex).toLowerCase();
}

export function generateRegistryCredential(params?: {
  registryAuthority?: string;
  subjectLabel?: string;
  issuedAt?: string;
}): RegistryCredential {
  const secretHex = ethers.hexlify(ethers.randomBytes(32)).toLowerCase();
  const credentialId = deriveCredentialId(secretHex);
  const issuedAt = params?.issuedAt ?? new Date().toISOString();
  const registryAuthority = params?.registryAuthority
    ? normalizeAddress(params.registryAuthority)
    : undefined;

  return RegistryCredentialSchema.parse({
    credentialVersion: "1",
    protocolVersion: "BU-PVP-1",
    credentialId,
    issuedAt,
    registryAuthority,
    subjectLabel: params?.subjectLabel,
    secretHex,
  });
}

export function deriveRegistryNullifier(params: {
  credentialSecretHex: string;
  electionId: string | number | bigint;
}): string {
  const electionIdBig = BigInt(String(params.electionId));
  return ethers
    .keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "bytes32"],
        ["BU-PVP-1:nullifier", electionIdBig, params.credentialSecretHex],
      ),
    )
    .toLowerCase();
}

export function computeSignupDigest(params: {
  electionId: string | number | bigint;
  registryNullifier: string;
}): string {
  const electionIdBig = BigInt(String(params.electionId));
  return ethers
    .keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "bytes32"],
        ["BU-PVP-1:signup", electionIdBig, params.registryNullifier],
      ),
    )
    .toLowerCase();
}

export async function issueSignupPermit(params: {
  chainId: ChainId | string | number;
  contractAddress: string;
  electionId: string | number | bigint;
  credential: RegistryCredential;
  reaPrivateKey: string;
  issuedAt?: string;
}): Promise<SignupPermit> {
  const chainId = String(params.chainId);
  const contractAddress = normalizeAddress(params.contractAddress);
  const electionId = String(params.electionId);

  const registryNullifier = deriveRegistryNullifier({
    credentialSecretHex: params.credential.secretHex,
    electionId,
  });

  const digest = computeSignupDigest({ electionId, registryNullifier });

  const wallet = new ethers.Wallet(params.reaPrivateKey);
  const issuerAddress = normalizeAddress(wallet.address);

  const permitSig = await wallet.signMessage(ethers.getBytes(digest));

  const issuedAt = params.issuedAt ?? new Date().toISOString();

  return SignupPermitSchema.parse({
    permitVersion: "1",
    protocolVersion: "BU-PVP-1",
    chainId,
    contractAddress,
    electionId,
    registryNullifier,
    credentialId: params.credential.credentialId,
    issuedAt,
    issuerAddress,
    permitSig,
  });
}

export function verifySignupPermit(params: {
  permit: SignupPermit;
  expectedIssuerAddress?: string;
}): { ok: boolean; recoveredAddress?: string; error?: string } {
  try {
    const digest = computeSignupDigest({
      electionId: params.permit.electionId,
      registryNullifier: params.permit.registryNullifier,
    });

    const recovered = normalizeAddress(
      ethers.verifyMessage(ethers.getBytes(digest), params.permit.permitSig),
    );

    if (params.expectedIssuerAddress) {
      const expected = normalizeAddress(params.expectedIssuerAddress);
      if (recovered !== expected) {
        return { ok: false, recoveredAddress: recovered, error: "issuer_mismatch" };
      }
    }

    if (params.permit.issuerAddress) {
      const declared = normalizeAddress(params.permit.issuerAddress);
      if (recovered !== declared) {
        return {
          ok: false,
          recoveredAddress: recovered,
          error: "issuer_address_field_mismatch",
        };
      }
    }

    return { ok: true, recoveredAddress: recovered };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
  }
}
