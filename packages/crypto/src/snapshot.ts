import {
  type SignedSnapshot,
  type SnapshotBody,
  SnapshotBodySchema,
  SignedSnapshotSchema,
} from "@blockurna/shared";

import { canonicalizeJson } from "./canonicalJson.js";
import { sha256Hex, utf8ToBytes } from "./hash.js";
import { getPublicKeyHex, signEd25519Hex, verifyEd25519Hex } from "./ed25519.js";

export async function signSnapshot(
  snapshot: SnapshotBody,
  privateKeyHex: string,
): Promise<SignedSnapshot> {
  const normalizedSnapshot = SnapshotBodySchema.parse(snapshot);
  const canonical = canonicalizeJson(normalizedSnapshot);
  const snapshotHashHex = sha256Hex(canonical);

  const publicKeyHex = await getPublicKeyHex(privateKeyHex);
  const signatureHex = await signEd25519Hex(utf8ToBytes(snapshotHashHex), privateKeyHex);

  return SignedSnapshotSchema.parse({
    snapshot: normalizedSnapshot,
    signature: {
      algorithm: "ed25519-sha256-jcs",
      publicKeyHex,
      signatureHex,
      snapshotHashHex,
    },
  });
}

export async function verifySignedSnapshot(envelope: unknown): Promise<{
  ok: boolean;
  snapshotHashHex?: string;
  error?: string;
}> {
  const parsed = SignedSnapshotSchema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  const { snapshot, signature } = parsed.data;
  const canonical = canonicalizeJson(snapshot);
  const computedHashHex = sha256Hex(canonical);
  if (computedHashHex.toLowerCase() !== signature.snapshotHashHex.toLowerCase()) {
    return { ok: false, error: "Snapshot hash mismatch" };
  }

  const validSig = await verifyEd25519Hex(
    signature.signatureHex,
    utf8ToBytes(signature.snapshotHashHex),
    signature.publicKeyHex,
  );

  return validSig
    ? { ok: true, snapshotHashHex: signature.snapshotHashHex }
    : { ok: false, error: "Invalid signature" };
}
