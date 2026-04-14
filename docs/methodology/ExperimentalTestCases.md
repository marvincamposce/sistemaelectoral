# Casos de Prueba Experimentales (BU‑PVP‑1)

Este documento define los escenarios experimentales nominales y adversariales a ejecutar durante la validación.

## A. Flujo nominal completo

- Setup → registry open → signup → voting open → publish ballots → close → processing → tally → results → audit.
- Métricas: latencias p50/p95, reproducibilidad de auditoría.

## B. Reuso de credencial (doble registro)

- Intento de signup con nullificador ya consumido.
- Resultado esperado: rechazo determinista y evidencia pública del intento.

## C. Voto actualizado

- Un elector publica dos boletas con nonces crecientes.
- Resultado esperado: solo el último voto válido cuenta.

## D. Censura/retardo de MRD

- MRD no publica una boleta durante X tiempo.
- Resultado esperado: recibo detecta no inclusión; fallback; observer alerta degradación.

## E. Retraso de escrutinio

- JED no publica pruebas a tiempo.
- Resultado esperado: estado público “pending”; incidente documentado; no se publican resultados “oficiales” sin verificación.

## F. Manipulación de acta

- API sirve un snapshot alterado.
- Resultado esperado: falla verificación de hash/firma; alerta inmediata.
