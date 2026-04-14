# ADR-0008: Estrategia del Audit CLI

## Estado

Adoptado

## Contexto

La auditoría post-electoral debe ser reproducible e independiente de API/DB.

## Decisión

Audit CLI:

- valida firma/hashes de actas,
- consulta anchors on-chain vía RPC,
- compara consistencia determinísticamente,
- genera reporte con hash reproducible.

## Consecuencias

- Auditorías comparables por terceros.
- Requiere especificación estable del formato de actas.
