#!/usr/bin/env bash
set -e

echo "========================================================="
echo " BlockUrna: Configurador de Entorno Local (Investigación)"
echo "========================================================="

# Defaults fijos de Hardhat Local Node
AEA_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
JED_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
COORDINATOR_PK="0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa"
# Dirección esperada para el primer contrato desplegado en un nodo hardhat limpio.
CONTRACT_ADDR="0x5FbDB2315678afecb367f032d93F642f64180aa3"
TALLY_VERIFIER_ADDR="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
DB_URL="postgresql://blockurna:blockurna@127.0.0.1:5432/blockurna"

echo "1. Configurando variables compartidas..."

# authority-console
cat <<EOF > apps/authority-console/.env.local
EVIDENCE_API_URL=http://127.0.0.1:3020
DATABASE_URL=$DB_URL
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
AEA_PRIVATE_KEY=$AEA_PK
AEA_ED25519_PRIVATE_KEY_HEX=0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
COORDINATOR_PRIVATE_KEY=$COORDINATOR_PK
ACTA_OUTPUT_DIR=packages/contracts/generated-output
EOF

# evidence-api
cat <<EOF > apps/evidence-api/.env
DATABASE_URL=$DB_URL
CHAIN_ID=31337
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
HOST=0.0.0.0
PORT=3020
EOF

# evidence-indexer
cat <<EOF > apps/evidence-indexer/.env
DATABASE_URL=$DB_URL
RPC_URL=http://127.0.0.1:8545
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
ACTA_SOURCE_DIR=packages/contracts/generated-output
START_BLOCK=0
CONFIRMATIONS=0
BATCH_SIZE=2000
POLL_INTERVAL_MS=2000
EOF

# tally-board
cat <<EOF > apps/tally-board/.env.local
RPC_URL=http://127.0.0.1:8545
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
TALLY_VERIFIER_ADDRESS=$TALLY_VERIFIER_ADDR
AE_PRIVATE_KEY=$AEA_PK
JED_PRIVATE_KEY=$JED_PK
COORDINATOR_PRIVATE_KEY=$COORDINATOR_PK
NEXT_PUBLIC_EVIDENCE_API_URL=http://127.0.0.1:3020
DATABASE_URL=$DB_URL
EOF

# observer-portal
cat <<EOF > apps/observer-portal/.env.local
NEXT_PUBLIC_EVIDENCE_API_URL=http://127.0.0.1:3020
EOF

# voter-portal
cat <<EOF > apps/voter-portal/.env.local
NEXT_PUBLIC_EVIDENCE_API_URL=http://127.0.0.1:3020
RPC_URL=http://127.0.0.1:8545
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
EOF

echo "✓ Archivos .env y .env.local generados correctamente."
echo ""
echo "Nota: Si usas ./start-dev.sh, las direcciones se sincronizan automáticamente"
echo "según el despliegue real del momento."
echo "Dirección esperada en red hardhat limpia: $CONTRACT_ADDR"
echo "========================================================="
echo "Configuración Completada."
