import { z } from "zod";

import { getEnvResult } from "../../../../../lib/env";
import { ensureSchema, getPool, listAdminLogEntries } from "../../../../../lib/db";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().regex(/^\d+$/) }).strict();

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const envRes = getEnvResult();
  if (!envRes.ok) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "authority_console_env_invalid",
          missingKeys: envRes.missingKeys,
          problems: envRes.problems,
        },
        null,
        2,
      ) + "\n",
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const env = envRes.env;
  const params = await ctx.params;
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return new Response(JSON.stringify({ ok: false, error: parsed.error.message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const electionId = Number(parsed.data.id);
  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const entries = await listAdminLogEntries({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    electionId,
    limit: 200,
  });

  return new Response(JSON.stringify({ ok: true, electionId, entries }, null, 2) + "\n", {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename=admin-log.election-${electionId}.json`,
    },
  });
}
