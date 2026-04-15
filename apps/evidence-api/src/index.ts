import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { ethers } from "ethers";
import { canonicalizeJson, sha256Hex, verifySignedSnapshot } from "@blockurna/crypto";

import { getEnv } from "./env.js";
import { createPool, ensureSchema } from "./db.js";

type ActaAnchorRow = {
  electionId: string;
  kind: number;
  snapshotHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ElectionMetaRow = {
  electionId: string;
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: number;
  createdAtBlock: string;
  createdAtTimestamp: Date | null;
  createdTxHash: string;
};

type PhaseChangeRow = {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockTimestamp: Date | null;
  previousPhase: number;
  newPhase: number;
};

type AnchorRow = {
  kind: number;
  snapshotHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ActRefRow = {
  actId: string;
  kind: number;
  actType: string;
  anchorTxHash: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  contentHash: string | null;
  createdAt: Date | null;
  verificationStatus: string | null;
  hasCritical: boolean;
  hasWarning: boolean;
};

type ActMetaRow = {
  actType: string;
  canonicalJson: unknown;
  signature: string;
  signerKeyId: string | null;
  signerPublicKey: string | null;
  contentHash: string;
  createdAt: Date;
  verificationStatus: string;
};

type ActContentRow = {
  signedJson: unknown;
};

type SignupRow = {
  registryNullifier: string;
  votingPubKey: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type SignupWithPermitRow = SignupRow & {
  permitCredentialId: string | null;
  permitIssuerAddress: string | null;
  permitSig: string | null;
  permitIssuedAt: Date | null;
  permitRecordedAt: Date | null;
};

type BallotRow = {
  ballotIndex: string;
  ballotHash: string;
  ciphertext: string;
  blockNumber: string;
  blockTimestamp: Date | null;
  txHash: string;
  logIndex: number;
};

type ConsistencyRunRow = {
  runId: string;
  dataVersion: string;
  computedAt: Date;
  ok: boolean;
  report: unknown;
};

type IncidentRow = {
  fingerprint: string;
  code: string;
  severity: string;
  message: string;
  details: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: string;
  relatedTxHash: string | null;
  relatedBlockNumber: string | null;
  relatedBlockTimestamp: Date | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  evidencePointers: unknown;
  active: boolean;
  resolvedAt: Date | null;
};

function isCriticalSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "CRITICAL" || s === "ERROR";
}

function isWarningSeverity(severity: string): boolean {
  const s = String(severity ?? "").toUpperCase();
  return s === "WARNING" || s === "WARN";
}

type ElectionRow = {
  electionId: string;
  manifestHash: string;
  authority: string;
  registryAuthority: string;
  coordinatorPubKey: string;
  phase: number;
  createdAtBlock: string;
  createdAtTimestamp: Date | null;
  createdTxHash: string;
  signups: number;
  ballots: number;
};

const PHASE_LABELS = [
  "SETUP",
  "REGISTRY_OPEN",
  "REGISTRY_CLOSED",
  "VOTING_OPEN",
  "VOTING_CLOSED",
  "PROCESSING",
  "TALLYING",
  "RESULTS_PUBLISHED",
  "AUDIT_WINDOW",
  "ARCHIVED",
] as const;

const ACTA_KIND_LABELS = [
  "ACTA_APERTURA",
  "ACTA_CIERRE",
  "ACTA_ESCRUTINIO",
  "ACTA_RESULTADOS",
] as const;

function actTypeFromKind(kind: number): string {
  return ACTA_KIND_LABELS[kind] ?? String(kind);
}

function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? String(phase);
}

function requireElectionId(id: string): string {
  if (!/^[0-9]+$/.test(id)) {
    throw new Error("Invalid election id");
  }
  return id;
}

function requireTxHash(txHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Invalid txHash");
  }
  return txHash.toLowerCase();
}

function requireLogIndex(logIndex: string): number {
  if (!/^[0-9]+$/.test(logIndex)) {
    throw new Error("Invalid logIndex");
  }
  return Number(logIndex);
}

