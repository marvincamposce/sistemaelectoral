#!/usr/bin/env bash
# Quickstart script para levantar el ecosistema completo de BlockUrna en desarrollo.
# Arranca DB, Hardhat, compila/despliega contratos y lanza todos los microservicios y frontends mediante turbo.

set -euo pipefail

# Función para limpiar procesos en background al salir
cleanup() {
    echo -e "\n🛑 Deteniendo los servicios..."
    if [ -n "${HARDHAT_PID:-}" ]; then
        kill "$HARDHAT_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Compatibilidad para abrir tabs en Mac o Linux
open_browser() {
  if command -v xdg-open > /dev/null; then
    xdg-open "$1"
  elif command -v open > /dev/null; then
    open "$1"
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [ ! -f "$file" ]; then
    return
  fi

  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

sync_local_env_addresses() {
  local registry_address="$1"
  local tally_verifier_address="${2:-}"

  upsert_env_var "apps/authority-console/.env.local" "ELECTION_REGISTRY_ADDRESS" "$registry_address"
  upsert_env_var "apps/evidence-api/.env" "ELECTION_REGISTRY_ADDRESS" "$registry_address"
  upsert_env_var "apps/evidence-indexer/.env" "ELECTION_REGISTRY_ADDRESS" "$registry_address"
  upsert_env_var "apps/voter-portal/.env.local" "ELECTION_REGISTRY_ADDRESS" "$registry_address"
  upsert_env_var "apps/tally-board/.env.local" "ELECTION_REGISTRY_ADDRESS" "$registry_address"
  upsert_env_var "apps/mrd-relayer/.env" "ELECTION_REGISTRY_ADDRESS" "$registry_address"

  if [ -n "$tally_verifier_address" ]; then
    upsert_env_var "apps/tally-board/.env.local" "TALLY_VERIFIER_ADDRESS" "$tally_verifier_address"
  fi
}

extract_deploy_json() {
  printf '%s\n' "$1" | node -e '
    const fs = require("fs");
    const text = fs.readFileSync(0, "utf8");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      process.exit(1);
    }
    const raw = text.slice(start, end + 1);
    JSON.parse(raw);
    process.stdout.write(raw);
  '
}

extract_deploy_field() {
  local json="$1"
  local field="$2"
  printf '%s\n' "$json" | node -e '
    const fs = require("fs");
    const field = process.argv[1];
    const text = fs.readFileSync(0, "utf8").trim();
    if (!text) {
      process.exit(1);
    }
    const parsed = JSON.parse(text);
    const value = parsed[field];
    if (value === undefined || value === null) {
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "$field"
}

echo "▶ 1. Liberando puertos locales ocupados por sesiones previas..."
CI=1 pnpm dlx kill-port 3000 3004 3005 3011 3012 3013 3020 8002 8545 >/dev/null 2>&1 || true

echo "▶ 2. Iniciando PostgreSQL..."
if command -v docker >/dev/null 2>&1; then
  docker compose -f infra/compose/docker-compose.yml up -d postgres 2>/dev/null || docker-compose -f infra/compose/docker-compose.yml up -d postgres
else
  echo "  [⚠️] Advertencia: Docker no está instalado o no tienes integración WSL."
  echo "  [!] Asegúrate de que PostgreSQL local esté corriendo en puerto 5432 con usuario/db 'blockurna'."
fi

echo "▶ 3. Iniciando nodo Hardhat local..."
pnpm -F @blockurna/contracts run node > .hardhat-node.log 2>&1 &
HARDHAT_PID=$!
echo "  [!] Esperando 5 segundos para que la red se estabilice..."
sleep 5

echo "▶ 4. Compilando y Desplegando Contratos..."
pnpm -F @blockurna/contracts build
DEPLOY_OUTPUT="$(pnpm -F @blockurna/contracts deploy:localhost)"
echo "$DEPLOY_OUTPUT"

DEPLOY_JSON="$(extract_deploy_json "$DEPLOY_OUTPUT")"
REGISTRY_ADDRESS="$(extract_deploy_field "$DEPLOY_JSON" "address")"
TALLY_VERIFIER_ADDRESS="$(extract_deploy_field "$DEPLOY_JSON" "tallyVerifierAddress")"

echo "  [✓] Registry desplegado en: $REGISTRY_ADDRESS"
echo "  [✓] Tally verifier desplegado en: $TALLY_VERIFIER_ADDRESS"
echo "  [!] Sincronizando direcciones en variables locales de las apps..."
sync_local_env_addresses "$REGISTRY_ADDRESS" "$TALLY_VERIFIER_ADDRESS"

echo "▶ 5. Levantando ecosistema completo (Evidence API, Indexer y Frontends)..."
echo "  [!] Abriendo tu navegador en 10 segundos..."
# Usamos 'force-color' para no perder estilos al correr a través de turbo
FORCE_COLOR=1 pnpm dev &
TURBO_PID=$!

sleep 10
echo "▶ 6. Lanzando Portales en el Navegador..."
open_browser "http://localhost:3012" # Authority Console
open_browser "http://localhost:3004" # Voter Portal
open_browser "http://localhost:3005" # Tally Board
open_browser "http://localhost:3011" # Observer Portal

echo "  [!] Todo el ecosistema está en línea. Logs unificados sirviéndose."
echo "  [!] Presiona Ctrl+C en esta terminal para apagar el sistema de forma segura."
wait $TURBO_PID

