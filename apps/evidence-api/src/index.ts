import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { ethers } from "ethers";
import { canonicalizeJson, sha256Hex, verifySignedSnapshot, verifyActaECDSASignature } from "@blockurna/crypto";

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
  signatureScheme: string | null;
  signerAddress: string | null;
  signerRole: string | null;
  signingDigest: string | null;
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

function mapProofStateToResultMode(proofState: string | null | undefined): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "VERIFIED";
  if (state === "TRANSCRIPT_VERIFIED") return "TRANSCRIPT_VERIFIED";
  if (state === "SIMULATED") return "SIMULATED";
  if (state === "NOT_IMPLEMENTED" || state.length === 0) return "PENDING";
  return state;
}

function honestyNoteForProofState(proofState: string | null | undefined): string {
  const state = String(proofState ?? "").toUpperCase();
  if (state === "VERIFIED") return "Resultado y prueba verificados.";
  if (state === "TRANSCRIPT_VERIFIED") {
    return "Descifrado y conteo reales con transcript verificable; ZK completa pendiente.";
  }
  if (state === "SIMULATED") return "Resultado marcado como simulado.";
  return "Resultado aún no verificado.";
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
           c.signature_scheme AS "signatureScheme",
           c.signer_address AS "signerAddress",
           c.signer_role AS "signerRole",
           c.signing_digest AS "signingDigest",
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
          signatureScheme: r.signatureScheme ?? null,
          signerAddress: r.signerAddress ?? null,
          signerRole: r.signerRole ?? null,
          signingDigest: r.signingDigest ?? null,
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

        const contentRes = await pool.query<{ 
          canonicalJson: unknown; 
          signedJson: unknown;
          signatureScheme: string;
          signerAddress: string;
          signingDigest: string;
          signerRole: string;
          expectedSignerAddress: string;
        }>(
          `SELECT
            canonical_json AS "canonicalJson",
            signed_json AS "signedJson",
            signature_scheme AS "signatureScheme",
            signer_address AS "signerAddress",
            signing_digest AS "signingDigest",
            signer_role AS "signerRole",
            expected_signer_address AS "expectedSignerAddress"
          FROM acta_contents
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND act_id=$4
          ORDER BY created_at DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId, actId],
        );

        const content = contentRes.rows[0] ?? null;

        let signatureValid = false;
        let signatureScheme = null;
        let recoveredSignerAddress = null;
        let expectedSignerAddress = null;
        let expectedSignerRole = null;
        let signatureMatchesExpectedSigner = false;
        let contentHash = null;
        let signingDigest = null;
        let verifyError = null;
        let verifyErrorCode = null;
        
        let hashMatchesAnchor = false;
        let anchoredHash = actId;

        if (content && typeof content.signedJson === 'object' && content.signedJson !== null && 'signature' in content.signedJson) {
           const signedJsonObj = content.signedJson as any;
           signatureScheme = content.signatureScheme || signedJsonObj.signature?.signatureScheme || signedJsonObj.signature?.algorithm;
           expectedSignerAddress = content.expectedSignerAddress;
           expectedSignerRole = content.signerRole;
           
           if (signatureScheme === "ECDSA_SECP256K1_ETH_V1") {
             const verification = verifyActaECDSASignature(content.canonicalJson as any, signedJsonObj.signature, expectedSignerAddress);
             signatureValid = verification.signatureValid;
             recoveredSignerAddress = verification.recoveredSignerAddress;
             signatureMatchesExpectedSigner = verification.signerMatchesRole;
             contentHash = verification.contentHash;
             signingDigest = verification.signingDigest;
             if (!verification.ok) {
               verifyError = verification.error;
               verifyErrorCode = verification.errorCode;
             }
           } else {
              // Legacy fallback
              signatureValid = false;
              verifyError = "UNSUPPORTED_SCHEME";
              verifyErrorCode = "UNSUPPORTED_SCHEME";
           }

           hashMatchesAnchor = Boolean(
             anchorFoundOnChain && (contentHash === actId)
           );
           
           if (!hashMatchesAnchor && anchorFoundOnChain && !verifyErrorCode) {
              verifyErrorCode = "ANCHORED_HASH_MISMATCH";
              verifyError = "Hash de contenido no coincide con el anclado on-chain";
           } else if (!anchorFoundOnChain && !verifyErrorCode) {
              verifyErrorCode = "ANCHOR_MISSING";
              verifyError = "No se encontró anclaje on-chain";
           }
        } else if (!content) {
          verifyErrorCode = "INCOMPLETE_METADATA";
          verifyError = "Contenido no disponible en la base de datos";
        }

        // Automatic incident generation rule
        if (verifyErrorCode) {
           const fingerprint = `act-verify:${actId}:${verifyErrorCode}`;
           const code = verifyErrorCode;
           const msg = verifyError ?? "Error de validación desconocido";
           
           await pool.query(
             `INSERT INTO incident_logs (
               chain_id, contract_address, election_id, fingerprint, code, severity,
               message, details, related_entity_type, related_entity_id, first_seen_at, last_seen_at, active
             ) VALUES (
               $1, $2, $3, $4, $5, 'CRITICAL', $6, '{}'::jsonb, 'ACTA', $7, NOW(), NOW(), true
             ) ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET active=true, last_seen_at=NOW()`,
             [chainId, contractAddress, electionId, fingerprint, code, msg, actId]
           );
        }

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
          [chainId, contractAddress, electionId, `%:${actId}%`],
        );

        const severities = new Set(incidentsRes.rows.map((r) => String(r.severity ?? "")));
        const consistencyStatus = Array.from(severities.values()).some(isCriticalSeverity)
          ? "CRITICAL"
          : Array.from(severities.values()).some(isWarningSeverity)
            ? "WARNING"
            : "OK";

        // Old errorDetails block removed

        const verificationStatusResolved = verifyErrorCode === "INVALID_SIGNATURE" ? "INVALID_SIGNATURE" :
                                         verifyErrorCode === "SIGNER_ROLE_MISMATCH" ? "SIGNER_ROLE_MISMATCH" :
                                         verifyErrorCode === "CONTENT_HASH_MISMATCH" ? "CONTENT_HASH_MISMATCH" :
                                         verifyErrorCode === "ANCHORED_HASH_MISMATCH" ? "ANCHORED_HASH_MISMATCH" :
                                         verifyErrorCode === "ANCHOR_MISSING" ? "ANCHOR_MISSING" :
                                         verifyErrorCode === "INCOMPLETE_METADATA" ? "INCOMPLETE_METADATA" :
                                         verifyErrorCode === "UNSUPPORTED_SCHEME" ? "UNSUPPORTED_SCHEME" :
                                         "VALID";

        return {
          ok: true,
          electionId,
          actId,
          actType: content?.signedJson ? (content.signedJson as any).kind || "UNKNOWN" : "UNKNOWN",
          signerRole: expectedSignerRole,
          signatureScheme,
          signatureValid,
          recoveredSignerAddress,
          expectedSignerAddress,
          signerMatchesRole: signatureMatchesExpectedSigner,
          contentHash,
          signingDigest,
          anchoredHash,
          hashMatchesAnchor,
          anchorFoundOnChain,
          verificationStatus: verificationStatusResolved,
          consistencyStatus,
          warnings: incidentsRes.rows.filter(x => x.severity === "WARNING").map(x => x.message),
          errorDetails: verifyError || null,
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
    "/v1/elections/:id/tally",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query<{
          proof_hash: string;
          proof_payload: string;
          tx_hash: string;
          block_timestamp: Date | null;
        }>(
          `SELECT
            proof_hash,
            proof_payload,
            tx_hash,
            block_timestamp
          FROM tally_proofs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY block_number DESC, log_index DESC
          LIMIT 1`,
          [chainId, contractAddress, electionId],
        );

        const proof = res.rows[0] ?? null;

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          proof: proof ? {
            proofHash: proof.proof_hash,
            proofPayload: proof.proof_payload,
            txHash: proof.tx_hash,
            blockTimestamp: proof.block_timestamp?.toISOString() ?? null,
          } : null,
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/processing/batches",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query(
          `SELECT
            batch_id AS "batchId",
            batch_index AS "batchIndex",
            input_count AS "inputCount",
            status AS "status",
            error_message AS "errorMessage",
            related_root AS "relatedRoot",
            created_at AS "createdAt",
            started_at AS "startedAt",
            completed_at AS "completedAt"
          FROM processing_batches
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY batch_index ASC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          batches: res.rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString(), startedAt: r.startedAt?.toISOString(), completedAt: r.completedAt?.toISOString() })),
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/elections/:id/tally/jobs",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }

        const res = await pool.query(
          `SELECT
            tally_job_id AS "tallyJobId",
            based_on_batch_set AS "basedOnBatchSet",
            status AS "status",
            proof_state AS "proofState",
            result_summary AS "resultSummary",
            tally_commitment AS "tallyCommitment",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            completed_at AS "completedAt"
          FROM tally_jobs
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
          ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        );

        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          jobs: res.rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString(), completedAt: r.completedAt?.toISOString() })),
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

  app.get<{ Params: { id: string } }>("/v1/elections/:id/results", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query(
        `SELECT
          id,
          tally_job_id AS "tallyJobId",
          result_kind AS "resultKind",
          payload_json AS "payloadJson",
          payload_hash AS "payloadHash",
          publication_status AS "publicationStatus",
          proof_state AS "proofState",
          created_at AS "createdAt",
          published_at AS "publishedAt"
        FROM result_payloads
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        ORDER BY created_at DESC`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        results: res.rows.map((r) => ({
          ...r,
          resultMode: mapProofStateToResultMode(r.proofState),
          createdAt: r.createdAt.toISOString(),
          publishedAt: r.publishedAt?.toISOString() ?? null,
        })),
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/v1/elections/:id/audit-window", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      const res = await pool.query(
        `SELECT
          id,
          status,
          opened_at AS "openedAt",
          closes_at AS "closesAt",
          opened_by AS "openedBy",
          notes,
          created_at AS "createdAt"
        FROM audit_windows
        WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3
        LIMIT 1`,
        [chainId, contractAddress, electionId],
      );

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        auditWindow: res.rows.length ? {
          ...res.rows[0],
          openedAt: res.rows[0].openedAt?.toISOString() ?? null,
          closesAt: res.rows[0].closesAt?.toISOString() ?? null,
          createdAt: res.rows[0].createdAt.toISOString(),
        } : null,
      };
    } catch (err: unknown) {
      reply.status(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  // ── Result detail ──────────────────────────────────────────────────
  app.get<{ Params: { id: string; resultId: string } }>(
    "/v1/elections/:id/results/:resultId",
    async (req, reply) => {
      try {
        const electionId = requireElectionId(req.params.id);
        const election = await getElectionMeta(electionId);
        if (!election) {
          reply.status(404);
          return { ok: false, error: "election_not_found" };
        }
        const resultId = String(req.params.resultId);

        const res = await pool.query(
          `SELECT
            id,
            tally_job_id AS "tallyJobId",
            result_kind AS "resultKind",
            payload_json AS "payloadJson",
            payload_hash AS "payloadHash",
            publication_status AS "publicationStatus",
            proof_state AS "proofState",
            created_at AS "createdAt",
            published_at AS "publishedAt"
          FROM result_payloads
          WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 AND id=$4
          LIMIT 1`,
          [chainId, contractAddress, electionId, resultId],
        );

        if (res.rows.length === 0) {
          reply.status(404);
          return { ok: false, error: "result_not_found" };
        }

        const r = res.rows[0]!;
        return {
          ok: true,
          chainId,
          contractAddress,
          electionId: electionId.toString(),
          result: {
            ...r,
            resultMode: mapProofStateToResultMode(r.proofState),
            createdAt: r.createdAt.toISOString(),
            publishedAt: r.publishedAt?.toISOString() ?? null,
          },
        };
      } catch (err: unknown) {
        reply.status(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // ── Audit Bundle ───────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/v1/elections/:id/audit-bundle", async (req, reply) => {
    try {
      const electionId = requireElectionId(req.params.id);
      const election = await getElectionMeta(electionId);
      if (!election) {
        reply.status(404);
        return { ok: false, error: "election_not_found" };
      }

      // Collect all evidence in one shot
      const [
        batchesRes, jobsRes, resultsRes, actsRes, anchorsRes,
        auditWindowRes, bundleExportRes, ballotsCountRes, incidentsRes,
      ] = await Promise.all([
        pool.query(
          `SELECT batch_id AS "batchId", batch_index AS "batchIndex", input_count AS "inputCount", status, related_root AS "relatedRoot", created_at AS "createdAt", completed_at AS "completedAt"
           FROM processing_batches WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY batch_index`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT tally_job_id AS "tallyJobId", based_on_batch_set AS "basedOnBatchSet", status, proof_state AS "proofState", result_summary AS "resultSummary", tally_commitment AS "tallyCommitment", created_at AS "createdAt", completed_at AS "completedAt"
           FROM tally_jobs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, tally_job_id AS "tallyJobId", result_kind AS "resultKind", payload_hash AS "payloadHash", proof_state AS "proofState", publication_status AS "publicationStatus", created_at AS "createdAt", published_at AS "publishedAt"
           FROM result_payloads WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT act_id AS "actId", act_type AS "actType", content_hash AS "contentHash", verification_status AS "verificationStatus", signature_scheme AS "signatureScheme", signer_address AS "signerAddress", signer_role AS "signerRole", signing_digest AS "signingDigest", created_at AS "createdAt"
           FROM acta_contents WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT kind, snapshot_hash AS "snapshotHash", tx_hash AS "txHash", block_number AS "blockNumber", block_timestamp AS "blockTimestamp"
           FROM acta_anchors WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY block_number`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, status, opened_at AS "openedAt", closes_at AS "closesAt", opened_by AS "openedBy", notes, created_at AS "createdAt"
           FROM audit_windows WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 LIMIT 1`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT id, bundle_hash AS "bundleHash", bundle_manifest_json AS "bundleManifest", export_status AS "exportStatus", created_at AS "createdAt"
           FROM audit_bundle_exports WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY created_at DESC LIMIT 1`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS c FROM ballot_records WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3`,
          [chainId, contractAddress, electionId],
        ),
        pool.query(
          `SELECT fingerprint, code, severity, message, active, occurrences, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
           FROM incident_logs WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3 ORDER BY last_seen_at DESC LIMIT 50`,
          [chainId, contractAddress, electionId],
        ),
      ]);

      const bundleExport = bundleExportRes.rows[0] ?? null;

      return {
        ok: true,
        chainId,
        contractAddress,
        electionId: electionId.toString(),
        generatedAt: new Date().toISOString(),
        bundleHash: bundleExport?.bundleHash ?? null,
        bundleManifest: bundleExport?.bundleManifest ?? null,
        exportStatus: bundleExport?.exportStatus ?? "NOT_MATERIALIZED",
        election: {
          manifestHash: election.manifestHash,
          authority: election.authority,
          registryAuthority: election.registryAuthority,
          phase: election.phase,
        },
        ballotsSummary: { total: ballotsCountRes.rows[0]?.c ?? 0 },
        processingBatches: batchesRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
        tallyJobs: jobsRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
        resultPayloads: resultsRes.rows.map((r: any) => ({
          ...r,
          resultMode: mapProofStateToResultMode(r.proofState),
          createdAt: r.createdAt?.toISOString() ?? null,
          publishedAt: r.publishedAt?.toISOString() ?? null,
        })),
        actas: actsRes.rows.map((r: any) => ({
          ...r,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
        anchors: anchorsRes.rows.map((r: any) => ({
          ...r,
          blockTimestamp: r.blockTimestamp?.toISOString() ?? null,
        })),
        auditWindow: auditWindowRes.rows[0] ? {
          ...auditWindowRes.rows[0],
          openedAt: auditWindowRes.rows[0].openedAt?.toISOString() ?? null,
          closesAt: auditWindowRes.rows[0].closesAt?.toISOString() ?? null,
          createdAt: auditWindowRes.rows[0].createdAt?.toISOString() ?? null,
        } : null,
        incidents: incidentsRes.rows.map((r: any) => ({
          ...r,
          firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
        })),
        honesty: (() => {
          const latestProofState = String(resultsRes.rows[0]?.proofState ?? "NOT_IMPLEMENTED");
          return {
            resultMode: mapProofStateToResultMode(latestProofState),
            proofState: latestProofState,
            note: honestyNoteForProofState(latestProofState),
          };
        })(),
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