function parseSignupsCursor(cursor: string): { blockNumber: string; logIndex: number } {
  const raw = String(cursor ?? "");
  const parts = raw.split(":");
  if (parts.length !== 2) throw new Error("Invalid cursor");
  const [blockNumber, logIndex] = parts;
  if (!blockNumber || !/^[0-9]+$/.test(blockNumber)) throw new Error("Invalid cursor");
  if (!logIndex || !/^[0-9]+$/.test(logIndex)) throw new Error("Invalid cursor");
  return { blockNumber, logIndex: Number(logIndex) };
}

function formatSignupsCursor(params: { blockNumber: string; logIndex: number }): string {
  return `${params.blockNumber}:${params.logIndex}`;
}

function computeSignupDigest(params: { electionId: string; registryNullifier: string }): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:signup", BigInt(params.electionId), params.registryNullifier],
    ),
  );
}

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
      endpoints: [
        "/healthz",
        "/v1/elections",
        "/v1/elections/:id/phases",
        "/v1/elections/:id/phase-changes",
        "/v1/elections/:id/acts",
        "/v1/elections/:id/acts/:actId",
        "/v1/elections/:id/acts/:actId/content",
        "/v1/elections/:id/acts/:actId/verify",
        "/v1/elections/:id/anchors",
        "/v1/elections/:id/signups",
        "/v1/elections/:id/signups/summary",
        "/v1/elections/:id/signups/:txHash/:logIndex",
        "/v1/elections/:id/ballots",
        "/v1/elections/:id/ballots/summary",
        "/v1/elections/:id/consistency",
        "/v1/elections/:id/incidents",
      ],
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
        e.phase::int AS "phase",
        e.created_at_block::text AS "createdAtBlock",
        e.created_at_timestamp AS "createdAtTimestamp",
        e.created_tx_hash AS "createdTxHash",
        (SELECT COUNT(*)::int FROM signup_records s WHERE s.chain_id=e.chain_id AND s.contract_address=e.contract_address AND s.election_id=e.election_id) AS "signups",
        (SELECT COUNT(*)::int FROM ballot_records b WHERE b.chain_id=e.chain_id AND b.contract_address=e.contract_address AND b.election_id=e.election_id) AS "ballots"
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
        a.block_number::text AS "blockNumber",
        a.block_timestamp AS "blockTimestamp",
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
        createdAtTimestamp: e.createdAtTimestamp?.toISOString() ?? null,
        phaseLabel: phaseLabel(e.phase),
        counts: { signups: e.signups, ballots: e.ballots },
        actas: actasByElection.get(e.electionId) ?? [],
      })),
    };
  });

  async function getElectionMeta(electionIdRaw: string): Promise<ElectionMetaRow | null> {
    const electionId = requireElectionId(electionIdRaw);
    const res = await pool.query<ElectionMetaRow>(
      `SELECT
        e.election_id::text AS "electionId",
        e.manifest_hash AS "manifestHash",
        e.authority AS "authority",
        e.registry_authority AS "registryAuthority",
        e.coordinator_pub_key AS "coordinatorPubKey",
        e.phase::int AS "phase",
        e.created_at_block::text AS "createdAtBlock",
        e.created_at_timestamp AS "createdAtTimestamp",
        e.created_tx_hash AS "createdTxHash"
      FROM elections e
      WHERE e.chain_id=$1 AND e.contract_address=$2 AND e.election_id=$3`,
      [chainId, contractAddress, electionId],
    );
    return res.rows[0] ?? null;
  }

  app.get<{ Params: { id: string } }>("/v1/elections/:id/phases", async (req, reply) => {
    try {
      const election = await getElectionMeta(req.params.id);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      return {
        ok: true,
        chainId,
        contractAddress,
        election: {
          ...election,
          createdAtTimestamp: election.createdAtTimestamp?.toISOString() ?? null,
          phaseLabel: phaseLabel(election.phase),
        },
        phases: PHASE_LABELS.map((label, id) => ({ id, label })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/phase-changes",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<PhaseChangeRow>(
          `SELECT
            tx_hash AS "txHash",
            log_index::int AS "logIndex",
            block_number::text AS "blockNumber",
            block_timestamp AS "blockTimestamp",
            previous_phase::int AS "previousPhase",
            new_phase::int AS "newPhase"
          FROM phase_changes
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY block_number ASC, log_index ASC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          phaseChanges: res.rows.map((r) => ({
            ...r,
            blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
            previousPhaseLabel: phaseLabel(r.previousPhase),
            newPhaseLabel: phaseLabel(r.newPhase),
          })),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/anchors", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<AnchorRow>(
        `SELECT
          kind::int AS "kind",
          snapshot_hash AS "snapshotHash",
          block_number::text AS "blockNumber",
          block_timestamp AS "blockTimestamp",
          tx_hash AS "txHash",
          log_index::int AS "logIndex"
        FROM acta_anchors
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY block_number ASC, log_index ASC`,
        [chainId, contractAddress, electionId],
      );


      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        anchors: res.rows.map((r) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/acts", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<ActRefRow>(
        `SELECT DISTINCT ON (a.snapshot_hash)
          a.snapshot_hash AS "actId",
          a.kind::int AS "kind",
          COALESCE(c.act_type, '') AS "actType",
          a.tx_hash AS "anchorTxHash",
          a.block_number::text AS "blockNumber",
          a.block_timestamp AS "blockTimestamp",
          c.content_hash AS "contentHash",
           c.created_at AS "createdAt",
           c.verification_status AS "verificationStatus",
           COALESCE(i.has_critical, false) AS "hasCritical",
           COALESCE(i.has_warning, false) AS "hasWarning"
        FROM acta_anchors a
        LEFT JOIN acta_contents c
          ON c.chain_id=a.chain_id AND c.contract_address=a.contract_address AND c.election_id=a.election_id AND c.act_id=a.snapshot_hash
          LEFT JOIN (
            SELECT
              regexp_replace(fingerprint, '^.*:', '') AS act_id,
              BOOL_OR(severity IN ('CRITICAL','ERROR')) AS has_critical,
              BOOL_OR(severity IN ('WARNING','WARN')) AS has_warning
            FROM incident_logs
            WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND active=true
            GROUP BY act_id
          ) i ON i.act_id = a.snapshot_hash
        WHERE a.chain_id=$1 AND a.contract_address=$2 AND a.election_id=$3
        ORDER BY a.snapshot_hash, a.block_number ASC, a.log_index ASC`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        acts: res.rows.map((r) => ({
          contentAvailable: Boolean(r.contentHash),
          consistencyStatus: r.hasCritical ? 'CRITICAL' : r.hasWarning ? 'WARNING' : 'OK',
          verificationStatus: !r.contentHash
            ? 'INCOMPLETE'
            : r.verificationStatus && r.verificationStatus !== 'UNKNOWN'
              ? r.verificationStatus
              : r.hasCritical
                ? 'ERROR'
                : r.hasWarning
                  ? 'WARNING'
                  : 'OK',
          actId: r.actId,
          actType: r.actType && r.actType.length > 0 ? r.actType : actTypeFromKind(r.kind),
          anchorTxHash: r.anchorTxHash,
          blockNumber: r.blockNumber,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
          contentHash: r.contentHash,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const anchorRes = await pool.query<{
          kind: number;
          anchorTxHash: string;
          blockNumber: string;
          blockTimestamp: Date | null;
        }>(
          `SELECT
            kind::int AS "kind",
            tx_hash AS "anchorTxHash",
            block_number::text AS "blockNumber",
            block_timestamp AS "blockTimestamp"
          FROM acta_anchors
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND snapshot_hash=$4
          ORDER BY block_number ASC, log_index ASC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const contentRes = await pool.query<ActMetaRow>(
          `SELECT
            act_type AS "actType",
            canonical_json AS "canonicalJson",
            signature AS "signature",
            signer_key_id AS "signerKeyId",
            signer_public_key AS "signerPublicKey",
            content_hash AS "contentHash",
            created_at AS "createdAt",
            verification_status AS "verificationStatus"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const anchor = anchorRes.rows[0] ?? null;
        const content = contentRes.rows[0] ?? null;

        if (!anchor && !content) {
          reply.status(404);
          return { ok: false, error: "act_not_found" };
        }

        const inferredActType = content?.actType ?? (anchor ? actTypeFromKind(anchor.kind) : "UNKNOWN");

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          actId,
          act: {
            actId,
            electionId,
            actType: inferredActType,
            canonicalJson: content?.canonicalJson ?? null,
            signature: content?.signature ?? null,
            signerKeyId: content?.signerKeyId ?? null,
            signerPublicKey: content?.signerPublicKey ?? null,
            contentHash: content?.contentHash ?? null,
            verificationStatus: content?.verificationStatus ?? null,
            anchorTxHash: anchor?.anchorTxHash ?? null,
            blockNumber: anchor?.blockNumber ?? null,
            blockTimestamp: anchor?.blockTimestamp?.toISOString() ?? null,
            createdAt: content?.createdAt?.toISOString() ?? null,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId/content",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const res = await pool.query<ActContentRow>(
          `SELECT
            signed_json AS "signedJson"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const row = res.rows[0] ?? null;
        if (!row) {
          reply.status(404);
          return { ok: false, error: "act_content_not_found" };
        }

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          actId,
          signedJson: row.signedJson,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; actId: string } }>(
    "/v1/elections/:id/acts/:actId/verify",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const actId = String(req.params.actId).toLowerCase();

        const anchorRes = await pool.query<{ snapshotHash: string }>(
          `SELECT snapshot_hash AS "snapshotHash"
           FROM acta_anchors
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND snapshot_hash=$4
           LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );
        const anchorFoundOnChain = (anchorRes.rowCount ?? 0) > 0;

        const contentRes = await pool.query<{ canonicalJson: unknown; signedJson: unknown }>(
          `SELECT
            canonical_json AS "canonicalJson",
            signed_json AS "signedJson"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const content = contentRes.rows[0] ?? null;

        const signatureValid = content ? (await verifySignedSnapshot(content.signedJson)).ok : false;
        const computedHash = content
          ? sha256Hex(canonicalizeJson(content.canonicalJson)).toLowerCase()
          : null;

        const hashMatchesAnchor = Boolean(
          anchorFoundOnChain && computedHash && computedHash === actId,
        );

        const incidentsRes = await pool.query<{
          code: string;
          severity: string;
          message: string;
          details: unknown;
          relatedEntityType: string | null;
          relatedEntityId: string | null;
          evidencePointers: unknown;
          firstSeenAt: Date;
        }>(
          `SELECT
             code,
             severity,
             message,
             details,
             related_entity_type AS "relatedEntityType",
             related_entity_id AS "relatedEntityId",
             evidence_pointers AS "evidencePointers",
             first_seen_at AS "firstSeenAt"
           FROM incident_logs
           WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND fingerprint LIKE $4 AND active=true
           ORDER BY last_seen_at DESC
           LIMIT 50`,
          [chainId, contractAddress, electionId, `%:${actId}`],
        );

        const severities = new Set(incidentsRes.rows.map((r) => String(r.severity ?? "")));
        const consistencyStatus = Array.from(severities.values()).some(isCriticalSeverity)
          ? "CRITICAL"
          : Array.from(severities.values()).some(isWarningSeverity)
            ? "WARNING"
            : "OK";

        const errorDetails =
          signatureValid && hashMatchesAnchor && anchorFoundOnChain && consistencyStatus === "OK"
            ? null
            : {
                checks: {
                  contentAvailable: Boolean(content),
                  anchorFoundOnChain,
                  signatureValid,
                  hashMatchesAnchor,
                },
                incidents: incidentsRes.rows.map((r) => ({
                  code: r.code,
                  severity: r.severity,
                  message: r.message,
                  details: r.details,
                  relatedEntityType: r.relatedEntityType,
                  relatedEntityId: r.relatedEntityId,
                  evidencePointers: r.evidencePointers,
                  detectedAt: r.firstSeenAt.toISOString(),
                })),
              };

        return {
          ok: true,
          electionId,
          actId,
          signatureValid,
          hashMatchesAnchor,
          anchorFoundOnChain,
          consistencyStatus,
          errorDetails,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/signups", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const orderRaw = String((req as any).query?.order ?? "").toLowerCase();
      const order = orderRaw === "asc" || orderRaw === "desc" ? (orderRaw as "asc" | "desc") : null;

      const limitRaw = (req as any).query?.limit;
      const parsedLimit = limitRaw === undefined ? null : Number(limitRaw);
      const limit = parsedLimit === null || Number.isNaN(parsedLimit)
        ? null
        : Math.max(1, Math.min(200, parsedLimit));

      const cursorRaw = (req as any).query?.cursor;
      const cursor = cursorRaw ? parseSignupsCursor(String(cursorRaw)) : null;

      const usePagination = Boolean(limit !== null || order !== null || cursor !== null);
      const effectiveOrder: "asc" | "desc" = order ?? (usePagination ? "desc" : "asc");
      const effectiveLimit = usePagination ? (limit ?? 50) : null;
      const fetchLimit = effectiveLimit ? effectiveLimit + 1 : null;

      const args: Array<string | number> = [chainId, contractAddress, electionId];

      let cursorSql = "";
      if (cursor) {
        const blockParam = args.length + 1;
        args.push(cursor.blockNumber);
        const logParam = args.length + 1;
        args.push(cursor.logIndex);
        cursorSql =
          effectiveOrder === "asc"
            ? `AND (s.block_number, s.log_index) > ($${blockParam}::bigint, $${logParam}::int)`
            : `AND (s.block_number, s.log_index) < ($${blockParam}::bigint, $${logParam}::int)`;
      }

      let limitSql = "";
      if (fetchLimit) {
        args.push(fetchLimit);
        limitSql = `LIMIT $${args.length}`;
      }

      const orderSql =
        effectiveOrder === "asc"
          ? "ORDER BY s.block_number ASC, s.log_index ASC"
          : "ORDER BY s.block_number DESC, s.log_index DESC";

      const res = await pool.query<SignupWithPermitRow>(
        `SELECT
          s.registry_nullifier AS "registryNullifier",
          s.voting_pub_key AS "votingPubKey",
          s.block_number::text AS "blockNumber",
          s.block_timestamp AS "blockTimestamp",
          s.tx_hash AS "txHash",
          s.log_index::int AS "logIndex",
          p.credential_id AS "permitCredentialId",
          p.issuer_address AS "permitIssuerAddress",
          p.permit_sig AS "permitSig",
          p.issued_at AS "permitIssuedAt",
          p.recorded_at AS "permitRecordedAt"
        FROM signup_records s
        LEFT JOIN rea_signup_permits p
          ON p.chain_id=s.chain_id
          AND p.contract_address=s.contract_address
          AND p.election_id=s.election_id
          AND p.registry_nullifier=s.registry_nullifier
        WHERE s.chain_id=$1 AND s.contract_address=$2 AND s.election_id=$3
        ${cursorSql}
        ${orderSql}
        ${limitSql}`,
        args,
      );

      const expectedRegistryAuthority = String(election.registryAuthority ?? "").toLowerCase();

      let rows = res.rows;
      let hasMore = false;
      if (effectiveLimit && rows.length > effectiveLimit) {
        hasMore = true;
        rows = rows.slice(0, effectiveLimit);
      }

      const nextCursor =
        hasMore && rows.length > 0
          ? formatSignupsCursor({
              blockNumber: rows[rows.length - 1]!.blockNumber,
              logIndex: rows[rows.length - 1]!.logIndex,
            })
          : null;

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        page: usePagination
          ? { limit: effectiveLimit, order: effectiveOrder, nextCursor }
          : null,
        signups: rows.map((r) => {
          const permit = r.permitSig
            ? {
                credentialId: r.permitCredentialId,
                issuerAddress: r.permitIssuerAddress,
                permitSig: r.permitSig,
                issuedAt: r.permitIssuedAt?.toISOString() ?? null,
                recordedAt: r.permitRecordedAt?.toISOString() ?? null,
              }
            : null;

          if (!permit || !permit.permitSig || !permit.issuerAddress) {
            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: { status: "UNVERIFIED", reason: "missing_permit_log", recoveredIssuerAddress: null },
            };
          }

          const digest = computeSignupDigest({
            electionId,
            registryNullifier: r.registryNullifier,
          });

          const declaredIssuer = String(permit.issuerAddress).toLowerCase();
          try {
            const recovered = ethers
              .verifyMessage(ethers.getBytes(digest), String(permit.permitSig))
              .toLowerCase();

            if (recovered !== declaredIssuer) {
              return {
                registryNullifier: r.registryNullifier,
                votingPubKey: r.votingPubKey,
                blockNumber: r.blockNumber,
                blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
                txHash: r.txHash,
                logIndex: r.logIndex,
                permit,
                validity: {
                  status: "INVALID",
                  reason: "issuer_address_field_mismatch",
                  recoveredIssuerAddress: recovered,
                },
              };
            }

            if (expectedRegistryAuthority && recovered !== expectedRegistryAuthority) {
              return {
                registryNullifier: r.registryNullifier,
                votingPubKey: r.votingPubKey,
                blockNumber: r.blockNumber,
                blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
                txHash: r.txHash,
                logIndex: r.logIndex,
                permit,
                validity: {
                  status: "INVALID",
                  reason: "not_signed_by_registry_authority",
                  recoveredIssuerAddress: recovered,
                },
              };
            }

            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: { status: "VALID", reason: null, recoveredIssuerAddress: recovered },
            };
          } catch (err: unknown) {
            return {
              registryNullifier: r.registryNullifier,
              votingPubKey: r.votingPubKey,
              blockNumber: r.blockNumber,
              blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
              txHash: r.txHash,
              logIndex: r.logIndex,
              permit,
              validity: {
                status: "INVALID",
                reason: "signature_parse_error",
                recoveredIssuerAddress: null,
                error: (err as Error).message,
              },
            };
          }
        }),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/signups/summary",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{ total: number; unique_nullifiers: number }>(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT registry_nullifier)::int AS unique_nullifiers
          FROM signup_records
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        );

        const row = res.rows[0] ?? { total: 0, unique_nullifiers: 0 };
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          summary: {
            total: row.total,
            uniqueNullifiers: row.unique_nullifiers,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string; txHash: string; logIndex: string } }>(
    "/v1/elections/:id/signups/:txHash/:logIndex",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const txHash = requireTxHash(req.params.txHash);
        const logIndex = requireLogIndex(req.params.logIndex);

        const res = await pool.query<SignupWithPermitRow>(
          `SELECT
            s.registry_nullifier AS "registryNullifier",
            s.voting_pub_key AS "votingPubKey",
            s.block_number::text AS "blockNumber",
            s.block_timestamp AS "blockTimestamp",
            s.tx_hash AS "txHash",
            s.log_index::int AS "logIndex",
            p.credential_id AS "permitCredentialId",
            p.issuer_address AS "permitIssuerAddress",
            p.permit_sig AS "permitSig",
            p.issued_at AS "permitIssuedAt",
            p.recorded_at AS "permitRecordedAt"
          FROM signup_records s
          LEFT JOIN rea_signup_permits p
            ON p.chain_id=s.chain_id
            AND p.contract_address=s.contract_address
            AND p.election_id=s.election_id
            AND p.registry_nullifier=s.registry_nullifier
          WHERE s.chain_id=$1 AND s.contract_address=$2 AND s.election_id=$3
            AND s.tx_hash=$4 AND s.log_index=$5
          LIMIT 1`,
          [chainId, contractAddress, electionId, txHash, logIndex],
        );

        const row = res.rows[0];
        if (!row) {
          reply.status(404);
          return { ok: false, error: "signup_not_found" };
        }

        const expectedRegistryAuthority = String(election.registryAuthority ?? "").toLowerCase();

        const permit = row.permitSig
          ? {
              credentialId: row.permitCredentialId,
              issuerAddress: row.permitIssuerAddress,
              permitSig: row.permitSig,
              issuedAt: row.permitIssuedAt?.toISOString() ?? null,
              recordedAt: row.permitRecordedAt?.toISOString() ?? null,
            }
          : null;

        if (!permit || !permit.permitSig || !permit.issuerAddress) {
          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity: { status: "UNVERIFIED", reason: "missing_permit_log", recoveredIssuerAddress: null },
            },
          };
        }

        const digest = computeSignupDigest({
          electionId,
          registryNullifier: row.registryNullifier,
        });

        const declaredIssuer = String(permit.issuerAddress).toLowerCase();
        try {
          const recovered = ethers
            .verifyMessage(ethers.getBytes(digest), String(permit.permitSig))
            .toLowerCase();

          const validity =
            recovered !== declaredIssuer
              ? {
                  status: "INVALID",
                  reason: "issuer_address_field_mismatch",
                  recoveredIssuerAddress: recovered,
                }
              : expectedRegistryAuthority && recovered !== expectedRegistryAuthority
                ? {
                    status: "INVALID",
                    reason: "not_signed_by_registry_authority",
                    recoveredIssuerAddress: recovered,
                  }
                : { status: "VALID", reason: null, recoveredIssuerAddress: recovered };

          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity,
            },
          };
        } catch (err: unknown) {
          return {
            ok: true,
            chainId,
            contractAddress,
            electionId,
            signup: {
              registryNullifier: row.registryNullifier,
              votingPubKey: row.votingPubKey,
              blockNumber: row.blockNumber,
              blockTimestamp: row.blockTimestamp?.toISOString() ?? null,
              txHash: row.txHash,
              logIndex: row.logIndex,
              permit,
              validity: {
                status: "INVALID",
                reason: "signature_parse_error",
                recoveredIssuerAddress: null,
                error: (err as Error).message,
              },
            },
          };
        }
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/ballots", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<BallotRow>(
        `SELECT
          ballot_index::text AS "ballotIndex",
          ballot_hash AS "ballotHash",
          ciphertext AS "ciphertext",
          block_number::text AS "blockNumber",
          block_timestamp AS "blockTimestamp",
          tx_hash AS "txHash",
          log_index::int AS "logIndex"
        FROM ballot_records
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY block_number ASC, log_index ASC`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        ballots: res.rows.map((r) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/ballots/summary",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{ total: number; unique_indexes: number }>(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT ballot_index)::int AS unique_indexes
          FROM ballot_records
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        );

        const row = res.rows[0] ?? { total: 0, unique_indexes: 0 };
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          summary: {
            total: row.total,
            uniqueBallotIndexes: row.unique_indexes,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/consistency",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<ConsistencyRunRow>(
          `SELECT
            run_id::text AS "runId",
            data_version AS "dataVersion",
            computed_at AS "computedAt",
            ok AS "ok",
            report AS "report"
          FROM consistency_report_runs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY computed_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId],
        );

        const run = res.rows[0] ?? null;
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId,
          consistency: run
            ? {
                runId: run.runId,
                dataVersion: run.dataVersion,
                computedAt: run.computedAt.toISOString(),
                ok: run.ok,
                report: run.report,
              }
            : null,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/elections/:id/incidents", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query<IncidentRow>(
        `SELECT
          fingerprint,
          code,
          severity,
          message,
          details,
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          occurrences::text AS "occurrences",
          related_tx_hash AS "relatedTxHash",
          related_block_number::text AS "relatedBlockNumber",
          related_block_timestamp AS "relatedBlockTimestamp",
          related_entity_type AS "relatedEntityType",
          related_entity_id AS "relatedEntityId",
          evidence_pointers AS "evidencePointers",
          active AS "active",
          resolved_at AS "resolvedAt"
        FROM incident_logs
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY active DESC, last_seen_at DESC
        LIMIT 200`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId,
        incidents: res.rows.map((r) => ({
          ...r,
          firstSeenAt: r.firstSeenAt.toISOString(),
          detectedAt: r.firstSeenAt.toISOString(),
          lastSeenAt: r.lastSeenAt.toISOString(),
          relatedBlockTimestamp: r.relatedBlockTimestamp?.toISOString() ?? null,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
