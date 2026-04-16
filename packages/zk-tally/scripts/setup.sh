#!/usr/bin/env bash
# Groth16 Trusted Setup for TallyVerifier circuit
# Usage: bash scripts/setup.sh
#
# This performs a LOCAL Powers of Tau ceremony (Phase 1) and a
# circuit-specific setup (Phase 2). For production, Phase 1 would
# come from a community MPC ceremony (e.g., Hermez or Zcash).

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: This script requires bash. Run: bash scripts/setup.sh"
  exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PKG_DIR/build"
KEYS_DIR="$PKG_DIR/keys"
SETUP_META_FILE="$KEYS_DIR/tally_verifier_setup.meta"
DECRYPTION_SETUP_META_FILE="$KEYS_DIR/decryption_verifier_setup.meta"

mkdir -p "$KEYS_DIR"

HEARTBEAT_SECONDS="${HEARTBEAT_SECONDS:-15}"
SETUP_LOG_FILE="${SETUP_LOG_FILE:-$KEYS_DIR/setup-$(date +%Y%m%d-%H%M%S).log}"
SETUP_BACKEND="${SETUP_BACKEND:-rust}"

touch "$SETUP_LOG_FILE"
exec > >(tee -a "$SETUP_LOG_FILE") 2>&1

echo "Setup log: $SETUP_LOG_FILE"
echo "Heartbeat: every ${HEARTBEAT_SECONDS}s"
echo "Live metrics: cpu%, rss_kb, output_size"
echo "Backend: $SETUP_BACKEND"

sha256_file() {
  local file_path="$1"
  sha256sum "$file_path" | awk '{print $1}'
}

describe_output_size() {
  local output_path="$1"

  if [ "$output_path" = "-" ]; then
    echo "n/a"
    return
  fi

  if [ -f "$output_path" ]; then
    du -h "$output_path" 2>/dev/null | awk '{print $1}'
  else
    echo "creating"
  fi
}

collect_proc_metrics() {
  local root_pid="$1"

  ps -eo pid,ppid,%cpu,rss --no-headers 2>/dev/null | \
    awk -v root="$root_pid" '
      {
        pid = $1;
        ppid = $2;
        cpu_of[pid] = $3;
        rss_of[pid] = $4;
        children[ppid] = children[ppid] " " pid;
      }
      END {
        head = 1;
        tail = 1;
        queue[1] = root;

        total_cpu = 0;
        total_rss = 0;

        while (head <= tail) {
          current = queue[head++];
          if (seen[current]) {
            continue;
          }
          seen[current] = 1;

          if (cpu_of[current] != "") {
            total_cpu += cpu_of[current];
            total_rss += rss_of[current];
          }

          count = split(children[current], kid_list, " ");
          for (i = 1; i <= count; i++) {
            if (kid_list[i] != "") {
              queue[++tail] = kid_list[i];
            }
          }
        }

        if (total_cpu == 0 && total_rss == 0) {
          print "0.0 0";
        } else {
          printf "%.1f %d\n", total_cpu, total_rss;
        }
      }
    '
}

run_with_heartbeat() {
  local label="$1"
  local output_path="$2"
  shift 2

  "$@" &
  local cmd_pid=$!
  local started_at=$SECONDS

  while kill -0 "$cmd_pid" 2>/dev/null; do
    local elapsed=$((SECONDS - started_at))
    local mm=$((elapsed / 60))
    local ss=$((elapsed % 60))
    local metrics
    metrics="$(collect_proc_metrics "$cmd_pid")"
    local cpu
    local rss
    read -r cpu rss <<< "$metrics"
    local out_size
    out_size="$(describe_output_size "$output_path")"
    printf "       [%02dm:%02ds] running: %s (pid=%s, cpu=%s%%, rss_kb=%s, out=%s)\n" \
      "$mm" "$ss" "$label" "$cmd_pid" "$cpu" "$rss" "$out_size"
    sleep "$HEARTBEAT_SECONDS"
  done

  wait "$cmd_pid"
}

