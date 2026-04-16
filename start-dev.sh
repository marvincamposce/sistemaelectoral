#!/usr/bin/env bash
# Quickstart script para levantar el ecosistema completo de BlockUrna en desarrollo.
# Arranca DB, Hardhat, compila/despliega contratos y lanza todos los microservicios y frontends mediante turbo.

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

echo "▶ 1. Liberando puertos locales ocupados por sesiones previas..."
pnpm dlx kill-port 3000 3005 3011 3013 3020 8002 8545 >/dev/null 2>&1 || true

echo "▶ 2. Iniciando PostgreSQL (Docker)..."
# Apuntamos correctamente la ruta al archivo docker-compose en la carpeta infra
docker compose -f infra/compose/docker-compose.yml up -d postgres 2>/dev/null || docker-compose -f infra/compose/docker-compose.yml up -d postgres

echo "▶ 3. Iniciando nodo Hardhat local..."
pnpm -F @blockurna/contracts run node > .hardhat-node.log 2>&1 &
HARDHAT_PID=$!
echo "  [!] Esperando 5 segundos para que la red se estabilice..."
sleep 5

echo "▶ 4. Compilando y Desplegando Contratos..."
pnpm build
pnpm -F @blockurna/contracts deploy:localhost

echo "▶ 5. Levantando ecosistema completo (Evidence API, Indexer y Frontends)..."
echo "  [!] Abriendo tu navegador en 10 segundos..."
# Usamos 'force-color' para no perder estilos al correr a través de turbo
FORCE_COLOR=1 pnpm dev &
TURBO_PID=$!

sleep 10
echo "▶ 6. Lanzando Portales en el Navegador..."
open_browser "http://localhost:3013" # Authority Console
open_browser "http://localhost:3000" # Voter Portal
open_browser "http://localhost:3005" # Tally Board
open_browser "http://localhost:3011" # Observer Portal

echo "  [!] Todo el ecosistema está en línea. Logs unificados sirviéndose."
echo "  [!] Presiona Ctrl+C en esta terminal para apagar el sistema de forma segura."
wait $TURBO_PID

