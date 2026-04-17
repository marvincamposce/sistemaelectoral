const { Pool } = require("pg");
const { ethers } = require("ethers");
const pool = new Pool({ connectionString: "postgresql://blockurna:blockurna@127.0.0.1:5432/blockurna" });

async function fix() {
  const dni = "0301200303343";
  const accessCode = "123456";
  const hash = ethers.keccak256(ethers.toUtf8Bytes(accessCode)).toLowerCase();
  
  const res = await pool.query(`SELECT metadata_json FROM hn_voter_registry WHERE dni=$1`, [dni]);
  if (res.rows.length === 0) {
    console.log("DNI not found!"); return;
  }
  let meta = res.rows[0].metadata_json || {};
  meta.citizenAccessCodeHash = hash;
  meta.citizenAccessCodeRotatedAt = new Date().toISOString();
  
  await pool.query(`UPDATE hn_voter_registry SET metadata_json=$1 WHERE dni=$2`, [meta, dni]);
  console.log("✓ Access code updated to: 123456");

  await pool.query(`
    INSERT INTO hn_enrollment_requests (dni, status, request_channel, requested_at) 
    VALUES ($1, 'PENDING_REVIEW', 'AEA_MANUAL', NOW())
  `, [dni]);
  console.log("✓ Inserted PENDING_REVIEW enrollment request");
  process.exit(0);
}
fix();
