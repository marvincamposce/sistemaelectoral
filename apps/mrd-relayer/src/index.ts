import "dotenv/config";

import cors from "@fastify/cors";
import fastify, { type FastifyRequest } from "fastify";
import { ethers } from "ethers";
import { decodeBallotCiphertextEnvelope } from "@blockurna/crypto";

import { createPool, ensureSchema } from "./db.js";
import { runWorkerLoop } from "./worker.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:3004",
  "http://127.0.0.1:3004",
  "http://localhost:3005",
  "http://127.0.0.1:3005",
];

const env = {
  DATABASE_URL: process.env.DATABASE_URL as string,
  RPC_URL: process.env.RPC_URL as string,
  CONTRACT_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS as string,
  RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY as string,
  PORT: Number(process.env.PORT || 8002),
  HOST: process.env.HOST || "127.0.0.1",
  RELAYER_API_KEY: String(process.env.RELAYER_API_KEY || "").trim(),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

if (!env.DATABASE_URL || !env.RPC_URL || !env.CONTRACT_ADDRESS || !env.RELAYER_PRIVATE_KEY) {
  throw new Error("Missing required env vars for MRD Relayer");
}

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost" || host === "::1";

if (!isLoopbackHost(env.HOST) && !env.RELAYER_API_KEY) {
  throw new Error(
    "Refusing to expose MRD Relayer on a non-loopback host without RELAYER_API_KEY",
  );
}

const pool = createPool(env.DATABASE_URL);
const provider = new ethers.JsonRpcProvider(env.RPC_URL);
const wallet = new ethers.Wallet(env.RELAYER_PRIVATE_KEY, provider);

const app = fastify({ logger: true });

await app.register(cors as any, {
  origin(origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) {
    if (!origin) {
      cb(null, false);
      return;
    }

    cb(null, env.ALLOWED_ORIGINS.includes(origin));
  },
});

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return request.ip;
}

function getOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.trim().length > 0 ? origin.trim() : null;
}

function authorizeSubmissionRequest(request: FastifyRequest): { ok: true; authSubject: string } | { ok: false; status: number; error: string } {
  const origin = getOrigin(request);
  if (!origin || !env.ALLOWED_ORIGINS.includes(origin)) {
    return { ok: false, status: 403, error: "Origin not allowed for MRD relayer" };
  }

  if (!env.RELAYER_API_KEY) {
    return { ok: true, authSubject: `origin:${origin}` };
  }

  const provided = request.headers["x-blockurna-relayer-key"];
  const apiKey = Array.isArray(provided) ? provided[0] : provided;
  if (typeof apiKey !== "string" || apiKey !== env.RELAYER_API_KEY) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, authSubject: `api-key:${origin}` };
}

app.post("/v1/mrd/elections/:electionId/signup", async (request, reply) => {
  const auth = authorizeSubmissionRequest(request);
  if (!auth.ok) {
    return reply.status(auth.status).send({ ok: false, error: auth.error });
  }

  const { electionId } = request.params as any;
  const payload = request.body as any;

  if (!payload.registryNullifier || !payload.votingPubKey || !payload.permitSig) {
    return reply.status(400).send({ ok: false, error: "Missing required signup payload fields" });
  }

  const res = await pool.query(
    `INSERT INTO mrd_submissions (
      election_id, kind, payload, status, client_ip, origin, auth_subject
    ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      electionId,
      "SIGNUP",
      payload,
      "PENDING",
      getClientIp(request),
      getOrigin(request),
      auth.authSubject,
    ],
  );

  return { ok: true, submissionId: res.rows[0].id };
});

app.post("/v1/mrd/elections/:electionId/ballot", async (request, reply) => {
  const auth = authorizeSubmissionRequest(request);
  if (!auth.ok) {
    return reply.status(auth.status).send({ ok: false, error: auth.error });
  }

  const { electionId } = request.params as any;
  const payload = request.body as any;
  const ciphertext = typeof payload?.ciphertext === "string" ? payload.ciphertext : "";
  const votingPubKey = typeof payload?.votingPubKey === "string" ? payload.votingPubKey : "";
  const ballotSig = typeof payload?.ballotSig === "string" ? payload.ballotSig : "";

  if (!ciphertext || !votingPubKey || !ballotSig) {
    return reply
      .status(400)
      .send({ ok: false, error: "Missing required ballot payload fields" });
  }

  let encryptionScheme = "LEGACY_RAW_HEX";
  try {
    const envelope = decodeBallotCiphertextEnvelope(ciphertext);
    encryptionScheme = envelope.version;
  } catch {
    if (!/^0x[0-9a-fA-F]+$/.test(ciphertext)) {
      return reply.status(400).send({ ok: false, error: "Invalid ballot ciphertext format" });
    }
  }

  const normalizedPayload = {
    ...payload,
    ciphertext,
    votingPubKey,
    ballotSig,
    encryptionScheme,
  };

  const res = await pool.query(
    `INSERT INTO mrd_submissions (
      election_id, kind, payload, status, client_ip, origin, auth_subject
    ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      electionId,
      "BALLOT",
      normalizedPayload,
      "PENDING",
      getClientIp(request),
      getOrigin(request),
      auth.authSubject,
    ],
  );

  return { ok: true, submissionId: res.rows[0].id };
});

app.get("/v1/mrd/submissions/:id", async (request, reply) => {
  const auth = authorizeSubmissionRequest(request);
  if (!auth.ok) {
    return reply.status(auth.status).send({ ok: false, error: auth.error });
  }

  const { id } = request.params as any;

  try {
    const res = await pool.query(
      `SELECT id, election_id, kind, status, tx_hash, error_message, created_at, updated_at
       FROM mrd_submissions
       WHERE id = $1`,
      [id],
    );
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

  runWorkerLoop(pool, provider, wallet, env.CONTRACT_ADDRESS).catch((e) => {
    app.log.error(e, "Worker failed fatally");
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`MRD Relayer listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
