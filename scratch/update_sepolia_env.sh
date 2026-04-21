#!/bin/bash

RPC_URL="https://rpc.ankr.com/eth_sepolia/b8ec123d573ff7290be5cc863464f8cec25cb3c06e5b4eded7b84db75b67d60f"
CHAIN_ID="11155111"
REGISTRY="0x173402879dAbeff1B9970be891bD7CA5E2338641"
TALLY_VERIFIER="0x59ab2eE645fd0276185a522f9c140CB81caeb1C1"
DECRYPTION_VERIFIER="0xF31b76aE612c4b79dBdCC5c051D44DbdF50BAED7"
PRIVATE_KEY="913c3d7b30d31d0281e6d24b464335ab42abba8e07aaee3ebfb2a98e5f1dd094"

FILES=(
  "apps/evidence-api/.env"
  "apps/evidence-indexer/.env"
  "apps/mrd-relayer/.env"
  "apps/authority-console/.env.local"
  "apps/voter-portal/.env.local"
  "apps/tally-board/.env.local"
  "apps/observer-portal/.env.local"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Updating $file..."
    sed -i "s|RPC_URL=.*|RPC_URL=$RPC_URL|g" "$file"
    sed -i "s|CHAIN_ID=.*|CHAIN_ID=$CHAIN_ID|g" "$file"
    sed -i "s|ELECTION_REGISTRY_ADDRESS=.*|ELECTION_REGISTRY_ADDRESS=$REGISTRY|g" "$file"
    sed -i "s|TALLY_VERIFIER_ADDRESS=.*|TALLY_VERIFIER_ADDRESS=$TALLY_VERIFIER|g" "$file"
    sed -i "s|DECRYPTION_VERIFIER_ADDRESS=.*|DECRYPTION_VERIFIER_ADDRESS=$DECRYPTION_VERIFIER|g" "$file"
    
    # Specific for relayer and authority console
    sed -i "s|AEA_PRIVATE_KEY=.*|AEA_PRIVATE_KEY=$PRIVATE_KEY|g" "$file"
    sed -i "s|RELAYER_PRIVATE_KEY=.*|RELAYER_PRIVATE_KEY=$PRIVATE_KEY|g" "$file"
    sed -i "s|COORDINATOR_PRIVATE_KEY=.*|COORDINATOR_PRIVATE_KEY=$PRIVATE_KEY|g" "$file"
  else
    echo "Skipping $file (not found)"
  fi
done

echo "Done updating .env files."