R1CS="$BUILD_DIR/tally_verifier.r1cs"
if [ ! -f "$R1CS" ]; then
  echo "ERROR: r1cs not found. Run 'bash scripts/compile.sh' first."
  exit 1
fi

R1CS_CONSTRAINTS="$(npx snarkjs r1cs info "$R1CS" | awk -F: '/# of Constraints/{gsub(/ /, "", $NF); print $NF; exit}')"
if [ -z "$R1CS_CONSTRAINTS" ]; then
  echo "ERROR: could not determine constraint count from r1cs info."
  exit 1
fi

if [ "$SETUP_BACKEND" = "rust" ]; then
  WASM="$BUILD_DIR/tally_verifier_js/tally_verifier.wasm"
  DECRYPTION_WASM="$BUILD_DIR/decryption_verifier_js/decryption_verifier.wasm"
  if [ ! -f "$WASM" ]; then
    echo "ERROR: wasm not found. Run 'bash scripts/compile.sh' first."
    exit 1
  fi

  DECRYPTION_R1CS="$BUILD_DIR/decryption_verifier.r1cs"
  if [ ! -f "$DECRYPTION_R1CS" ]; then
    echo "ERROR: decryption r1cs not found. Run 'bash scripts/compile.sh' first."
    exit 1
  fi

  if [ ! -f "$DECRYPTION_WASM" ]; then
    echo "ERROR: decryption wasm not found. Run 'bash scripts/compile.sh' first."
    exit 1
  fi

  RUST_BACKEND_DIR="$PKG_DIR/rust-backend"
  RUST_BACKEND_CARGO="$RUST_BACKEND_DIR/Cargo.toml"
  RUST_BACKEND_BIN="$RUST_BACKEND_DIR/target/release/zk_tally_rs"
  RUST_PROVING_KEY="$KEYS_DIR/tally_verifier_rust.pk.bin"
  RUST_VERIFYING_KEY="$KEYS_DIR/tally_verifier_rust.vk.bin"
  VKEY="$KEYS_DIR/verification_key.json"

  DECRYPTION_RUST_PROVING_KEY="$KEYS_DIR/decryption_verifier_rust.pk.bin"
  DECRYPTION_RUST_VERIFYING_KEY="$KEYS_DIR/decryption_verifier_rust.vk.bin"
  DECRYPTION_VKEY="$KEYS_DIR/verification_key_decryption.json"
  EXPORT_SOLIDITY_VERIFIER="${EXPORT_SOLIDITY_VERIFIER:-1}"
  SOLIDITY_VERIFIER_CONTRACT_NAME="${SOLIDITY_VERIFIER_CONTRACT_NAME:-Groth16Verifier}"
  SOLIDITY_VERIFIER_OUT="${SOLIDITY_VERIFIER_OUT:-$PKG_DIR/../contracts/contracts/Groth16Verifier.sol}"

  export_solidity_verifier_with_rust_backend() {
    if [ "$EXPORT_SOLIDITY_VERIFIER" != "1" ]; then
      echo ""
      echo "=== Skipping Solidity verifier export (EXPORT_SOLIDITY_VERIFIER=$EXPORT_SOLIDITY_VERIFIER) ==="
      return
    fi

    if [ ! -x "$RUST_BACKEND_BIN" ] || ! "$RUST_BACKEND_BIN" --help 2>/dev/null | grep -q "export-solidity-verifier"; then
      echo ""
      echo "=== Rebuilding Rust backend for Solidity verifier export ==="
      run_with_heartbeat "cargo build --release (rust backend)" "$RUST_BACKEND_BIN" \
        cargo build --release --manifest-path "$RUST_BACKEND_CARGO"
    fi

    echo ""
    echo "=== Exporting Solidity Verifier (Rust Backend) ==="
    run_with_heartbeat "rust export-solidity-verifier" "$SOLIDITY_VERIFIER_OUT" \
      "$RUST_BACKEND_BIN" export-solidity-verifier \
        --verifying-key "$RUST_VERIFYING_KEY" \
        --output "$SOLIDITY_VERIFIER_OUT" \
        --contract-name "$SOLIDITY_VERIFIER_CONTRACT_NAME"

    echo "  Solidity verifier: $SOLIDITY_VERIFIER_OUT"
  }

  if [ ! -f "$RUST_BACKEND_CARGO" ]; then
    echo "ERROR: rust backend not found at $RUST_BACKEND_CARGO"
    exit 1
  fi

  R1CS_SHA256="$(sha256_file "$R1CS")"
  DECRYPTION_R1CS_SHA256="$(sha256_file "$DECRYPTION_R1CS")"

  if [ "${FORCE_PHASE2_REBUILD:-0}" != "1" ] && [ -f "$RUST_PROVING_KEY" ] && [ -f "$RUST_VERIFYING_KEY" ] && [ -f "$VKEY" ] && [ -f "$DECRYPTION_RUST_PROVING_KEY" ] && [ -f "$DECRYPTION_RUST_VERIFYING_KEY" ] && [ -f "$DECRYPTION_VKEY" ] && [ -f "$SETUP_META_FILE" ] && [ -f "$DECRYPTION_SETUP_META_FILE" ]; then
    SAVED_BACKEND="$(awk -F= '/^BACKEND=/{print $2; exit}' "$SETUP_META_FILE")"
    SAVED_R1CS_SHA256="$(awk -F= '/^R1CS_SHA256=/{print $2; exit}' "$SETUP_META_FILE")"

    SAVED_DEC_BACKEND="$(awk -F= '/^BACKEND=/{print $2; exit}' "$DECRYPTION_SETUP_META_FILE")"
    SAVED_DEC_R1CS_SHA256="$(awk -F= '/^R1CS_SHA256=/{print $2; exit}' "$DECRYPTION_SETUP_META_FILE")"

    if [ "$SAVED_BACKEND" = "rust" ] && [ "$SAVED_R1CS_SHA256" = "$R1CS_SHA256" ] && [ "$SAVED_DEC_BACKEND" = "rust" ] && [ "$SAVED_DEC_R1CS_SHA256" = "$DECRYPTION_R1CS_SHA256" ]; then
      echo ""
      echo "=== Reusing existing Rust Groth16 keys (hash match, both circuits) ==="
      echo "  Proving key:      $RUST_PROVING_KEY"
      echo "  Verification key: $RUST_VERIFYING_KEY"
      echo "  Audit key json:   $VKEY"
      echo "  Decryption pk:    $DECRYPTION_RUST_PROVING_KEY"
      echo "  Decryption vk:    $DECRYPTION_RUST_VERIFYING_KEY"
      echo "  Decryption json:  $DECRYPTION_VKEY"
      echo ""
      echo "Use FORCE_PHASE2_REBUILD=1 to force key regeneration."
      echo "Verification key hash:"
      sha256sum "$VKEY"
      echo "Decryption verification key hash:"
      sha256sum "$DECRYPTION_VKEY"
      export_solidity_verifier_with_rust_backend
      exit 0
    fi

    echo ""
    echo "=== Existing Rust keys do not match current r1cs hash for one or both circuits; regenerating ==="
  fi

  if [ ! -x "$RUST_BACKEND_BIN" ] || [ "${FORCE_RUST_BACKEND_REBUILD:-0}" = "1" ]; then
    echo ""
    echo "=== Building Rust backend ==="
    run_with_heartbeat "cargo build --release (rust backend)" "$RUST_BACKEND_BIN" \
      cargo build --release --manifest-path "$RUST_BACKEND_CARGO"
  fi

  echo ""
  echo "=== Rust Groth16 Setup (tally_verifier) ==="
  run_with_heartbeat "rust setup" "$RUST_PROVING_KEY" \
    "$RUST_BACKEND_BIN" setup \
      --wasm "$WASM" \
      --r1cs "$R1CS" \
      --proving-key-out "$RUST_PROVING_KEY" \
      --verifying-key-out "$RUST_VERIFYING_KEY" \
      --vkey-json-out "$VKEY"

  echo ""
  echo "=== Rust Groth16 Setup (decryption_verifier) ==="
  run_with_heartbeat "rust setup (decryption)" "$DECRYPTION_RUST_PROVING_KEY" \
    "$RUST_BACKEND_BIN" setup \
      --wasm "$DECRYPTION_WASM" \
      --r1cs "$DECRYPTION_R1CS" \
      --proving-key-out "$DECRYPTION_RUST_PROVING_KEY" \
      --verifying-key-out "$DECRYPTION_RUST_VERIFYING_KEY" \
      --vkey-json-out "$DECRYPTION_VKEY"

  cat > "$SETUP_META_FILE" <<EOF
