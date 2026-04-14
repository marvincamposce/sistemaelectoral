# BlockUrna — Documento Académico Base (Tesis/Proyecto Aplicado)

**Título provisional**: BlockUrna: Sistema electoral de referencia con voto secreto, escrutinio verificable y cadena de custodia digital (BU‑PVP‑1)

**Resumen**

Este documento establece el marco conceptual, protocolar, arquitectónico y metodológico de BlockUrna, un sistema electoral de referencia diseñado como investigación aplicada. El sistema implementa BU‑PVP‑1, un protocolo de voto secreto con escrutinio verificable públicamente, apoyado en un Tablero Público de Evidencias (blockchain) y una cadena de custodia digital compuesta por actas (snapshots) firmadas y ancladas por hash.

**Nota de alcance (no vinculante)**

BlockUrna no se presenta como apto para elecciones públicas vinculantes ni despliegues gubernamentales reales. No se afirma seguridad total. Se documentan supuestos, exclusiones y riesgo residual.

---

## Índice (estructura expandible)

1. Introducción
2. Pregunta de investigación, hipótesis y objetivos
3. Marco teórico (voto verificable, secreto, coerción, evidencia)
4. Requisitos electorales y modelo institucional abstracto
5. Protocolo BU‑PVP‑1 (especificación)
6. Arquitectura del sistema (TPE, indexación, observación, auditoría)
7. Cadena de custodia digital y actas verificables
8. Modelo de amenazas y supuestos de seguridad
9. Metodología experimental, métricas y validación
10. Resultados (a completar)
11. Discusión, limitaciones y trabajo futuro
12. Conclusiones
Apéndices (ADRs, formatos de actas, runbooks, checklist)

---

## 1. Introducción

### 1.1 Motivación

Describir el problema de confianza en procesos electorales electrónicos y la tensión entre: voto secreto, auditabilidad, verificabilidad pública y escalabilidad.

### 1.2 Contribuciones

- Definición e implementación de BU‑PVP‑1.
- Diseño de un Tablero Público de Evidencias como fuente pública de verificación.
- Diseño de cadena de custodia digital mediante actas firmadas y ancladas.
- Observación electoral pública (observer portal) y auditoría reproducible (audit CLI).

### 1.3 Alcance y exclusiones

Ver `docs/protocol/BU-PVP-1.md` y `docs/security/limits.md` (a completar).

---

## 2. Pregunta de investigación, hipótesis y objetivos

### 2.1 Pregunta de investigación principal

¿Hasta qué punto un protocolo de voto secreto con escrutinio verificable públicamente (BU‑PVP‑1), implementado con un Tablero Público de Evidencias y actas digitales firmadas/ancladas, permite aproximar propiedades clave de un proceso electoral moderno (secreto, integridad, auditabilidad, observación), bajo elegibilidad abstracta y sin identidad civil real?

### 2.2 Hipótesis de trabajo

- H1 (verificabilidad): Un observador independiente puede detectar inconsistencias entre chain, actas y proyecciones si las evidencias se anclan y verifican determinísticamente.
- H2 (secreto): El contenido del voto se preserva frente a observadores públicos, con riesgo residual de metadatos y compromiso de endpoint.
- H3 (integridad del conteo): El tally no puede alterarse sin invalidar pruebas verificadas on-chain (bajo supuestos criptográficos y correctitud).

### 2.3 Objetivo general

Diseñar, especificar, implementar y evaluar un sistema electoral de referencia (BlockUrna) con voto secreto y escrutinio verificable públicamente (BU‑PVP‑1), incorporando observación electoral, auditoría independiente reproducible y cadena de custodia digital.

### 2.4 Objetivos específicos

1) Especificar BU‑PVP‑1 (roles, fases, evidencias, invariantes).
2) Modelar separación estricta entre elegibilidad, emisión, escrutinio y publicación.
3) Implementar TPE on-chain con anclajes y verificación de pruebas.
4) Implementar observer portal con reglas de verificación y alertas.
5) Implementar actas digitales firmadas y ancladas.
6) Implementar audit CLI reproducible (RPC-first).
7) Validar con experimentos nominales y adversariales, midiendo métricas.

---

## 3. Marco teórico (a expandir)

### 3.1 Propiedades deseables

- Secreto del voto (contenido)
- Verificabilidad individual (recibo de inclusión)
- Verificabilidad universal (observación pública)
- Integridad del escrutinio
- Auditabilidad y trazabilidad

### 3.2 Límites conocidos

- Coerción
- Metadatos
- Endpoint compromise
- Identidad civil
- Disponibilidad y gobernanza

---

## 4. Modelo institucional electoral abstracto

Definir actores: Autoridad Electoral Abstracta (AEA), Registro Electoral Abstracto (REA), Mesas Receptoras Digitales (MRD/relayers), Junta de Escrutinio Digital (JED/coordinator), observadores y auditores.

---

## 5. Protocolo BU‑PVP‑1 (resumen)

Referencia principal: `docs/protocol/BU-PVP-1.md`.

---

## 6. Arquitectura del sistema

### 6.1 Tablero Público de Evidencias (TPE)

La blockchain y los smart contracts constituyen el registro público de evidencias: eventos, anclajes de actas, estado de fases y verificación de pruebas.

### 6.2 Indexación y proyecciones

El indexer materializa read models en PostgreSQL. No introduce verdad nueva.

### 6.3 Observación pública

El observer portal consume evidencia on-chain y actas ancladas. Implementa verificaciones deterministas y alertas.

### 6.4 Auditoría independiente

El audit CLI valida firmas, hashes y anclajes on-chain desde RPC, generando un reporte reproducible.

---

## 7. Cadena de custodia digital y actas

Definir actas: Apertura, Cierre, Escrutinio, Resultados. Cada acta: JSON canónico (JCS), hash SHA-256, firma Ed25519, hash anclado on-chain.

---

## 8. Modelo de amenazas y supuestos

Ver `docs/threat-model/ThreatModel.md` (a completar) y ADRs.

---

## 9. Metodología experimental

### 9.1 Métricas

Definir métricas técnicas y experimentales (latencias, costos, reproducibilidad, detección de inconsistencias).

### 9.2 Casos de prueba

Ver `docs/methodology/ExperimentalTestCases.md`.

---

## Apéndice A: ADRs

Ver `docs/adr/`.
