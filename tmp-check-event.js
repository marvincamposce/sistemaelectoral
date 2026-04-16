const { ethers } = require('ethers');
const fs = require('fs');

function readEnv(path) {
  const text = fs.readFileSync(path, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

(async () => {
  const env = readEnv('apps/authority-console/.env.local');
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const abi = [
    'function createElection(bytes32 manifestHash,address registryAuthority,bytes coordinatorPubKey) returns (uint256)',
    'event ElectionCreated(uint256 indexed electionId, bytes32 indexed manifestHash, address indexed authority, address registryAuthority, bytes coordinatorPubKey)'
  ];
  const contract = new ethers.Contract(env.ELECTION_REGISTRY_ADDRESS, abi, wallet);
  const iface = new ethers.Interface(abi);

  const code = await provider.getCode(env.ELECTION_REGISTRY_ADDRESS);
  console.log('CODE_LEN', code === '0x' ? 0 : (code.length - 2) / 2);

  const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(`probe-${Date.now()}`));
  const tx = await contract.createElection(manifestHash, wallet.address, '0x' + '11'.repeat(32));
  const receipt = await tx.wait();

  console.log('TX', receipt.hash, 'STATUS', receipt.status, 'LOGS', receipt.logs.length);

  let found = false;
  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== env.ELECTION_REGISTRY_ADDRESS.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === 'ElectionCreated') {
        found = true;
        console.log('EVENT ElectionCreated electionId=', parsed.args.electionId.toString());
      }
    } catch (_) {}
  }

  console.log('EVENT_FOUND', found);
})().catch((err) => {
  console.error('ERROR', err?.message || err);
  process.exit(1);
}).finally(() => {
  fs.unlinkSync('tmp-check-event.js');
});
