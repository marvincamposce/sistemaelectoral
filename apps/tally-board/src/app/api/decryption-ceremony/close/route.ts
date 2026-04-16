import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { closeDecryptionCeremonyAction } from "@/app/actions";
import { authorizeRemoteTrusteeApiRequest } from "@/app/api/_lib/auth";

export const dynamic = "force-dynamic";

const CloseCeremonyBodySchema = z.object({
  electionId: z.coerce.string().min(1),
  ceremonyId: z.string().min(1).optional(),
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

  const parsed = CloseCeremonyBodySchema.safeParse(body);
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

  const result = await closeDecryptionCeremonyAction({
    electionId: parsed.data.electionId,
    ceremonyId: parsed.data.ceremonyId,
  });

  if (!result.ok) {
    const status = /cerrad|closed|conflict/i.test(String(result.error ?? "")) ? 409 : 400;
    return NextResponse.json(
      { ok: false, error: result.error ?? "No se pudo cerrar ceremonia" },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    closed: result.closed,
    ceremony: result.ceremony,
  });
}
