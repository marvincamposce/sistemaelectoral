#!/usr/bin/env bash
# Groth16 Trusted Setup for TallyVerifier circuit
# Usage: bash scripts/setup.sh
#
# This performs a LOCAL Powers of Tau ceremony (Phase 1) and a
# circuit-specific setup (Phase 2). For production, Phase 1 would
# come from a community MPC ceremony (e.g., Hermez or Zcash).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PKG_DIR/build"
KEYS_DIR="$PKG_DIR/keys"

mkdir -p "$KEYS_DIR"

R1CS="$BUILD_DIR/tally_verifier.r1cs"
if [ ! -f "$R1CS" ]; then
  echo "ERROR: r1cs not found. Run 'bash scripts/compile.sh' first."
  exit 1
fi

# --- Phase 1: Powers of Tau ---
# 2^12 = 4096 supports up to 4096 constraints (our circuit has 2240)
PTAU_POWER=12
PTAU_FILE="$KEYS_DIR/pot${PTAU_POWER}_0000.ptau"
PTAU_FINAL="$KEYS_DIR/pot${PTAU_POWER}_final.ptau"

if [ ! -f "$PTAU_FINAL" ]; then
  echo "=== Phase 1: Powers of Tau (2^${PTAU_POWER}) ==="

  echo "  [1/4] Starting new Powers of Tau ceremony..."
  npx snarkjs powersoftau new bn128 "$PTAU_POWER" "$PTAU_FILE" -v

  echo "  [2/4] Contributing randomness (local entropy)..."
  npx snarkjs powersoftau contribute "$PTAU_FILE" "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau" \
    --name="BlockUrna Phase9A Local" \
    -e="$(head -c 64 /dev/urandom | xxd -p -c 128)"

  echo "  [3/4] Preparing Phase 2..."
  npx snarkjs powersoftau prepare phase2 "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau" "$PTAU_FINAL" -v

  echo "  [4/4] Verifying Powers of Tau..."
  npx snarkjs powersoftau verify "$PTAU_FINAL"

  # Cleanup intermediate files
  rm -f "$PTAU_FILE" "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau"
else
  echo "=== Reusing existing Powers of Tau: $PTAU_FINAL ==="
fi

# --- Phase 2: Circuit-specific Groth16 setup ---
ZKEY_INIT="$KEYS_DIR/tally_verifier_0000.zkey"
ZKEY_FINAL="$KEYS_DIR/tally_verifier_final.zkey"
VKEY="$KEYS_DIR/verification_key.json"

echo ""
echo "=== Phase 2: Groth16 Circuit Setup ==="

echo "  [1/3] Generating initial zkey..."
npx snarkjs groth16 setup "$R1CS" "$PTAU_FINAL" "$ZKEY_INIT"

echo "  [2/3] Contributing circuit-specific randomness..."
npx snarkjs zkey contribute "$ZKEY_INIT" "$ZKEY_FINAL" \
  --name="BlockUrna Phase9A Circuit" \
  -e="$(head -c 64 /dev/urandom | xxd -p -c 128)"

echo "  [3/3] Exporting verification key..."
npx snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY"

# Cleanup
rm -f "$ZKEY_INIT"

echo ""
echo "=== Setup Complete ==="
echo "  Proving key:      $ZKEY_FINAL"
echo "  Verification key: $VKEY"
echo ""
echo "Verification key hash:"
sha256sum "$VKEY"
