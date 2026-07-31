# Architecture Decision Records (ADR)

Registro de decisiones de arquitectura del monorepo Boletera Platform. Cada ADR documenta **contexto, alternativas, decisión, consecuencias y evidencia verificada en el código**. Prohibido afirmar métricas, fechas o historia sin respaldo en el repositorio.

## Convención de nombres

```
docs/adr/NNNN-titulo-en-kebab-case.md
```

- `NNNN`: número secuencial de cuatro dígitos (`0001`, `0002`, …).
- Título corto en español, en kebab-case.
- Un ADR = una decisión. Si la migración está a medias, el **Estado** lo declara explícitamente.

## Índice

| Nº | Título | Estado | Archivo |
|----|--------|--------|---------|
| 0001 | TanStack Query en lugar de `useEffect` + `fetch` | Aceptada, migración casi completa | [0001-…](./0001-tanstack-query-en-lugar-de-useeffect-fetch.md) |
| 0002 | Motor WebGL2 en lugar de SVG en el DOM | Aceptada e implementada en admin; SVG residual en taquilla | [0002-…](./0002-motor-webgl-en-lugar-de-svg-en-dom.md) |
| 0003 | Cookies httpOnly en lugar de token en `localStorage` | Aceptada, migración parcial | [0003-…](./0003-cookies-httponly-en-lugar-de-token-en-localstorage.md) |
| 0004 | Gráficos SVG propios en lugar de librería | Aceptada e implementada | [0004-…](./0004-graficos-svg-propios-en-lugar-de-libreria.md) |
| 0005 | Design system centralizado en lugar de SCSS por página | Aceptada, adopción parcial | [0005-…](./0005-design-system-centralizado-en-lugar-de-scss-por-pagina.md) |
| 0006 | Contratos tipados compartidos para métricas | Aceptada e implementada en `/metrics`; cobertura parcial fuera | [0006-…](./0006-contratos-tipados-compartidos-para-metricas.md) |
| 0007 | Aislamiento multi-tenant en capa de servicio | Aceptada, sin enforcement en BD | [0007-…](./0007-aislamiento-multi-tenant-en-capa-de-servicio.md) |
| 0008 | Tiempo real por SSE en lugar de WebSockets | Aceptada; auth cross-origin frágil | [0008-…](./0008-tiempo-real-por-sse-en-lugar-de-websockets.md) |

## Enlaces cruzados

| Recurso | Ruta |
|---------|------|
| Arquitectura canónica | [`../arquitectura.md`](../arquitectura.md) |
| Guías de desarrollo | [`../guias/`](../guias/) |
| Ciclo de vida de dominio | [`../dominio/ciclo-de-vida.md`](../dominio/ciclo-de-vida.md) |
| API docs | [`../api/README.md`](../api/README.md) |
| Contrato de seguridad | [`../../apps/api/src/modules/auth/SECURITY-MIGRATION.md`](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md) |
| README del monorepo | [`../../README.md`](../../README.md) |

## Plantilla reutilizable

```markdown
# ADR-000N: <título>

- **Estado**: Aceptada e implementada | Aceptada, migración parcial | …
- **Fecha**: <evidencia o "no determinable desde el repositorio">
- **Ámbito**: <apps/packages afectados>

## Contexto

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| … | … | … |

## Decisión

## Consecuencias

- **Positivas**: …
- **Negativas**: …
- **Obligaciones**: …

## Evidencia en el código

- `ruta/archivo` — qué demuestra
```

Al crear un ADR nuevo: asignar el siguiente número libre, añadir fila al índice de esta página y enlazar desde [`../arquitectura.md`](../arquitectura.md) si la decisión es estructural.