BACKEND=rust
R1CS_SHA256=$R1CS_SHA256
VKEY_SHA256=$(sha256_file "$VKEY")
GENERATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

  cat > "$DECRYPTION_SETUP_META_FILE" <<EOF
BACKEND=rust
R1CS_SHA256=$DECRYPTION_R1CS_SHA256
VKEY_SHA256=$(sha256_file "$DECRYPTION_VKEY")
GENERATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

  export_solidity_verifier_with_rust_backend

  echo ""
  echo "=== Setup Complete (Rust Backend) ==="
  echo "  Proving key:      $RUST_PROVING_KEY"
  echo "  Verification key: $RUST_VERIFYING_KEY"
  echo "  Audit key json:   $VKEY"
  echo "  Decryption pk:    $DECRYPTION_RUST_PROVING_KEY"
  echo "  Decryption vk:    $DECRYPTION_RUST_VERIFYING_KEY"
  echo "  Decryption json:  $DECRYPTION_VKEY"
  echo ""
  echo "Verification key hash:"
  sha256sum "$VKEY"
  echo "Decryption verification key hash:"
  sha256sum "$DECRYPTION_VKEY"
  exit 0
fi

if [ "$SETUP_BACKEND" != "snarkjs" ]; then
  echo "ERROR: unsupported SETUP_BACKEND='$SETUP_BACKEND'. Use 'rust' or 'snarkjs'."
  exit 1
