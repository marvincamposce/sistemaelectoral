# BU‑PVP‑1 — Especificación del Protocolo Electoral (v1)

**Estado**: Adoptado (baseline de investigación)

## 1. Propósito

BU‑PVP‑1 define un proceso electoral de referencia con:

- voto secreto (contenido no observable públicamente),
- escrutinio verificable públicamente (evidencia verificable contra TPE),
- actas digitales firmadas y ancladas (cadena de custodia digital),
- observación electoral pública y auditoría independiente reproducible.

## 2. Actores (modelo institucional)

- AEA: Autoridad Electoral Abstracta
- REA: Registro Electoral Abstracto
- MRD: Mesa Receptora Digital (relayer)
- JED: Junta de Escrutinio Digital (coordinator)
- Observador
- Auditor independiente

## 3. Artefactos y evidencias

- **Manifiesto Electoral** (JSON canónico): define candidaturas, calendario, parámetros.
- **Actas Digitales (snapshots)**: Apertura, Cierre, Escrutinio, Resultados.
- **Anchors on-chain**: hashes de actas, commitments de procesamiento/tally, estado de fases.

## 4. Fases y máquina de estados

Estados:

- SETUP
- REGISTRY_OPEN
- REGISTRY_CLOSED
- VOTING_OPEN
- VOTING_CLOSED
- PROCESSING
- TALLYING
- RESULTS_PUBLISHED
- AUDIT_WINDOW
- ARCHIVED

Transiciones solo mediante eventos on-chain. Cada transición crítica produce acta correspondiente cuando aplica.

## 5. Elegibilidad y registro de participación

### 5.1 Credencial de registro

- SC: secreto aleatorio entregado al elector.
- N = H(SC): nullificador de registro.
- permit = Sign_REA(electionId, N, expiry, policyVersion).

### 5.2 Registro (signup)

El elector consume `permit` para registrar su clave pública de voto (VotingPubKey). El contrato verifica:

- firma de REA,
- unicidad del nullificador (no reuso),
- fase adecuada.

## 6. Emisión de boletas

La boleta es un mensaje cifrado para `CoordinatorPubKey`, firmado con la clave de voto del elector. Se publica en el TPE (eventos).

## 7. Escrutinio verificable

La JED procesa mensajes y publica pruebas verificables. El contrato verifica y ancla commitments del resultado.

## 8. Actas digitales y cadena de custodia

Formato: JSON canónico (JCS) + hash SHA-256 + firma Ed25519 + hash anclado on-chain.

## 9. Verificación pública

Un observador verifica:

- manifestHash y parámetros,
- integridad temporal del proceso (fases y eventos),
- verificación on-chain de pruebas,
- consistencia entre actas y anchors.
