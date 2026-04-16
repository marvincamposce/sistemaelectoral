#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
RUST_BACKEND_DIR="$PKG_DIR/rust-backend"
RUST_BACKEND_CARGO="$RUST_BACKEND_DIR/Cargo.toml"
RUST_BACKEND_BIN="$RUST_BACKEND_DIR/target/release/zk_tally_rs"
VERIFYING_KEY="$PKG_DIR/keys/tally_verifier_rust.vk.bin"
DECRYPTION_VERIFYING_KEY="$PKG_DIR/keys/decryption_verifier_rust.vk.bin"

OUTPUT_PATH="${1:-$PKG_DIR/../contracts/contracts/Groth16Verifier.sol}"
CONTRACT_NAME="${SOLIDITY_VERIFIER_CONTRACT_NAME:-Groth16Verifier}"
DECRYPTION_OUTPUT_PATH="${2:-$PKG_DIR/../contracts/contracts/Groth16DecryptionVerifier.sol}"
DECRYPTION_CONTRACT_NAME="${DECRYPTION_SOLIDITY_VERIFIER_CONTRACT_NAME:-Groth16DecryptionVerifier}"

if [ ! -f "$VERIFYING_KEY" ] || [ ! -f "$DECRYPTION_VERIFYING_KEY" ]; then
  echo "Rust verifying key(s) not found. Running setup first..."
  SETUP_BACKEND=rust EXPORT_SOLIDITY_VERIFIER=0 bash "$SCRIPT_DIR/setup.sh"
fi

if [ ! -x "$RUST_BACKEND_BIN" ]; then
  echo "Building rust backend..."
  cargo build --release --manifest-path "$RUST_BACKEND_CARGO"
fi

"$RUST_BACKEND_BIN" export-solidity-verifier \
  --verifying-key "$VERIFYING_KEY" \
  --output "$OUTPUT_PATH" \
  --contract-name "$CONTRACT_NAME"

"$RUST_BACKEND_BIN" export-solidity-verifier \
  --verifying-key "$DECRYPTION_VERIFYING_KEY" \
  --output "$DECRYPTION_OUTPUT_PATH" \
  --contract-name "$DECRYPTION_CONTRACT_NAME"

echo "Solidity verifier exported to: $OUTPUT_PATH"
echo "Decryption verifier exported to: $DECRYPTION_OUTPUT_PATH"
