import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { ethers } from "ethers";

import { getEnv } from "./env.js";
import { createPool, ensureSchema } from "./db.js";

type ActaAnchorRow = {
  electionId: string;
  kind: number;
  snapshotHash: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
};

type ElectionRow = {
  electionId: string;
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: number;
  createdAtBlock: number;
  createdTxHash: string;
  signups: number;
  ballots: number;
};

async function main() {
  const env = getEnv();

  const chainId = env.CHAIN_ID;
  const contractAddress = ethers.getAddress(env.ELECTION_REGISTRY_ADDRESS).toLowerCase();

  const pool = createPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/", async () => {
    return {
      ok: true,
      service: "evidence-api",
      endpoints: ["/healthz", "/v1/elections"],
    };
  });

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  app.get("/v1/elections", async () => {
    const electionsRes = await pool.query<ElectionRow>(
      `SELECT
        e.election_id::text AS "electionId",
        e.manifest_hash AS "manifestHash",
        e.authority AS "authority",
        e.registry_authority AS "registryAuthority",
        e.coordinator_pub_key AS "coordinatorPubKey",
        e.phase AS "phase",
        e.created_at_block::int AS "createdAtBlock",
        e.created_tx_hash AS "createdTxHash",
        (SELECT COUNT(*)::int FROM signups s WHERE s.chain_id=e.chain_id AND s.contract_address=e.contract_address AND s.election_id=e.election_id) AS "signups",
        (SELECT COUNT(*)::int FROM ballots b WHERE b.chain_id=e.chain_id AND b.contract_address=e.contract_address AND b.election_id=e.election_id) AS "ballots"
      FROM elections e
      WHERE e.chain_id=$1 AND e.contract_address=$2
      ORDER BY e.election_id ASC`,
      [chainId, contractAddress],
    );

    const actasRes = await pool.query<ActaAnchorRow>(
      `SELECT
        a.election_id::text AS "electionId",
        a.kind::int AS "kind",
        a.snapshot_hash AS "snapshotHash",
        a.block_number::int AS "blockNumber",
        a.tx_hash AS "txHash",
        a.log_index::int AS "logIndex"
      FROM acta_anchors a
      WHERE a.chain_id=$1 AND a.contract_address=$2
      ORDER BY a.block_number ASC, a.log_index ASC`,
      [chainId, contractAddress],
    );

    const actasByElection = new Map<string, ActaAnchorRow[]>();
    for (const a of actasRes.rows) {
      const list = actasByElection.get(a.electionId) ?? [];
      list.push(a);
      actasByElection.set(a.electionId, list);
    }

    return {
      ok: true,
      chainId,
      contractAddress,
      elections: electionsRes.rows.map((e: ElectionRow) => ({
        ...e,
        counts: { signups: e.signups, ballots: e.ballots },
        actas: actasByElection.get(e.electionId) ?? [],
      })),
    };
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
