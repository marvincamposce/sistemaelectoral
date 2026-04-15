import "dotenv/config";
import fastify from "fastify";
import cors from "@fastify/cors";
import { ethers } from "ethers";
import { z } from "zod";
import { decodeBallotCiphertextEnvelope } from "@blockurna/crypto";

import { createPool, ensureSchema } from "./db.js";
import { runWorkerLoop } from "./worker.js";

const env = {
  DATABASE_URL: process.env.DATABASE_URL as string,
  RPC_URL: process.env.RPC_URL as string,
  CONTRACT_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS as string,
  RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY as string,
  PORT: Number(process.env.PORT || 8002),
};

if (!env.DATABASE_URL || !env.RPC_URL || !env.CONTRACT_ADDRESS || !env.RELAYER_PRIVATE_KEY) {
  throw new Error("Missing required env vars for MRD Relayer");
}

const pool = createPool(env.DATABASE_URL);
const provider = new ethers.JsonRpcProvider(env.RPC_URL);
const wallet = new ethers.Wallet(env.RELAYER_PRIVATE_KEY, provider);

const app = fastify({ logger: true });

app.register(cors as any, { origin: true });

app.post("/v1/mrd/elections/:electionId/signup", async (request, reply) => {
  const { electionId } = request.params as any;
  const payload = request.body as any;

  if (!payload.registryNullifier || !payload.votingPubKey || !payload.permitSig) {
    return reply.status(400).send({ ok: false, error: "Missing required signup payload fields" });
  }

  const res = await pool.query(
    `INSERT INTO mrd_submissions (election_id, kind, payload, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [electionId, "SIGNUP", payload, "PENDING"]
  );

  return { ok: true, submissionId: res.rows[0].id };
});

app.post("/v1/mrd/elections/:electionId/ballot", async (request, reply) => {
  const { electionId } = request.params as any;
  const payload = request.body as any;
  const ciphertext = typeof payload?.ciphertext === "string" ? payload.ciphertext : "";

  if (!ciphertext) {
    return reply.status(400).send({ ok: false, error: "Missing required ballot payload fields" });
  }

  let encryptionScheme = "LEGACY_RAW_HEX";
  try {
    const envelope = decodeBallotCiphertextEnvelope(ciphertext);
    encryptionScheme = envelope.version;
  } catch {
    // Transitional compatibility: keep accepting old raw hex payloads while clients migrate.
    if (!/^0x[0-9a-fA-F]+$/.test(ciphertext)) {
      return reply.status(400).send({ ok: false, error: "Invalid ballot ciphertext format" });
    }
  }

  const normalizedPayload = {
    ...payload,
    ciphertext,
    encryptionScheme,
  };

  const res = await pool.query(
    `INSERT INTO mrd_submissions (election_id, kind, payload, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [electionId, "BALLOT", normalizedPayload, "PENDING"]
  );

  return { ok: true, submissionId: res.rows[0].id };
});

app.get("/v1/mrd/submissions/:id", async (request, reply) => {
  const { id } = request.params as any;

  try {
    const res = await pool.query(`SELECT id, election_id, kind, status, tx_hash, error_message, created_at, updated_at FROM mrd_submissions WHERE id = $1`, [id]);
    if (res.rows.length === 0) {
      return reply.status(404).send({ ok: false, error: "Submission not found" });
    }
    return { ok: true, submission: res.rows[0] };
  } catch (e: any) {
    return reply.status(400).send({ ok: false, error: e.message });
  }
});

async function start() {
  await ensureSchema(pool);
  
  runWorkerLoop(pool, provider, wallet, env.CONTRACT_ADDRESS).catch(e => {
    app.log.error(e, "Worker failed fatally");
  });

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`MRD Relayer listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
