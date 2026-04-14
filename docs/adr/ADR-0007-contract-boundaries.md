# ADR-0007: Fronteras contractuales y evidencia on-chain

## Estado

Adoptado

## Contexto

Se requiere minimizar PII y no publicar votos en claro, preservando evidencia verificable.

## Decisión

Los contratos:

- anclan parámetros, fases y hashes de actas,
- registran boletas cifradas como eventos,
- verifican proofs de escrutinio (cuando aplique),
- no almacenan PII ni selección en claro.

## Consecuencias

- Menor exposición de datos sensibles.
- Dependencia fuerte en correctitud de verificadores.
