import { ethers } from "ethers";
import { canonicalizeJson } from "./canonicalJson.js";
import { sha256Hex, utf8ToBytes } from "./hash.js";

export const ACTA_SIGNATURE_SCHEME = "ECDSA_SECP256K1_ETH_V1" as const;

export type ActaSignerRole = "AEA" | "JED";

export function getExpectedSignerRole(actType: string): ActaSignerRole {
  const t = actType.toUpperCase();
  if (t === "ACTA_ESCRUTINIO") return "JED";
  // APERTURA, CIERRE, RESULTADOS
  return "AEA";
}

export interface ActaSigningPayload {
  protocolVersion: "BU-PVP-1";
  electionId: string;
  actType: string;
  contentHash: string;
}

export interface ActaSignatureEnvelope {
  signatureScheme: typeof ACTA_SIGNATURE_SCHEME;
  signerRole: ActaSignerRole;
  signerAddress: string;
  signingDigest: string;
  signatureHex: string;
}

export interface SignedActaECDSA {
  canonicalJson: unknown;
  signingPayloadJson: ActaSigningPayload;
  signature: ActaSignatureEnvelope;
}

export async function signActaECDSA(
  actData: Record<string, unknown>,
  privateKeyHex: string
): Promise<SignedActaECDSA> {
  const canonical = canonicalizeJson(actData);
  // We use standard keccak256 as requested for the content hash
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));

  const signingPayload: ActaSigningPayload = {
    protocolVersion: "BU-PVP-1",
    electionId: String(actData.electionId || "unknown"),
    actType: String(actData.kind || "UNKNOWN"),
    contentHash,
  };

  const payloadString = JSON.stringify(signingPayload);
  const signingDigest = ethers.keccak256(ethers.toUtf8Bytes(payloadString));

  const wallet = new ethers.Wallet(privateKeyHex);
  // eth_sign mechanism adds prefix automagically
  const signatureHex = await wallet.signMessage(ethers.getBytes(signingDigest));

  const signerRole = getExpectedSignerRole(signingPayload.actType);

  return {
    canonicalJson: actData, // preserve original non-stringified structure for the envelope
    signingPayloadJson: signingPayload,
    signature: {
      signatureScheme: ACTA_SIGNATURE_SCHEME,
      signerRole,
      signerAddress: wallet.address.toLowerCase(),
      signingDigest,
      signatureHex,
    },
  };
}

export function verifyActaECDSASignature(
  actData: Record<string, unknown>,
  signatureEnvelope: ActaSignatureEnvelope,
  expectedSignerAddressForRole: string
): {
  ok: boolean;
  signatureValid: boolean;
  signerMatchesRole: boolean;
  recoveredSignerAddress?: string;
  contentHash?: string;
  signingDigest?: string;
  expectedSignerRole?: ActaSignerRole;
  errorCode?: "INVALID_SIGNATURE" | "SIGNER_ROLE_MISMATCH" | "CONTENT_HASH_MISMATCH" | "UNSUPPORTED_SCHEME";
  error?: string;
} {
  try {
    if (signatureEnvelope.signatureScheme !== ACTA_SIGNATURE_SCHEME) {
       return { ok: false, signatureValid: false, signerMatchesRole: false, errorCode: "UNSUPPORTED_SCHEME", error: "Unsupported signature scheme" };
    }

    const canonical = canonicalizeJson(actData);
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(canonical)).toLowerCase();

    const expectedPayload: ActaSigningPayload = {
      protocolVersion: "BU-PVP-1",
      electionId: String(actData.electionId || "unknown"),
      actType: String(actData.kind || "UNKNOWN"),
      contentHash,
    };

    const expectedSignerRole = getExpectedSignerRole(expectedPayload.actType);

    const payloadString = JSON.stringify(expectedPayload);
    const signingDigest = ethers.keccak256(ethers.toUtf8Bytes(payloadString)).toLowerCase();

    if (signingDigest !== signatureEnvelope.signingDigest.toLowerCase()) {
      // It implies the content Hash or payload fields changed
      return { ok: false, signatureValid: false, signerMatchesRole: false, expectedSignerRole, contentHash, signingDigest, errorCode: "CONTENT_HASH_MISMATCH", error: "Signing digest mismatch (Content altered)" };
    }

    // Recover address using ethers' hashMessage which mirrors signMessage behaviour
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.recoverAddress(
        ethers.hashMessage(ethers.getBytes(signingDigest)),
        signatureEnvelope.signatureHex
      ).toLowerCase();
    } catch (e: any) {
      return { ok: false, signatureValid: false, signerMatchesRole: false, expectedSignerRole, contentHash, signingDigest, errorCode: "INVALID_SIGNATURE", error: "Invalid cryptographic signature format" };
    }

    const signatureValid = recoveredAddress === signatureEnvelope.signerAddress.toLowerCase();
    
    if (!signatureValid) {
       return { ok: false, signatureValid: false, signerMatchesRole: false, expectedSignerRole, contentHash, signingDigest, recoveredSignerAddress: recoveredAddress, errorCode: "INVALID_SIGNATURE", error: "Recovered signer address does not match envelope signer" };
    }

    const signerMatchesRole = recoveredAddress === expectedSignerAddressForRole.toLowerCase();

    if (!signerMatchesRole) {
       return { ok: false, signatureValid: true, signerMatchesRole: false, expectedSignerRole, contentHash, signingDigest, recoveredSignerAddress: recoveredAddress, errorCode: "SIGNER_ROLE_MISMATCH", error: "Signer is cryptographically valid but not the expected authority for this role" };
    }

    return {
      ok: true,
      signatureValid: true,
      signerMatchesRole: true,
      expectedSignerRole,
      recoveredSignerAddress: recoveredAddress,
      contentHash,
      signingDigest,
    };
  } catch (err: any) {
    return { ok: false, signatureValid: false, signerMatchesRole: false, errorCode: "INVALID_SIGNATURE", error: err.message || String(err) };
  }
}
