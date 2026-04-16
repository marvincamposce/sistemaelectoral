import pg from "pg";
import { ethers } from "ethers";
import { BU_PVP_1_ELECTION_REGISTRY_ABI } from "@blockurna/sdk";

export async function runWorkerLoop(pool: pg.Pool, provider: ethers.JsonRpcProvider, wallet: ethers.Wallet, contractAddress: string) {
  const contract = new ethers.Contract(contractAddress, BU_PVP_1_ELECTION_REGISTRY_ABI, wallet);
  const chainId = (await provider.getNetwork()).chainId.toString();

  while (true) {
    try {
      const res = await pool.query(
        `SELECT id, election_id, kind, payload FROM mrd_submissions 
         WHERE status = 'PENDING' 
         ORDER BY created_at ASC 
         LIMIT 1 FOR UPDATE SKIP LOCKED`
      );

      if (res.rows.length === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const row = res.rows[0];
      const { id, election_id, kind, payload } = row;

      await pool.query(`UPDATE mrd_submissions SET status = 'IN_FLIGHT', updated_at = NOW() WHERE id = $1`, [id]);

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
