# ADR-0006: Contratos tipados compartidos para métricas

- **Estado**: Aceptada e implementada en el módulo `/metrics`; cobertura parcial fuera de ese módulo
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `packages/shared` (`analytics-contracts.ts`), `apps/api` (`modules/metrics`), `apps/admin` (`lib/queries/metrics.ts` + dashboards)

## Contexto

Dashboards de admin y API deben hablar el mismo idioma: KPIs con delta, series temporales, breakdowns, funnels y alertas, en MXN / `America/Mexico_City`. Sin un contrato compartido, cada lado redefine shapes y el tipado del cliente miente.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| OpenAPI-only (generar tipos) | Una fuente HTTP | El repo aún no genera clientes tipados de métricas; los contratos viven en TS compartido |
| Tipos duplicados en API y admin | Velocidad inicial | Deriva inevitable; exactamente el fallo que este ADR evita en `/metrics` |
| Zod/io-ts en runtime en el borde | Validación runtime | Añade deps y no sustituye el paquete `shared` ya usado para dinero/locale |
| **`@boletera/shared` analytics-contracts** | Una sola definición importable por API y admin | — (elegida para métricas) |

## Decisión

Definir en `packages/shared/src/analytics-contracts.ts` (~428 líneas) los tipos canónicos (`MetricsKpi`, `MetricsTimeSeries`, `MetricsBreakdown`, `MetricsFunnel*`, `MetricsAlert`, payloads por dominio: executive, inventory, orders, access, resale, waitlist, campaigns, fraud, settlements, etc.) y reexportarlos desde `packages/shared/src/index.ts`.

### ¿El servidor importa de verdad `@boletera/shared`?

**Sí**, para el módulo de métricas. Evidencia directa:

- `apps/api/src/modules/metrics/metrics.service.ts` importa `MetricsKpi`, `ExecutiveSummaryMetrics`, `MetricsAlert`, … `from '@boletera/shared'`.
- `metrics-query.dto.ts` importa `MetricsGranularity` desde `@boletera/shared`.
- Admin `lib/queries/metrics.ts` tipa las respuestas HTTP con los mismos tipos.
- Pantallas `dashboard` / `analytics` importan `ExecutiveSummaryMetrics` / `MetricsKpi` desde `@boletera/shared`.

No hay redeclaración de `interface MetricsKpi` en `apps/api` (búsqueda sin duplicados de ese símbolo).

### Hallazgo de cobertura parcial (el más útil)

El contrato compartido **no cubre todo el analytics legacy**:

| Shape | Dónde vive | ¿En `analytics-contracts`? |
|-------|------------|----------------------------|
| `ExecutiveSummaryMetrics`, `MetricsKpi`, … | `@boletera/shared` | Sí |
| `RealtimeDashboard` | `apps/admin/lib/platform-api.ts` (local) | **No** |
| `PromoterDashboard` | `apps/admin/lib/queries/analytics.ts` (local) | **No** |

La evidencia sugiere un corte limpio en el módulo Nest `metrics/*`, mientras reporting/realtime antiguo sigue con tipos ad hoc en admin. Eso es deuda: dos “dialectos” de analytics.

## Consecuencias

- **Positivas**: API y admin no pueden divergir en KPIs executive sin romper tipos; locale/moneda documentados en el header del contrato.
- **Negativas**: contratos incompletos fuera de `/metrics`; riesgo de que nuevos endpoints de reporting reinventen shapes en `platform-api.ts`.
- **Obligaciones**:
  - Todo endpoint nuevo bajo `/metrics` debe devolver shapes de `analytics-contracts` (o extender ese archivo).
  - No copiar `MetricsKpi` a DTOs locales.
  - Migrar gradualmente `RealtimeDashboard` / promoter dashboard al paquete shared (o justificar exclusión en un ADR hijo).

## Evidencia en el código

- `packages/shared/src/analytics-contracts.ts` — fuente de verdad (~428 líneas)
- `packages/shared/src/index.ts` — `export * from './analytics-contracts'`
- `apps/api/src/modules/metrics/metrics.service.ts` — imports reales desde `@boletera/shared`
- `apps/api/src/modules/metrics/metrics.controller.ts` — HTTP `/metrics/*`
- `apps/api/src/modules/metrics/dto/metrics-query.dto.ts` — `MetricsGranularity` compartido
- `apps/admin/lib/queries/metrics.ts` — hooks tipados con contratos shared
- `apps/admin/lib/platform-api.ts` — `RealtimeDashboard` **local** (hueco de cobertura)
- `apps/admin/lib/queries/analytics.ts` — `PromoterDashboard` **local**
