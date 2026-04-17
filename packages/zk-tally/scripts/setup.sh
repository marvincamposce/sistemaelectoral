#!/usr/bin/env bash
# Rust-only Groth16 setup for tally_verifier and decryption_verifier.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PKG_DIR/build"
KEYS_DIR="$PKG_DIR/keys"
SETUP_META_FILE="$KEYS_DIR/tally_verifier_setup.meta"
DECRYPTION_SETUP_META_FILE="$KEYS_DIR/decryption_verifier_setup.meta"
RUST_BACKEND_DIR="$PKG_DIR/rust-backend"
RUST_BACKEND_CARGO="$RUST_BACKEND_DIR/Cargo.toml"
RUST_BACKEND_BIN="$RUST_BACKEND_DIR/target/release/zk_tally_rs"

WASM="$BUILD_DIR/tally_verifier_js/tally_verifier.wasm"
R1CS="$BUILD_DIR/tally_verifier.r1cs"
DECRYPTION_WASM="$BUILD_DIR/decryption_verifier_js/decryption_verifier.wasm"
DECRYPTION_R1CS="$BUILD_DIR/decryption_verifier.r1cs"

RUST_PROVING_KEY="$KEYS_DIR/tally_verifier_rust.pk.bin"
RUST_VERIFYING_KEY="$KEYS_DIR/tally_verifier_rust.vk.bin"
VKEY="$KEYS_DIR/verification_key.json"
DECRYPTION_RUST_PROVING_KEY="$KEYS_DIR/decryption_verifier_rust.pk.bin"
DECRYPTION_RUST_VERIFYING_KEY="$KEYS_DIR/decryption_verifier_rust.vk.bin"
DECRYPTION_VKEY="$KEYS_DIR/verification_key_decryption.json"

mkdir -p "$KEYS_DIR"

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

run_checked() {
  echo "==> $*"
  "$@"
}

for required in "$RUST_BACKEND_CARGO" "$R1CS" "$WASM" "$DECRYPTION_R1CS" "$DECRYPTION_WASM"; do
  if [ ! -f "$required" ]; then
    echo "ERROR: missing required file: $required"
    exit 1
  fi
done

if [ ! -x "$RUST_BACKEND_BIN" ] || [ "${FORCE_RUST_BACKEND_REBUILD:-0}" = "1" ]; then
  run_checked cargo build --release --manifest-path "$RUST_BACKEND_CARGO"
fi

TALLY_R1CS_SHA256="$(sha256_file "$R1CS")"
DEC_R1CS_SHA256="$(sha256_file "$DECRYPTION_R1CS")"

if [ "${FORCE_PHASE2_REBUILD:-0}" != "1" ] && \
   [ -f "$RUST_PROVING_KEY" ] && [ -f "$RUST_VERIFYING_KEY" ] && [ -f "$VKEY" ] && \
   [ -f "$DECRYPTION_RUST_PROVING_KEY" ] && [ -f "$DECRYPTION_RUST_VERIFYING_KEY" ] && [ -f "$DECRYPTION_VKEY" ] && \
   [ -f "$SETUP_META_FILE" ] && [ -f "$DECRYPTION_SETUP_META_FILE" ]; then
  SAVED_TALLY_R1CS_SHA256="$(awk -F= '/^R1CS_SHA256=/{print $2; exit}' "$SETUP_META_FILE")"
  SAVED_DEC_R1CS_SHA256="$(awk -F= '/^R1CS_SHA256=/{print $2; exit}' "$DECRYPTION_SETUP_META_FILE")"
  if [ "$SAVED_TALLY_R1CS_SHA256" = "$TALLY_R1CS_SHA256" ] && [ "$SAVED_DEC_R1CS_SHA256" = "$DEC_R1CS_SHA256" ]; then
    echo "Existing Rust proving/verifying keys match current circuits. Skipping regeneration."
    exit 0
  fi
fi

run_checked "$RUST_BACKEND_BIN" setup \
  --wasm "$WASM" \
  --r1cs "$R1CS" \
  --proving-key-out "$RUST_PROVING_KEY" \
  --verifying-key-out "$RUST_VERIFYING_KEY" \
  --vkey-json-out "$VKEY"

run_checked "$RUST_BACKEND_BIN" setup \
  --wasm "$DECRYPTION_WASM" \
  --r1cs "$DECRYPTION_R1CS" \
  --proving-key-out "$DECRYPTION_RUST_PROVING_KEY" \
  --verifying-key-out "$DECRYPTION_RUST_VERIFYING_KEY" \
  --vkey-json-out "$DECRYPTION_VKEY"

cat > "$SETUP_META_FILE" <<EOF
BACKEND=rust
R1CS_SHA256=$TALLY_R1CS_SHA256
VKEY_SHA256=$(sha256_file "$VKEY")
GENERATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

cat > "$DECRYPTION_SETUP_META_FILE" <<EOF
BACKEND=rust
R1CS_SHA256=$DEC_R1CS_SHA256
VKEY_SHA256=$(sha256_file "$DECRYPTION_VKEY")
GENERATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "Rust setup complete."
