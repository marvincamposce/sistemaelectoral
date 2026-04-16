import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { submitDecryptionShareAction } from "@/app/actions";
import { authorizeRemoteTrusteeApiRequest } from "@/app/api/_lib/auth";

export const dynamic = "force-dynamic";

const SubmitSignedShareBodySchema = z.object({
  electionId: z.coerce.string().min(1),
  ceremonyId: z.string().min(1),
  trusteeId: z.string().min(3).max(64),
  sharePayload: z.string().min(1),
  signerAddress: z.string().min(1),
  signature: z.string().min(1),
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

  const parsed = SubmitSignedShareBodySchema.safeParse(body);
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

  const result = await submitDecryptionShareAction({
    electionId: parsed.data.electionId,
    ceremonyId: parsed.data.ceremonyId,
    trusteeId: parsed.data.trusteeId,
    sharePayload: parsed.data.sharePayload,
    submissionChannel: "API_SIGNED",
    signerAddress: parsed.data.signerAddress,
    signature: parsed.data.signature,
  });

  if (!result.ok) {
    const status = /cerrad|closed/i.test(String(result.error ?? "")) ? 409 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "No se pudo registrar share",
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    ready: result.ready,
    ceremony: result.ceremony,
  });
}
