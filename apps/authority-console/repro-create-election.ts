import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { ethers } from 'ethers';
import {
  canonicalizeJson,
  deriveCoordinatorPublicKey,
  getPublicKeyHex,
  sha256Hex,
  signEd25519Hex,
  utf8ToBytes,
} from '@blockurna/crypto';
import { getPool, ensureSchema, upsertCandidate, upsertElectionManifest, insertAdminLogEntry } from './src/lib/db.ts';
import { getRegistry, parseElectionCreatedFromReceipt } from './src/lib/registry.ts';

async function main() {
  loadEnv({ path: path.resolve(process.cwd(), 'apps/authority-console/.env.local') });

  const env = {
    DATABASE_URL: process.env.DATABASE_URL!,
    RPC_URL: process.env.RPC_URL!,
    CHAIN_ID: process.env.CHAIN_ID!,
    CONTRACT_ADDRESS: process.env.ELECTION_REGISTRY_ADDRESS!,
    AEA_PRIVATE_KEY: process.env.AEA_PRIVATE_KEY!,
    AEA_ED25519_PRIVATE_KEY_HEX: process.env.AEA_ED25519_PRIVATE_KEY_HEX!,
    COORDINATOR_PRIVATE_KEY: process.env.COORDINATOR_PRIVATE_KEY!,
  };

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.AEA_PRIVATE_KEY, provider);
  const authorityAddress = await wallet.getAddress();
  const registryAuthority = authorityAddress;
  const coordinatorPubKey = await deriveCoordinatorPublicKey(env.COORDINATOR_PRIVATE_KEY);

  const candidatesCatalog = [
    { id: 'cand-1', candidateCode: 'CAND_1', displayName: 'Mariana Soto', shortName: 'M. Soto', partyName: 'Alianza Cívica', ballotOrder: 1, status: 'ACTIVE' as const, colorHex: '#1D4ED8' },
    { id: 'cand-2', candidateCode: 'CAND_2', displayName: 'Tomás Rivas', shortName: 'T. Rivas', partyName: 'Movimiento Federal', ballotOrder: 2, status: 'ACTIVE' as const, colorHex: '#0F766E' },
    { id: 'cand-3', candidateCode: 'CAND_3', displayName: 'Lucía Peña', shortName: 'L. Peña', partyName: 'Pacto Social', ballotOrder: 3, status: 'ACTIVE' as const, colorHex: '#B45309' },
  ];

  const manifestBody = {
    manifestVersion: '1',
    protocolVersion: 'BU-PVP-1',
    generatedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS,
    title: `Repro elección ${Date.now()}`,
    authority: { address: authorityAddress },
    registryAuthority: { address: registryAuthority },
    coordinatorPubKey,
    notes: 'repro server action',
    catalogSource: 'DB_PROJECTED',
    candidates: candidatesCatalog.map((c) => ({ ...c, metadata: {} })),
  } as const;

  const manifestCanonical = canonicalizeJson(manifestBody);
  const manifestHashHex = sha256Hex(manifestCanonical).toLowerCase();
  const publicKeyHex = await getPublicKeyHex(env.AEA_ED25519_PRIVATE_KEY_HEX);
  const signatureHex = await signEd25519Hex(utf8ToBytes(manifestHashHex), env.AEA_ED25519_PRIVATE_KEY_HEX);
  const signedManifest = {
    manifest: manifestBody,
    signature: {
      algorithm: 'ed25519-sha256-jcs',
      publicKeyHex,
      signatureHex,
      manifestHashHex,
    },
  } as const;

  const contract = getRegistry(env.CONTRACT_ADDRESS, wallet);
  const tx = await (contract as any).createElection(manifestHashHex, registryAuthority, coordinatorPubKey);
  const receipt = await tx.wait();
  const electionId = receipt
    ? parseElectionCreatedFromReceipt({ receipt, contractAddress: env.CONTRACT_ADDRESS })
    : null;

  console.log('ONCHAIN_OK', { txHash: receipt?.hash, electionId });

  const block = receipt ? await provider.getBlock(receipt.blockNumber) : null;
  const blockTimestampIso = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;

  const pool = getPool(env.DATABASE_URL);
  await ensureSchema(pool);

  if (electionId !== null) {
    for (const candidate of candidatesCatalog) {
      await upsertCandidate({
        pool,
        chainId: env.CHAIN_ID,
        contractAddress: env.CONTRACT_ADDRESS.toLowerCase(),
        electionId,
        id: candidate.id,
        candidateCode: candidate.candidateCode,
        displayName: candidate.displayName,
        shortName: candidate.shortName,
        partyName: candidate.partyName,
        ballotOrder: candidate.ballotOrder,
        status: candidate.status,
        colorHex: candidate.colorHex,
        metadataJson: {},
      });
    }

    await upsertElectionManifest({
      pool,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS.toLowerCase(),
      electionId,
      manifestHash: manifestHashHex,
      manifestJson: signedManifest,
      source: 'DB_PROJECTED',
    });
  }

  await insertAdminLogEntry({
    pool,
    chainId: env.CHAIN_ID,
    contractAddress: env.CONTRACT_ADDRESS.toLowerCase(),
    electionId,
    code: 'CREATE_ELECTION_REPRO',
    message: 'Repro server action sequence',
    details: { electionId, manifestHashHex },
    evidencePointers: [],
    actorAddress: authorityAddress,
    relatedTxHash: receipt?.hash ?? null,
    relatedBlockNumber: receipt?.blockNumber ?? null,
    relatedBlockTimestampIso: blockTimestampIso,
  });

  console.log('DB_OK');
}

main().catch((err) => {
  console.error('REPRO_ERR', err);
  process.exit(1);
});
