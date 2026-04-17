import pg from "pg";
import { ethers } from "ethers";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";

export async function runWorkerLoop(pool: pg.Pool, provider: ethers.JsonRpcProvider, wallet: ethers.Wallet, contractAddress: string) {
  const contract = new ethers.Contract(contractAddress, BU_PVP_1_ELECTION_REGISTRY_ABI, wallet);
  const chainId = (await provider.getNetwork()).chainId.toString();

  while (true) {
    try {
      // Bug 4.1 fix: Atomically SELECT + mark IN_FLIGHT inside a single transaction
      // to prevent double-sending if the worker crashes between the two statements.
      const client = await pool.connect();
      let row: { id: string; election_id: string; kind: string; payload: any } | null = null;
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT id, election_id, kind, payload FROM mrd_submissions 
           WHERE status = 'PENDING' 
           ORDER BY created_at ASC 
           LIMIT 1 FOR UPDATE SKIP LOCKED`
        );

        if (res.rows.length === 0) {
          await client.query("COMMIT");
          client.release();
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        row = res.rows[0] as { id: string; election_id: string; kind: string; payload: any };
        await client.query(
          `UPDATE mrd_submissions SET status = 'IN_FLIGHT', updated_at = NOW() WHERE id = $1`,
          [row!.id],
        );
        await client.query("COMMIT");
      } catch (lockErr) {
        await client.query("ROLLBACK");
        throw lockErr;
      } finally {
        client.release();
      }

      // row is guaranteed non-null here — the null case is handled by the `continue` above.
      const { id, election_id, kind, payload } = row!;

      try {
        let tx;
        if (kind === "SIGNUP") {
          tx = await (contract as any).signup(
            BigInt(election_id),
            payload.registryNullifier,
            payload.votingPubKey,
            payload.permitSig
          );
        } else if (kind === "BALLOT") {
          tx = await (contract as any).publishBallot(
            BigInt(election_id),
            payload.votingPubKey,
            payload.ciphertext,
            payload.ballotSig
          );
        } else {
          throw new Error("Unknown kind: " + kind);
        }

        const receipt = await tx.wait();
        
        await pool.query(
          `UPDATE mrd_submissions SET status = $1, tx_hash = $2, updated_at = NOW() WHERE id = $3`,
          [receipt.status === 1 ? 'SUCCESS' : 'FAILED', tx.hash, id]
        );
      } catch (err: any) {
        console.error("Relayer execution error:", err);
        const errMsg = err?.message || String(err);

        // Bug 4.2 fix: Before marking FAILED, check if the tx was actually mined.
        // tx.wait() can throw on timeout/network even if the tx succeeded on-chain.
        const txHash = err?.transaction?.hash ?? err?.transactionHash ?? null;
        if (txHash) {
          try {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt && receipt.status === 1) {
              console.warn(`Worker: tx ${txHash} was mined successfully despite wait() error. Marking SUCCESS.`);
              await pool.query(
                `UPDATE mrd_submissions SET status = 'SUCCESS', tx_hash = $1, updated_at = NOW() WHERE id = $2`,
                [txHash, id],
              );
              continue;
            }
          } catch {
            // Receipt lookup failed — fall through to FAILED
          }
        }
        
        await pool.query(
          `UPDATE mrd_submissions SET status = 'FAILED', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [errMsg, id]
        );

        const code = kind === "SIGNUP" ? "MRD_SIGNUP_FAILED" : "MRD_BALLOT_FAILED";
        
        // Inject into global Incident Logs
        await pool.query(
          `INSERT INTO incident_logs(
            chain_id, contract_address, election_id, fingerprint, 
            code, severity, message, details, related_entity_type, related_entity_id, active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (chain_id, contract_address, election_id, fingerprint) DO UPDATE SET
            occurrences = incident_logs.occurrences + 1,
            last_seen_at = NOW(),
            message = EXCLUDED.message,
            details = EXCLUDED.details`,
          [
            chainId,
            contractAddress.toLowerCase(),
            election_id,
            `${code}:${id}`,
            code,
            "WARNING",
            `Relayer submission failed: ${errMsg.substring(0, 200)}`,
            JSON.stringify({ submissionId: id, kind, error: errMsg }),
            "MRD_SUBMISSION",
            id,
            true
          ]
        );
      }
    } catch (e) {
      console.error("Worker generic error:", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
