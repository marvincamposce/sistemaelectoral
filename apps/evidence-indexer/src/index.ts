import "dotenv/config";

import { ethers } from "ethers";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";

import { getEnv } from "./env.js";
import {
  createPool,
  ensureSchema,
  getOrInitNextBlock,
  setNextBlock,
  withTransaction,
} from "./db.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(address: string): string {
  return ethers.getAddress(address).toLowerCase();
}

async function main() {
  const env = getEnv();

  const contractAddress = normalizeAddress(env.ELECTION_REGISTRY_ADDRESS);

  const pool = createPool(env.DATABASE_URL);
  await ensureSchema(pool);

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const network = await provider.getNetwork();
  const chainId = network.chainId.toString();

  let nextBlock = await getOrInitNextBlock({
    pool,
    chainId,
    contractAddress,
    startBlock: env.START_BLOCK,
  });

  const iface = new ethers.Interface(BU_PVP_1_ELECTION_REGISTRY_ABI);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const head = await provider.getBlockNumber();
    const target = Math.max(0, head - env.CONFIRMATIONS);
    if (nextBlock > target) {
      await sleep(env.POLL_INTERVAL_MS);
      continue;
    }

    const toBlock = Math.min(target, nextBlock + env.BATCH_SIZE - 1);

    const logs = await provider.getLogs({
      address: contractAddress,
      fromBlock: nextBlock,
      toBlock,
    });

    await withTransaction(pool, async (client) => {
      for (const log of logs) {
        const parsed = (() => {
          try {
            return iface.parseLog({ topics: log.topics, data: log.data });
          } catch {
            return null;
          }
        })();

        if (!parsed) continue;

        const txHash = log.transactionHash;
        const logIndex = log.index;
        const blockNumber = log.blockNumber;

        if (parsed.name === "ElectionCreated") {
          const electionId = (parsed.args as any).electionId as bigint;
          const manifestHash = String((parsed.args as any).manifestHash);
          const authority = String((parsed.args as any).authority).toLowerCase();
          const registryAuthority = String((parsed.args as any).registryAuthority).toLowerCase();
          const coordinatorPubKey = String((parsed.args as any).coordinatorPubKey);

          await client.query(
            `INSERT INTO elections(
              chain_id, contract_address, election_id,
              manifest_hash, authority, registry_authority, coordinator_pub_key,
              phase, created_at_block, created_tx_hash
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              electionId.toString(),
              manifestHash,
              authority,
              registryAuthority,
              coordinatorPubKey,
              0,
              blockNumber,
              txHash,
            ],
          );
          continue;
        }

        if (parsed.name === "PhaseChanged") {
          const electionId = (parsed.args as any).electionId as bigint;
          const previousPhase = Number((parsed.args as any).previousPhase);
          const newPhase = Number((parsed.args as any).newPhase);

          await client.query(
            `INSERT INTO phase_changes(
              chain_id, contract_address, tx_hash, log_index, block_number,
              election_id, previous_phase, new_phase
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              electionId.toString(),
              previousPhase,
              newPhase,
            ],
          );

          await client.query(
            "UPDATE elections SET phase=$4 WHERE chain_id=$1 AND contract_address=$2 AND election_id=$3",
            [chainId, contractAddress, electionId.toString(), newPhase],
          );
          continue;
        }

        if (parsed.name === "ActaPublished") {
          const electionId = (parsed.args as any).electionId as bigint;
          const kind = Number((parsed.args as any).kind);
          const snapshotHash = String((parsed.args as any).snapshotHash);

          await client.query(
            `INSERT INTO acta_anchors(
              chain_id, contract_address, tx_hash, log_index, block_number,
              election_id, kind, snapshot_hash
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              electionId.toString(),
              kind,
              snapshotHash,
            ],
          );
          continue;
        }

        if (parsed.name === "SignupRecorded") {
          const electionId = (parsed.args as any).electionId as bigint;
          const registryNullifier = String((parsed.args as any).registryNullifier);
          const votingPubKey = String((parsed.args as any).votingPubKey);

          await client.query(
            `INSERT INTO signups(
              chain_id, contract_address, tx_hash, log_index, block_number,
              election_id, registry_nullifier, voting_pub_key
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              electionId.toString(),
              registryNullifier,
              votingPubKey,
            ],
          );
          continue;
        }

        if (parsed.name === "BallotPublished") {
          const electionId = (parsed.args as any).electionId as bigint;
          const ballotIndex = (parsed.args as any).ballotIndex as bigint;
          const ballotHash = String((parsed.args as any).ballotHash);
          const ciphertext = String((parsed.args as any).ciphertext);

          await client.query(
            `INSERT INTO ballots(
              chain_id, contract_address, tx_hash, log_index, block_number,
              election_id, ballot_index, ballot_hash, ciphertext
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT DO NOTHING`,
            [
              chainId,
              contractAddress,
              txHash,
              logIndex,
              blockNumber,
              electionId.toString(),
              ballotIndex.toString(),
              ballotHash,
              ciphertext,
            ],
          );
        }
      }
    });

    const newNext = toBlock + 1;
    await setNextBlock({ pool, chainId, contractAddress, nextBlock: newNext });
    nextBlock = newNext;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
