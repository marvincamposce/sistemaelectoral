#!/usr/bin/env bash
# Compile the TallyVerifier circuit
# Usage: bash scripts/compile.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PKG_DIR/build"

mkdir -p "$BUILD_DIR"

echo "=== Compiling tally_verifier.circom ==="
circom "$PKG_DIR/circuits/tally_verifier.circom" \
  --r1cs \
  --wasm \
  --sym \
  -l "$PKG_DIR/node_modules" \
  -o "$BUILD_DIR"

echo ""
echo "=== Compiling decryption_verifier.circom ==="
circom "$PKG_DIR/circuits/decryption_verifier.circom" \
  --r1cs \
  --wasm \
  --sym \
  -l "$PKG_DIR/node_modules" \
  -o "$BUILD_DIR"

echo ""
echo "=== Build artifacts ==="
ls -la "$BUILD_DIR"/tally_verifier*
ls -la "$BUILD_DIR"/decryption_verifier*
echo ""
echo "Done. Next step: bash scripts/setup.sh"
