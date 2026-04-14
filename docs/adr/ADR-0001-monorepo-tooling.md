# ADR-0001: Monorepo y tooling reproducible

## Estado

Adoptado

## Contexto

El sistema requiere múltiples componentes (contratos, servicios, portales, CLI) con consistencia de tipos y un pipeline reproducible.

## Decisión

- pnpm workspaces + turborepo.
- TypeScript estricto.
- Docker compose local para servicios base (PostgreSQL).

## Consecuencias

- Onboarding y CI consistentes.
- Mayor disciplina de versionado y dependencias internas.