fi

# --- Phase 1: Powers of Tau ---
# Phase 9B currently has ~201,920 constraints, so 2^18 (262,144) is required.
# Can be overridden when needed, e.g. PTAU_POWER=19 bash scripts/setup.sh
PTAU_POWER="${PTAU_POWER:-18}"
PTAU_CAPACITY=$((1 << PTAU_POWER))

if [ "$R1CS_CONSTRAINTS" -gt "$PTAU_CAPACITY" ]; then
  echo "ERROR: circuit has $R1CS_CONSTRAINTS constraints but PTAU 2^${PTAU_POWER} supports up to $PTAU_CAPACITY."
  echo "Try a larger PTAU_POWER, e.g. PTAU_POWER=19 bash scripts/setup.sh"
  exit 1
fi

echo "Circuit constraints: $R1CS_CONSTRAINTS"
echo "PTAU capacity:       $PTAU_CAPACITY (2^${PTAU_POWER})"

PTAU_FILE="$KEYS_DIR/pot${PTAU_POWER}_0000.ptau"
PTAU_FINAL="$KEYS_DIR/pot${PTAU_POWER}_final.ptau"

if [ ! -f "$PTAU_FINAL" ]; then
  echo "=== Phase 1: Powers of Tau (2^${PTAU_POWER}) ==="

  echo "  [1/4] Starting new Powers of Tau ceremony..."
  run_with_heartbeat "powersoftau new" "$PTAU_FILE" \
    npx snarkjs powersoftau new bn128 "$PTAU_POWER" "$PTAU_FILE"

  echo "  [2/4] Contributing randomness (local entropy)..."
  echo "       This step can run several minutes with little/no console output."
  run_with_heartbeat "powersoftau contribute" "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau" \
    npx snarkjs powersoftau contribute "$PTAU_FILE" "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau" \
      --name="BlockUrna Phase9B Local" \
      -e="$(head -c 64 /dev/urandom | xxd -p -c 128)"

  echo "  [3/4] Preparing Phase 2..."
  run_with_heartbeat "powersoftau prepare phase2" "$PTAU_FINAL" \
    npx snarkjs powersoftau prepare phase2 "$KEYS_DIR/pot${PTAU_POWER}_0001.ptau" "$PTAU_FINAL"

  echo "  [4/4] Verifying Powers of Tau..."
  run_with_heartbeat "powersoftau verify" "$PTAU_FINAL" \
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

