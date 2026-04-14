import { type Provider } from "ethers";

import { verifySignedSnapshot } from "@blockurna/crypto";
import { SignedSnapshotSchema } from "@blockurna/shared";

import { fetchActaAnchors } from "../tpe/electionRegistry.js";

export async function verifyActaFile(
  signedSnapshotJson: unknown,
): Promise<{ ok: boolean; snapshotHashHex?: string; error?: string }> {
  return verifySignedSnapshot(signedSnapshotJson);
}

export async function verifyActaAnchoredOnChain(params: {
  signedSnapshotJson: unknown;
  provider: Provider;
  electionRegistryAddress: string;
  electionId: number;
}): Promise<{ ok: boolean; anchored: boolean; anchorTxHash?: string; error?: string }> {
  const parsed = SignedSnapshotSchema.safeParse(params.signedSnapshotJson);
  if (!parsed.success) {
    return { ok: false, anchored: false, error: parsed.error.message };
  }

  const verified = await verifySignedSnapshot(params.signedSnapshotJson);
  if (!verified.ok || !verified.snapshotHashHex) {
    return { ok: false, anchored: false, error: verified.error ?? "Verification failed" };
  }

  const anchors = await fetchActaAnchors(
    params.electionRegistryAddress,
    params.provider,
    params.electionId,
  );

  const match = anchors.find(
    (a) => a.snapshotHash.toLowerCase() === verified.snapshotHashHex!.toLowerCase(),
  );

  return match
    ? { ok: true, anchored: true, anchorTxHash: match.txHash }
    : { ok: true, anchored: false };
}
