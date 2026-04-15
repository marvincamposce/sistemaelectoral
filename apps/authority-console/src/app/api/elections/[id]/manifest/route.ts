import fs from "node:fs/promises";

import { z } from "zod";

import { getEnvResult } from "../../../../../lib/env";
import { ensureSchema, getPool, listAdminLogEntries } from "../../../../../lib/db";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().regex(/^\d+$/) }).strict();

type CreateElectionDetails = {
  manifestFilePath?: string;
  manifestHashHex?: string;
};

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
    limit: 50,
  });

  const create = entries.find((e) => e.code === "CREATE_ELECTION");
  const details = (create?.details ?? {}) as CreateElectionDetails;
  const manifestFilePath = typeof details.manifestFilePath === "string" ? details.manifestFilePath : null;
  const manifestHashHex = typeof details.manifestHashHex === "string" ? details.manifestHashHex : null;

  if (!manifestFilePath) {
    return new Response(JSON.stringify({ ok: false, error: "manifest_not_available" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  let raw: string;
  try {
    raw = await fs.readFile(manifestFilePath, "utf8");
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "manifest_file_missing" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const fileName = manifestHashHex ? `manifest_${manifestHashHex}.signed.json` : `manifest.election-${electionId}.signed.json`;

  return new Response(raw, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename=${fileName}`,
    },
  });
}
