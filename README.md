# BlockUrna — Sistema Electoral de Referencia (BU‑PVP‑1)

BlockUrna es un **prototipo de referencia** y una **investigación aplicada** sobre voto electrónico verificable.

- Protocolo electoral: **BU‑PVP‑1** (voto secreto + escrutinio verificable públicamente).
- Fuente de verdad: **Tablero Público de Evidencias (TPE)** on-chain.
- Evidencia formal: **actas digitales (snapshots) firmadas y ancladas**.
- Observación electoral: **observer portal** con verificación determinista y alertas.

No es apto para elecciones públicas vinculantes ni despliegues gubernamentales reales.

## Repo

Este repositorio es un monorepo (pnpm + turborepo):

```text
apps/        # portales y servicios
packages/    # contratos, crypto, SDK, tipos compartidos
docs/        # documento académico + ADRs + protocolo
infra/       # docker compose local
legacy/      # implementación anterior preservada
```

## Requisitos

- Node.js >= 20
- pnpm (vía Corepack recomendado)

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm -v
```

## Comandos

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

## Demo local (contrato + acta)

1) Levanta un nodo local (Hardhat):

```bash
pnpm --filter @blockurna/contracts node
```

Nota: el endpoint `http://127.0.0.1:8545` es **JSON-RPC (POST)**. Si lo abres en el navegador (GET) puede responder con “Parse error”; es normal.

2) En otra terminal, despliega + crea una elección + ancla un acta de apertura:

```bash
pnpm --filter @blockurna/contracts demo:localhost
```

El comando imprime la dirección del contrato y la ruta del acta firmada (JSON).

3) Verifica el acta localmente y contra el anclaje on-chain:

```bash
pnpm --filter @blockurna/audit-cli build
node apps/audit-cli/dist/cli.js verify-acta --file packages/contracts/demo-output/acta_apertura.signed.json --rpc http://127.0.0.1:8545 --contract <ADDRESS> --election 0
```

Nota: el acta demo se escribe en `packages/contracts/demo-output/` (evita romper `hardhat compile`).

4) Observer portal (configura env vars y corre dev):

- Ejemplo de env: [apps/observer-portal/.env.example](apps/observer-portal/.env.example)

```bash
pnpm --filter @blockurna/observer-portal dev
```

## Observación sin RPC directo (Postgres)

Este modo desacopla el portal del RPC: un indexer consume el RPC y persiste evidencias en Postgres, y una API sirve esas evidencias al portal.

1) Levanta Postgres:

```bash
docker compose -f infra/compose/docker-compose.yml up -d
```

2) Levanta un nodo local y crea evidencias demo:

```bash
pnpm --filter @blockurna/contracts node
pnpm --filter @blockurna/contracts demo:localhost
```

3) Configura y corre el indexer:

- Ejemplo de env: [apps/evidence-indexer/.env.example](apps/evidence-indexer/.env.example)
- Define `ELECTION_REGISTRY_ADDRESS` con el `registryAddress` que imprime el deploy/demo.

```bash
pnpm --filter @blockurna/evidence-indexer dev
```

4) Configura y corre la API:

- Ejemplo de env: [apps/evidence-api/.env.example](apps/evidence-api/.env.example)
- Define `ELECTION_REGISTRY_ADDRESS` y `CHAIN_ID` (en localhost suele ser `31337`).

```bash
pnpm --filter @blockurna/evidence-api dev
```

La API escucha en `http://127.0.0.1:3020` y expone:

- `GET /` (info)
- `GET /healthz`
- `GET /v1/elections`

5) Configura el portal para usar la API:

- Ejemplo de env: [apps/observer-portal/.env.example](apps/observer-portal/.env.example)

```bash
pnpm --filter @blockurna/observer-portal dev
```

## Documentación

- Documento académico base: `docs/thesis/BlockUrna_Base.md`
- Protocolo: `docs/protocol/BU-PVP-1.md`
- ADRs: `docs/adr/`
