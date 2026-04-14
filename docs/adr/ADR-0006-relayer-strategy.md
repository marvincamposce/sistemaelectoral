# ADR-0006: Estrategia de Mesas Receptoras Digitales (MRD/relayers)

## Estado

Adoptado

## Contexto

La publicación de boletas requiere UX razonable y mitigación parcial de metadatos.

## Decisión

- MRD publica transacciones (signup/vote) y entrega recibos.
- Múltiples MRD para evitar punto único.
- Rate limiting y observabilidad.

## Consecuencias

- Riesgo residual de censura/retardo.
- Se detecta con recibos y métricas; se mitiga con redundancia.
