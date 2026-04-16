import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

export function authorizeRemoteTrusteeApiRequest(request: NextRequest): NextResponse | null {
  const env = getEnv();

  if (!env.ENFORCE_REMOTE_TRUSTEE_API_KEY) {
    return null;
  }

  if (!env.REMOTE_TRUSTEE_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Seguridad remota habilitada pero REMOTE_TRUSTEE_API_KEY no está configurada en el servidor",
      },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("x-blockurna-api-key") ??
    request.headers.get("x-api-key") ??
    "";

  if (!provided || provided !== env.REMOTE_TRUSTEE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  return null;
}
