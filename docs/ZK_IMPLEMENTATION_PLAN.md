# BlockUrna — Plan de Implementación ZK por Fases

> Documento de transferencia para el asesor de integración ZK.  
> Última actualización: 2026-04-15  
> Protocolo: BU-PVP-1  
> Repositorio: monorepo `blockurna-monorepo` (pnpm + turbo)

---

## Tabla de Contenidos

1. [Contexto del Sistema](#1-contexto-del-sistema)
2. [Estado Actual (Post Fase 9A)](#2-estado-actual-post-fase-9a)
3. [Fase 9A — Completada: Proof de Conteo Correcto](#3-fase-9a--completada-proof-de-conteo-correcto)
4. [Fase 9B — Merkle Inclusion Proof](#4-fase-9b--merkle-inclusion-proof)
5. [Fase 9C — Verificador On-Chain (Solidity)](#5-fase-9c--verificador-on-chain-solidity)
6. [Fase 9D — Proof de Descifrado Correcto](#6-fase-9d--proof-de-descifrado-correcto)
7. [Fase 9E — MPC Trusted Setup y Producción](#7-fase-9e--mpc-trusted-setup-y-producción)
8. [Mapa de Archivos Clave](#8-mapa-de-archivos-clave)
9. [Dependencias y Herramientas](#9-dependencias-y-herramientas)
10. [Esquema de Datos ZK](#10-esquema-de-datos-zk)
11. [API Contracts](#11-api-contracts)
12. [Reglas No Negociables](#12-reglas-no-negociables)

---

## 1. Contexto del Sistema

BlockUrna es un sistema electoral verificable end-to-end que usa blockchain (Hardhat/EVM local) para anclar evidencia. El flujo electoral completo es:

```
Votante → cifra boleta (X25519 + XChaCha20-Poly1305)
       → publica ciphertext on-chain (ElectionRegistry.sol)
       → indexer persiste en PostgreSQL
       → ceremonia 2-de-3 (Shamir threshold) para reconstruir clave del coordinador
       → descifra boletas → cuenta votos reales
       → genera transcript verificable
       → publica Merkle root + transcript hash on-chain
       → firma acta ECDSA (secp256k1)
       → genera proof ZK (← AQUÍ estamos)
       → publica resultados
```

### Componentes Reales (ya implementados)

| Componente | Cripto | Ubicación |
|---|---|---|
| Cifrado de boletas | X25519 + XChaCha20-Poly1305 | `packages/crypto/src/encryption.ts` |
| Descifrado | Reconstrucción de clave desde shares | `apps/tally-board/src/app/actions.ts` |
| Threshold 2-de-3 | Shamir sobre GF(65521) | `packages/crypto/src/threshold.ts` |
| Merkle tree | Binario con keccak256 | `packages/crypto/src/merkle.ts` |
| Firmas de actas | ECDSA secp256k1 (ethers.js) | `packages/crypto/src/actas.ts` |
| Smart contracts | ElectionRegistry (Solidity) | `packages/contracts/` |
| Commitment on-chain | solidityPacked(merkleRoot, transcriptHash, count) | `apps/tally-board/src/app/actions.ts` |

---

## 2. Estado Actual (Post Fase 9A)

### Qué está probado por ZK

| Propiedad | Status |
|---|---|
| Conteo correcto (sum selections == voteCounts) | ✅ ZK Groth16 off-chain |
| Boletas pertenecen al Merkle tree | ❌ Pendiente (Fase 9B) |
| Descifrado correcto de ciphertexts | ❌ Pendiente (Fase 9D) |
| Verificación on-chain | ❌ Pendiente (Fase 9C) |

### Qué sigue dependiendo del transcript

- Cualquier auditor puede repetir el descifrado con las shares para verificar
- El transcript completo está disponible vía evidence-api
- El commitment on-chain (merkle root + transcript hash) permite verificar integridad

---

## 3. Fase 9A — Completada: Proof de Conteo Correcto

### Stack

```
Circom 2.2.3 + snarkjs 0.7.6 + Groth16 sobre BN-128
```

### Circuito: `TallyVerifier_4x64`

**Ubicación:** `packages/zk-tally/circuits/tally_verifier.circom`

```
Parameters:
  MAX_BALLOTS    = 64
  NUM_CANDIDATES = 4

Public inputs (5 signals):
  voteCounts[4]   — votos publicados por candidato
  totalValid      — total de boletas válidas

Private inputs (64 signals):
  selections[64]  — selección por boleta (0-3=candidato, 4=inválida/unused)

Constraints (2,240 total):
  1. RangeCheck: selections[i] ∈ {0,1,2,3,4}
  2. Conteo:     ∑(selections[i]==j) == voteCounts[j]  ∀j
  3. Validez:    ∑(selections[i]<4) == totalValid
```

### Rendimiento medido

| Operación | Tiempo |
|---|---|
| Prove (fullProve) | ~350ms |
| Verify (off-chain) | ~13ms |

### Templates del circuito

- `IsEqual()` — comparación a(==)b usando inverso multiplicativo
- `RangeCheck(maxVal)` — `∏(val-k)==0` para k=0..maxVal
- `TallyVerifier(MAX_BALLOTS, NUM_CANDIDATES)` — circuito principal

### Build artifacts (generados, NO en git)

```
packages/zk-tally/
├── build/
│   ├── tally_verifier.r1cs          (288KB, sistema de restricciones)
│   ├── tally_verifier.sym           (114KB, nombres simbólicos)
│   └── tally_verifier_js/
│       ├── tally_verifier.wasm      (46KB, witness calculator)
│       └── witness_calculator.js
├── keys/
│   ├── pot12_final.ptau             (Powers of Tau, 2^12)
│   ├── tally_verifier_final.zkey    (proving key)
│   └── verification_key.json       (verification key, ~2KB)
```

### API TypeScript

**Archivo:** `packages/zk-tally/src/index.ts`

```typescript
// Convertir transcript real → witness del circuito
buildWitnessFromTranscript(transcript, candidateOrder) → TallyWitnessInput

// Generar Groth16 proof
proveTally(input: TallyWitnessInput) → { proof, publicSignals, verificationKeyHash }

// Verificar off-chain
verifyTallyProof(proof, publicSignals) → { valid: boolean }

// Verificar que los artifacts existen
checkArtifacts() → { ok: boolean, missing: string[] }
```

### Integración actual

1. **Tally-board** (`apps/tally-board/src/app/actions.ts`):
   - `generateZkProofAction(electionId, transcript, tallyJobId)`
   - Botón "GENERAR PRUEBA ZK (Groth16)" en la UI
   - Persiste en tabla `zk_proof_jobs`

2. **Evidence API** (`apps/evidence-api/src/index.ts`):
   - `GET /v1/elections/:id/zk-proof` → estado del proof job

3. **Observer Portal** (`apps/observer-portal/src/app/page.tsx`):
   - Sección "Prueba ZK" con badge de estado y notas de honestidad

### Tests (5/5 passing)

```
✔ artifacts exist
✔ witness correcto desde transcript
✔ generar y verificar proof real (348ms prove, 13ms verify)
✔ rechazar proof con signals alterados
✔ manejar boletas inválidas
```

---

## 4. Fase 9B — Merkle Inclusion Proof

### Objetivo
Probar que **cada boleta procesada pertenece al árbol Merkle** cuyo root está publicado on-chain.

### Cambios al circuito

Añadir a `TallyVerifier`:

```
Nuevos public inputs:
  merkleRoot          — raíz del árbol publicada on-chain

Nuevos private inputs:
  ballotHashes[64]    — keccak256(ciphertext[i])
  merkleProofs[64][D] — path de autenticación (D = depth del árbol, ≤ 6 para 64 hojas)
  merklePathIndices[64][D] — dirección (0=izq, 1=der) en cada nivel

Nuevos constraints:
  4. Para cada boleta i:
     MerkleProofVerifier(ballotHashes[i], merkleProofs[i], merklePathIndices[i]) == merkleRoot
```

### Consideraciones técnicas

- **Hash en el circuito**: keccak256 es muy costoso en circuitos (~150K constraints por hash). Opciones:
  - **Opción A**: Usar Poseidon hash (nativo de circuitos, ~200 constraints por hash). Requiere migrar el Merkle tree a Poseidon tanto en `crypto/merkle.ts` como en el contrato.
  - **Opción B**: Usar MiMC hash (compromiso intermedio).
  - **Opción C**: Mantener keccak256 pero aceptar circuito mucho más grande.
  - **Recomendación**: Opción A (Poseidon). circomlib ya tiene [poseidon.circom](https://github.com/iden3/circomlib/blob/master/circuits/poseidon.circom).

- **Impacto en `packages/crypto/src/merkle.ts`**: Hay que crear `deriveBallotMerkleRootPoseidon()` en paralelo al keccak256 actual. El contrato necesitaría un campo adicional para almacenar el Poseidon root.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `packages/zk-tally/circuits/tally_verifier.circom` | Añadir MerkleProofVerifier + Poseidon |
| `packages/crypto/src/merkle.ts` | Añadir `deriveBallotMerkleRootPoseidon()` |
| `packages/zk-tally/src/index.ts` | Generar merkle proofs en el witness |
| `apps/tally-board/src/app/actions.ts` | Pasar merkle proofs al witness builder |

### Dependencias nuevas

```
circomlib  — para poseidon.circom
```

---

## 5. Fase 9C — Verificador On-Chain (Solidity)

### Objetivo
Desplegar un contrato Solidity que verifique la Groth16 proof directamente en la blockchain.

### Pasos

1. **Exportar verificador Solidity**:
   ```bash
   npx snarkjs zkey export solidityverifier keys/tally_verifier_final.zkey Verifier.sol
   ```
   Esto genera un contrato `Groth16Verifier` con función `verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[N] input)`.

2. **Contrato wrapper** `TallyVerifier.sol`:
   ```solidity
   contract TallyVerifier {
     Groth16Verifier immutable verifier;
     
     mapping(uint256 => bool) public electionVerified;
     mapping(uint256 => bytes32) public electionProofHash;
     
     function submitTallyProof(
       uint256 electionId,
       uint[2] calldata a,
       uint[2][2] calldata b,
       uint[2] calldata c,
       uint[5] calldata publicInputs  // voteCounts[4] + totalValid
     ) external {
       require(verifier.verifyProof(a, b, c, publicInputs), "Invalid proof");
       electionVerified[electionId] = true;
       electionProofHash[electionId] = keccak256(abi.encode(a, b, c, publicInputs));
       emit TallyProofVerified(electionId, publicInputs);
     }
   }
   ```

3. **Integrar con `ElectionRegistry`**: Añadir referencia al `TallyVerifier` o hacer que el registro consulte la verificación.

4. **Actualizar `zk_proof_jobs`**: Cambiar status a `VERIFIED_ONCHAIN` con tx hash y verifier address.

### Costos estimados de gas

| Operación | Gas (aprox) |
|---|---|
| Groth16 verify (5 public inputs) | ~230,000 |
| Storage + event | ~50,000 |
| **Total** | **~280,000** |

### Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| `packages/contracts/contracts/TallyVerifier.sol` | [NEW] Wrapper de verificación |
| `packages/contracts/contracts/Groth16Verifier.sol` | [NEW] Generado por snarkjs |
| `packages/zk-tally/scripts/export-verifier.sh` | [NEW] Script de exportación |
| `apps/tally-board/src/app/actions.ts` | Añadir `submitOnchainProofAction()` |
| `apps/evidence-api/src/index.ts` | Actualizar endpoint zk-proof |
| `apps/observer-portal/src/app/page.tsx` | Mostrar tx de verificación on-chain |

---

## 6. Fase 9D — Proof de Descifrado Correcto

### Objetivo
Probar en ZK que **el descifrado de cada ciphertext produce la selección declarada**, sin revelar la clave privada del coordinador.

### Complejidad

**Este es el componente más difícil** del sistema ZK completo. X25519 + XChaCha20-Poly1305 no son friendly para circuitos aritméticos:

- X25519 (Curve25519): require aritmética de campo grande (~25,500 constrs por multiplicación escalar)
- XChaCha20: operaciones de bit rotation y XOR (caras en R1CS)
- Poly1305: MAC con multiplicación modular

### Opciones

| Opción | Complejidad | Viabilidad |
|---|---|---|
| A. Circuito nativo Circom para X25519+XChaCha20 | Muy alta (~1M+ constraints) | Posible pero lento |
| B. Cambiar esquema de cifrado a uno ZK-friendly (Poseidon-based) | Media | Requiere migrar cifrado |
| C. Usar recursive SNARKs/folding (Nova) | Alta | Más escalable |
| D. Proof híbrida: probar descifrado off-chain + commitments | Baja | Pragmática |

### Recomendación

**Opción D primero, luego migrar a B**:
1. En el corto plazo: hacer un commitment del plaintext (hash del decrypted ballot) y probar que el hash del plaintext corresponde a la selección declarada. Esto no prueba descifrado correcto pero sí vincula el plaintext con los votos.
2. En el mediano plazo: migrar el cifrado a un esquema ZK-friendly (ElGamal sobre BN254 + Poseidon hash).

---

## 7. Fase 9E — MPC Trusted Setup y Producción

### Objetivo
Reemplazar el trusted setup local por una ceremonia MPC que garantice que nadie tiene el trapdoor.

### Pasos

1. **Phase 1 (Powers of Tau)**: Reutilizar la ceremonia de Hermez (Polygon) que tiene 76 contribuciones.
   ```bash
   # Descargar ptau público de Hermez
   wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau
   ```

2. **Phase 2 (Circuit-specific)**: Organizar ceremonia con múltiples participantes:
   ```bash
   # Participante 1
   snarkjs zkey contribute circuit_0000.zkey circuit_0001.zkey --name="Participant 1" -e="entropy"
   # Participante 2
   snarkjs zkey contribute circuit_0001.zkey circuit_0002.zkey --name="Participant 2" -e="entropy"
   # Verificar toda la cadena
   snarkjs zkey verify circuit.r1cs ptau_final.ptau circuit_000N.zkey
   ```

3. **Aplicar random beacon**: Usar hash de un bloque de Bitcoin futuro como entropía final.

4. **Publicar**: Verification key, contribution hashes, y transcripts de la ceremonia.

### Escalar el circuito

Para producción se necesita:
- `MAX_BALLOTS = 1024` o más (parametrizable en compilación)
- `NUM_CANDIDATES = 16` o más
- Evaluar si se necesita proof recursiva (un proof por batch de 64 + un proof que verifica N batch proofs)

---

## 8. Mapa de Archivos Clave

```
blockurna-monorepo/
├── packages/
│   ├── crypto/src/
│   │   ├── encryption.ts       # Cifrado X25519+XChaCha20
│   │   ├── merkle.ts           # Merkle tree (keccak256)
│   │   ├── threshold.ts        # Shamir 2-of-3
│   │   ├── actas.ts            # Firma ECDSA de actas
│   │   └── index.ts            # Re-exports
│   │
│   ├── zk-tally/               # ← PAQUETE ZK (Fase 9A)
│   │   ├── circuits/
│   │   │   └── tally_verifier.circom    # Circuito principal
│   │   ├── scripts/
│   │   │   ├── compile.sh               # circom → r1cs + wasm
│   │   │   └── setup.sh                 # ptau + zkey
│   │   ├── src/
│   │   │   ├── index.ts                 # API: prove, verify, buildWitness
│   │   │   ├── snarkjs.d.ts             # Type declarations
│   │   │   └── test/tally.test.ts       # Tests E2E
│   │   ├── build/                       # (generado) r1cs, wasm
│   │   ├── keys/                        # (generado) ptau, zkey, vkey
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── contracts/              # Smart contracts (Hardhat)
│   │   └── contracts/
│   │       └── ElectionRegistry.sol
│   │
│   ├── sdk/                    # ABI + helpers
│   └── shared/                 # Zod schemas, tipos compartidos
│
├── apps/
│   ├── tally-board/            # Consola JED de escrutinio
│   │   └── src/app/
│   │       ├── actions.ts      # Server actions (contiene generateZkProofAction)
│   │       └── tally/[electionId]/page.tsx  # UI
│   │
│   ├── evidence-api/           # API REST (Fastify)
│   │   └── src/
│   │       ├── index.ts        # Endpoints (incluye /zk-proof)
│   │       └── db.ts           # Schema SQL (incluye zk_proof_jobs)
│   │
│   ├── evidence-indexer/       # Escanea blockchain → DB
│   ├── observer-portal/        # Portal público de observación
│   │   └── src/app/page.tsx    # Incluye sección ZK
│   ├── voter-portal/           # Portal de votación
│   ├── authority-console/      # Consola de autoridad electoral
│   └── mrd-api/                # API de Registro y Distribución
```

---

## 9. Dependencias y Herramientas

### Instaladas

| Herramienta | Versión | Propósito |
|---|---|---|
| Circom | 2.2.3 | Compilador de circuitos |
| snarkjs | 0.7.6 | Prover/verifier JavaScript |
| Rust/Cargo | 1.94.1 | Build de circom |
| Node.js | 24.x | Runtime |
| pnpm | 9.15.4 | Package manager |
| Turbo | 2.5.6 | Build orchestrator |

### Para Fase 9B (pendientes)

```bash
# Instalar circomlib para Poseidon
cd packages/zk-tally
pnpm add circomlib
```

### Para Fase 9C (pendientes)

```bash
# El verificador Solidity se genera con snarkjs:
npx snarkjs zkey export solidityverifier keys/tally_verifier_final.zkey contracts/Groth16Verifier.sol
```

---

## 10. Esquema de Datos ZK

### Tabla `zk_proof_jobs` (PostgreSQL)

```sql
CREATE TABLE zk_proof_jobs (
  job_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  election_id BIGINT NOT NULL,
  tally_job_id TEXT,
  proof_system TEXT NOT NULL,        -- 'GROTH16_BN128'
  circuit_id TEXT NOT NULL,          -- 'TallyVerifier_4x64'
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  public_inputs JSONB,              -- { signals: string[], candidateOrder: string[] }
  proof_json JSONB,                 -- Groth16 proof object
  verification_key_hash TEXT,       -- SHA-256 del verification_key.json
  verified_offchain BOOLEAN DEFAULT false,
  verified_onchain BOOLEAN DEFAULT false,
  onchain_verifier_address TEXT,    -- Dirección del contrato verificador
  onchain_verification_tx TEXT,     -- Tx hash de verificación on-chain
  error_message TEXT,
  proving_started_at TIMESTAMPTZ,
  proving_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Estados del proof job

```
NOT_STARTED → BUILDING → PROVED → VERIFIED_OFFCHAIN → VERIFIED_ONCHAIN
                  ↓                       ↓
               FAILED                  FAILED
```

---

## 11. API Contracts

### Evidence API

```
GET /v1/elections/:id/zk-proof
Response: {
  ok: true,
  electionId: "0",
  zkProof: {
    jobId: "uuid",
    proofSystem: "GROTH16_BN128",
    circuitId: "TallyVerifier_4x64",
    status: "VERIFIED_OFFCHAIN",
    publicInputs: { signals: ["3","4","2","1","10"], candidateOrder: [...] },
    verificationKeyHash: "147ee2bb...",
    verifiedOffchain: true,
    verifiedOnchain: false,
    ...
  },
  honesty: {
    whatIsProved: "Vote counts are the correct sum of individual ballot selections",
    whatIsNotProved: [
      "Ballot inclusion in Merkle tree (Phase 9B)",
      "Correct decryption of ciphertexts (requires decryption circuit)",
      "On-chain verification (Phase 9C)"
    ],
    auditabilityNote: "Full transcript remains available for independent off-chain audit"
  }
}
```

### Tally Board (Server Action)

```typescript
// Generar proof
generateZkProofAction(
  electionId: string,
  transcript: {
    summary: Record<string, number>,
    ballots: Array<{ selection: string }>,
    ballotsCount: number,
    decryptedValidCount: number,
    invalidCount: number,
  },
  tallyJobId: string
) → { ok, jobId, status, publicSignals, honesty }
```

---

## 12. Reglas No Negociables

1. **No romper el flujo actual del tally real**. La ZK es una capa adicional, no un reemplazo.
2. **No eliminar el transcript commitment on-chain**. El commitment (merkle root + transcript hash) permanece como fallback.
3. **Lenguaje honesto obligatorio**. Nunca decir "VERIFIED" si solo es off-chain. Usar:
   - `VERIFIED_OFFCHAIN` — snarkjs verificó la proof en Node.js
   - `VERIFIED_ONCHAIN` — un contrato Solidity verificó la proof en la blockchain
4. **Documentar qué se prueba y qué no** en cada fase. El observer portal y la evidence-api siempre exponen `honesty.whatIsNotProved`.
5. **Los build artifacts (r1cs, zkey, wasm, ptau) NO van al repositorio**. Se regeneran con `compile.sh` + `setup.sh`.
6. **Los tests deben pasar antes de merge**: `cd packages/zk-tally && pnpm build && pnpm test`.
7. **El circuito usa parámetros fijos en compilación** (`MAX_BALLOTS=64`, `NUM_CANDIDATES=4`). Se parametrizan en la línea `component main` del .circom.

---

## Cómo empezar

```bash
# 1. Clonar y setup
git clone <repo>
cd blockurna-monorepo
pnpm install

# 2. Asegurar Rust + circom
rustc --version               # 1.94+
~/.cargo/bin/circom --version  # 2.2.3

# 3. Compilar circuito
cd packages/zk-tally
bash scripts/compile.sh

# 4. Trusted setup
bash scripts/setup.sh

# 5. Build + test
pnpm build
pnpm test

# 6. Build completo del monorepo
cd ../..
pnpm build
```

---

## Contacto

- **Fase 9A implementada por**: Equipo de desarrollo BlockUrna
- **Fecha**: 2026-04-15
- **Circuito verificado**: 5/5 tests passing, proof en ~350ms, verificación en ~13ms
