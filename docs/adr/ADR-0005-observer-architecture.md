# ADR-0005: Arquitectura del Observer Portal

## Estado

Adoptado

## Contexto

La observación electoral requiere verificaciones deterministas y alertas públicas basadas en evidencia.

## Decisión

Observer Portal funciona como verificador:

- consume anchors on-chain,
- valida firmas/hashes de actas,
- compara contra proyecciones del indexer,
- emite alertas ante inconsistencias.

## Consecuencias

- La UI no es fuente de verdad.
- Las discrepancias quedan explícitas y rastreables.
