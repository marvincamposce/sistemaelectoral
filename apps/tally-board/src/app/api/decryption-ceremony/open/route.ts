import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDecryptionCeremonyAction } from "@/app/actions";
import { authorizeRemoteTrusteeApiRequest } from "@/app/api/_lib/auth";

export const dynamic = "force-dynamic";

const OpenCeremonyBodySchema = z.object({
  electionId: z.coerce.string().min(1),
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

  const parsed = OpenCeremonyBodySchema.safeParse(body);
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

  const result = await createDecryptionCeremonyAction(parsed.data.electionId);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "No se pudo abrir ceremonia" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    ceremony: result.ceremony,
  });
}
