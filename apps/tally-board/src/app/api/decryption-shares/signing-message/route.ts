import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDecryptionShareSigningMessageAction } from "@/app/actions";
import { authorizeRemoteTrusteeApiRequest } from "@/app/api/_lib/auth";

export const dynamic = "force-dynamic";

const SigningMessageBodySchema = z.object({
  electionId: z.coerce.string().min(1),
  ceremonyId: z.string().min(1),
  trusteeId: z.string().min(3).max(64),
  sharePayload: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const authError = authorizeRemoteTrusteeApiRequest(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 },
    );
  }

  const parsed = SigningMessageBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Payload inválido",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const result = await getDecryptionShareSigningMessageAction({
    electionId: parsed.data.electionId,
    ceremonyId: parsed.data.ceremonyId,
    trusteeId: parsed.data.trusteeId,
    sharePayload: parsed.data.sharePayload,
  });

  if (!result.ok || !result.signingMessage) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "No se pudo generar el mensaje de firma",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    signingMessage: result.signingMessage,
    electionId: parsed.data.electionId,
    ceremonyId: result.ceremonyId,
    trusteeId: result.trusteeId,
    sharePayload: result.normalizedSharePayload,
    chainId: result.chainId,
    contractAddress: result.contractAddress,
  });
}
