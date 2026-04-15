const { ethers } = require("ethers");

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("Uso: node generate.cjs <ELECTION_ID>");
    process.exit(1);
  }

  // Constantes del entorno dummy
  const chainId = "31337";
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const reaPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  console.log(`Generando credencial para Elección #${electionId}...`);

  // 1. SecretHex y CredentialId
  const secretHex = ethers.hexlify(ethers.randomBytes(32)).toLowerCase();
  const credentialId = ethers.keccak256(secretHex).toLowerCase();

  // 2. Derive Registry Nullifier
  const electionIdBig = BigInt(electionId);
  const registryNullifier = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:nullifier", electionIdBig, secretHex],
    ),
  ).toLowerCase();

  // 3. Compute Digest
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "bytes32"],
      ["BU-PVP-1:signup", electionIdBig, registryNullifier],
    ),
  ).toLowerCase();

  // 4. Sign
  const wallet = new ethers.Wallet(reaPrivateKey);
  const permitSig = await wallet.signMessage(ethers.getBytes(digest));

  const permit = {
    permitVersion: "1",
    protocolVersion: "BU-PVP-1",
    chainId,
    contractAddress,
    electionId,
    registryNullifier,
    credentialId,
    issuedAt: new Date().toISOString(),
    issuerAddress: wallet.address.toLowerCase(),
    permitSig,
  };

  console.log("\n==================================");
  console.log("Copia este JSON en el Voter Portal (Permiso de Activación): \n");
  console.log(JSON.stringify(permit, null, 0));
  console.log("\n==================================\n");
}

main().catch(console.error);
