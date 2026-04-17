#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

source "$HOME/.nvm/nvm.sh"
export COREPACK_HOME="$HOME/.cache/node/corepack"
export TMPDIR="/tmp"

cd "$APP_DIR"
"$REPO_ROOT/node_modules/.pnpm/node_modules/.bin/tsx" scripts/zk-smoke-local.ts
