#!/usr/bin/env bash
set -e

echo "========================================================="
echo " BlockUrna: Configuración Rápida para AZURE (Backend)"
echo "========================================================="

# Por defecto, usaremos las llaves de prueba locales de Hardhat para la demo
AEA_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
JED_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
COORDINATOR_PK="0x0312ff2054471efe7bc08b7a7abcaaf141cb4a64d41a5e46586450ad24b366fa"
RELAYER_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

# Reemplaza estas tres variables si decides usar Sepolia
CONTRACT_ADDR="0x5FbDB2315678afecb367f032d93F642f64180aa3"
RPC_URL="http://127.0.0.1:8545"
CHAIN_ID="31337"
DB_URL="postgresql://postgres.ikdfifwcgzfrwpmtxhje:THd6on9%3Fsd37D%40nt@aws-1-us-east-2.pooler.supabase.com:6543/postgres"

echo "Configurando variables para los servicios Backend en Azure..."

# evidence-api
cat <<EOF > apps/evidence-api/.env
DATABASE_URL=$DB_URL
CHAIN_ID=$CHAIN_ID
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
HOST=0.0.0.0
PORT=3020
EOF

# evidence-indexer
cat <<EOF > apps/evidence-indexer/.env
DATABASE_URL=$DB_URL
RPC_URL=$RPC_URL
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
ACTA_SOURCE_DIR=packages/contracts/generated-output
START_BLOCK=0
CONFIRMATIONS=0
BATCH_SIZE=2000
POLL_INTERVAL_MS=2000
EOF

# mrd-relayer
cat <<EOF > apps/mrd-relayer/.env
DATABASE_URL=$DB_URL
RPC_URL=$RPC_URL
ELECTION_REGISTRY_ADDRESS=$CONTRACT_ADDR
RELAYER_PRIVATE_KEY=$RELAYER_PK
HOST=0.0.0.0
PORT=8002
EOF

echo "✓ Archivos .env generados correctamente en Azure."
echo "Puedes iniciar los servicios corriendo: pm2 start ecosystem.config.js"
echo "========================================================="
