# BlockUrna — Sistema de Votación en Blockchain

Este repositorio contiene el **Proyecto 2: Sistema de Votación en Blockchain**.

## Estructura

- `landing/` — Landing page del proyecto (Next.js)
- `BlockUrna/contracts/` — Smart contracts + tests + deploy (Hardhat + Solidity)
- `BlockUrna/web/` — dApp del sistema de votación (Next.js + ethers)

## Requisitos cubiertos

- Landing page del proyecto ✅ (`landing/`)
- Sistema funcional de votación ✅ (`BlockUrna/web/`)
- Implementación en blockchain (smart contracts) ✅ (`BlockUrna/contracts/`)
- Mínimo 3 partidos ✅ (se despliega con 3 partidos por defecto)
- Registro y conteo transparente ✅ (estado y eventos on-chain)

## Demo local (recomendado para clase)

### 1) Levantar blockchain local

En una terminal:

```bash
cd BlockUrna/contracts
npm install
npm run node
```

Esto inicia JSON-RPC en `http://127.0.0.1:8545` con **cuentas de prueba**.

### 2) Desplegar el contrato y exportar ABI/dirección a la dApp

En otra terminal:

```bash
cd BlockUrna/contracts
npm run deploy:localhost
```

Esto genera/actualiza el archivo:

- `BlockUrna/web/src/contracts/BlockUrnaElection.json`

### 3) Ejecutar la dApp

En otra terminal:

```bash
cd BlockUrna/web
npm install
npm run dev -- -p 3001
```

Abrir: `http://localhost:3001`

### 4) Ejecutar la landing

En otra terminal:

```bash
cd landing
npm install
npm run dev
```

Abrir: `http://localhost:3000`

La landing tiene un botón para ir a la dApp (por defecto apunta a `http://localhost:3001`).

## MetaMask (para demo local)

1. Agrega una red en MetaMask:
   - **RPC URL**: `http://127.0.0.1:8545`
   - **Chain ID**: `31337`
2. Importa 2–3 cuentas usando las private keys que imprime `npm run node`.
   - La cuenta #0 (primer private key) es el **admin/owner** (la que desplegó el contrato).

> Estas llaves son públicas y solo sirven para demo local.

## Flujo del sistema

- **Admin**
  - Abre registro → aprueba/rechaza solicitudes → abre votación → cierra votación.
- **Votante**
  - Solicita registro (auto-registro) → espera aprobación → vota (1 vez).
- **Transparencia**
  - Conteo por partido se consulta on-chain.
  - Eventos on-chain: solicitudes, aprobaciones/rechazos, votos y cambios de fase.

## Tests (smart contract)

```bash
cd BlockUrna/contracts
npm test
```

## Deploy opcional a Sepolia

1. Crea un archivo `BlockUrna/contracts/.env` basado en `.env.example`:

```bash
cd BlockUrna/contracts
cp .env.example .env
```

2. Completa:

- `SEPOLIA_RPC_URL`
- `SEPOLIA_PRIVATE_KEY`

3. Despliega:

```bash
cd BlockUrna/contracts
npm run deploy:sepolia
```

Esto también exporta ABI/dirección a la dApp.

## Notas de seguridad (MVP)

- Este MVP prioriza **transparencia**; el evento `VoteCast` hace que el voto sea trazable por dirección.
- Si se requiere **anonimato**, habría que implementar otro esquema (p. ej. commit-reveal o ZK), lo cual aumenta complejidad.

## Guía de demo

Ver `docs/DEMO.md`.
