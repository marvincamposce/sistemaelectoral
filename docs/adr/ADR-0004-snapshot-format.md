# ADR-0004: Formato de actas digitales (snapshots)

## Estado

Adoptado

## Contexto

La cadena de custodia digital requiere actas verificables y comparables con evidencia on-chain.

## Decisión

- JSON canónico (JCS) para serialización.
- Hash SHA-256 del contenido canónico.
- Firma Ed25519 del hash.
- Hash anclado on-chain.

## Consecuencias

- Auditoría reproducible sin confiar en API/DB.
- Requiere gestión de claves de firma de actas.