R1CS_SHA256="$(sha256_file "$R1CS")"
PTAU_SHA256="$(sha256_file "$PTAU_FINAL")"

if [ "${FORCE_PHASE2_REBUILD:-0}" != "1" ] && [ -f "$ZKEY_FINAL" ] && [ -f "$VKEY" ] && [ -f "$SETUP_META_FILE" ]; then
  SAVED_BACKEND="$(awk -F= '/^BACKEND=/{print $2; exit}' "$SETUP_META_FILE")"
  SAVED_R1CS_SHA256="$(awk -F= '/^R1CS_SHA256=/{print $2; exit}' "$SETUP_META_FILE")"
  SAVED_PTAU_SHA256="$(awk -F= '/^PTAU_SHA256=/{print $2; exit}' "$SETUP_META_FILE")"

  if { [ -z "$SAVED_BACKEND" ] || [ "$SAVED_BACKEND" = "snarkjs" ]; } && [ "$SAVED_R1CS_SHA256" = "$R1CS_SHA256" ] && [ "$SAVED_PTAU_SHA256" = "$PTAU_SHA256" ]; then
    echo ""
    echo "=== Reusing existing Groth16 keys (hash match) ==="
    echo "  Proving key:      $ZKEY_FINAL"
    echo "  Verification key: $VKEY"
    echo ""
    echo "Use FORCE_PHASE2_REBUILD=1 to force key regeneration."
    echo "Verification key hash:"
    sha256sum "$VKEY"
    exit 0
  fi

  echo ""
  echo "=== Existing Groth16 keys do not match current r1cs/ptau hashes; regenerating Phase 2 ==="
fi

echo ""
echo "=== Phase 2: Groth16 Circuit Setup ==="

echo "  [1/3] Generating initial zkey..."
run_with_heartbeat "groth16 setup" "$ZKEY_INIT" \
  npx snarkjs groth16 setup "$R1CS" "$PTAU_FINAL" "$ZKEY_INIT"

echo "  [2/3] Contributing circuit-specific randomness..."
run_with_heartbeat "zkey contribute" "$ZKEY_FINAL" \
  npx snarkjs zkey contribute "$ZKEY_INIT" "$ZKEY_FINAL" \
    --name="BlockUrna Phase9B Circuit" \
    -e="$(head -c 64 /dev/urandom | xxd -p -c 128)"

echo "  [3/3] Exporting verification key..."
run_with_heartbeat "zkey export verificationkey" "$VKEY" \
  npx snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY"

# Cleanup
rm -f "$ZKEY_INIT"

cat > "$SETUP_META_FILE" <<EOF
BACKEND=snarkjs
R1CS_SHA256=$R1CS_SHA256
PTAU_SHA256=$PTAU_SHA256
VKEY_SHA256=$(sha256_file "$VKEY")
GENERATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo ""
echo "=== Setup Complete ==="
echo "  Proving key:      $ZKEY_FINAL"
echo "  Verification key: $VKEY"
echo ""
echo "Verification key hash:"
sha256sum "$VKEY"
