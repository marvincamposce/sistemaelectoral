import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDecryptionCeremonyStateAction } from "@/app/actions";
import { authorizeRemoteTrusteeApiRequest } from "@/app/api/_lib/auth";

export const dynamic = "force-dynamic";

const CeremonyStateBodySchema = z.object({
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

  const parsed = CeremonyStateBodySchema.safeParse(body);
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

  const result = await getDecryptionCeremonyStateAction({
    electionId: parsed.data.electionId,
    ceremonyId: parsed.data.ceremonyId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "No se pudo consultar la ceremonia" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, ceremony: result.ceremony });
}
