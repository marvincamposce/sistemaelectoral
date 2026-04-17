const { Pool } = require("pg");
const { ethers } = require("ethers");
const crypto = require("crypto");
const pool = new Pool({ connectionString: "postgresql://blockurna:blockurna@127.0.0.1:5432/blockurna" });

async function fix() {
  const dni = "0301200303343";
  const electionId = "0"; // Assuming election 0
  const chainId = "31337";
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  
  const reqRes = await pool.query(`SELECT request_id FROM hn_enrollment_requests WHERE dni=$1 LIMIT 1`, [dni]);
  if (reqRes.rows.length === 0) return console.log("No request");
  const requestId = reqRes.rows[0].request_id;
  
  // Create wallet
  const wallet = ethers.Wallet.createRandom();
  const walletAddress = wallet.address.toLowerCase();
  
  await pool.query(`
    INSERT INTO hn_wallet_links (dni, wallet_address, link_status, verification_method, evidence_json)
    VALUES ($1, $2, 'ACTIVE', 'SYSTEM_MANAGED', $3)
  `, [dni, walletAddress, {
      systemManagedWallet: true,
      managedPrivateKeyHex: wallet.privateKey.toLowerCase(),
      credentialSecretHex: ethers.hexlify(crypto.randomBytes(32)).toLowerCase(),
      walletProvisioningMode: "SYSTEM_MANAGED",
  }]);
  
  await pool.query(`
    INSERT INTO hn_voter_authorizations (authorization_id, chain_id, contract_address, election_id, dni, wallet_address, enrollment_request_id, status, authorized_by, metadata_json)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'AUTHORIZED', 'AUTHORITY_CONSOLE', '{"source":"AUTHORITY_CONSOLE"}')
  `, [chainId, contractAddress, electionId, dni, walletAddress, requestId]);
  
  console.log("✓ Voter authorized successfully for election 0!");
  process.exit(0);
}
fix();
