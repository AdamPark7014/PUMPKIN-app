# ADR-0004: Gráficos SVG propios en lugar de librería

- **Estado**: Aceptada e implementada
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `packages/ui` (componentes de visualización + `lib/scale|path|chart|format`)

## Contexto

El admin necesita KPIs y series (área, línea, barras, donut, funnel, sparkline, heatmap, progress ring) alineados al design system y al locale mexicano. Añadir Recharts/Chart.js/D3 como dependencia de runtime aumentaría el bundle y acoplaría tokens a APIs ajenas. `packages/ui/package.json` confirma **cero dependencias de runtime** (solo peerDeps `react`/`react-dom` y devDeps `sass`/`typescript`).

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| Recharts / Chart.js / Nivo | Features (zoom, brush, animaciones ricas) | Runtime deps; estilos ajenos a tokens `--bl-*`; SSR/hidratación más pesada |
| D3 completo | Máximo control | Bundle grande; API procedural chocaría con componentes React del design system |
| Imágenes/server-side charts | Cero JS de charts en cliente | Malos para tooltips interactivos y tema claro/oscuro |
| **SVG propio sobre primitivas internas** | Tree-shakeable, tokens CSS, `Intl` es-MX/MXN, SSR-friendly como markup SVG | — (elegida) |

## Decisión

Implementar un motor mínimo de charts en `@boletera/ui`:

- **Públicos**: `AreaChart`, `LineChart`, `BarChart`, `DonutChart`, `FunnelChart`, `Sparkline`, `Heatmap`, `ProgressRing` (+ `KpiCard`).
- **Internos**: `CartesianChart` (área/línea compartidas), `ChartShell` (layout, tooltip, `role="img"`, tabla `srOnly` para AT).
- **Libs**: `scale.ts` (linear/band/nice ticks — comentario explícito “reemplazan a d3-scale”), `path.ts` (rutas SVG a mano — “sustituyen a d3-shape”), `chart.ts`, `format.ts` (`es-MX`, `MXN`, compact, percent).

Los colores de serie usan tokens (`vizSeries` / `colorVar`) para respetar `data-theme`.

## Consecuencias

- **Positivas**:
  - Bundle: sin librería de charts en el grafo de deps de `@boletera/ui`.
  - SSR Next: el markup es SVG/React estándar; no hay canvas opaco ni `window` obligatorio en el shell (los charts marcan `'use client'` por interacción, no por WebGL).
  - Formato de negocio MX listo (`formatCurrency`, `formatCompact`, etc.).
  - Accesibilidad básica: etiqueta + tabla oculta equivalente.
- **Negativas / coste de mantenimiento** (hay que mantener a mano):
  - Escalas, ticks “nice”, stacking, tooltips de índice cruzado, leyendas, paths suaves.
  - A11y más allá de la tabla (navegación por teclado punto a punto, anuncios live de hover) **no** está cubierta de forma rica.
- **Qué NO está cubierto** (verificado por ausencia en la API pública):
  - Zoom/pan/brush, anotaciones, dual-axis complejos, export CSV/PNG del chart, animaciones de transición tipo librería, time-series streaming nativo, mapas geográficos.
- **Obligaciones**: nuevos charts viven en `@boletera/ui` con tokens; no añadir recharts/d3/chart.js a `packages/ui` sin un ADR que revierta este.

## Evidencia en el código

- `packages/ui/package.json` — sin dependencies de runtime; peers react/react-dom
- `packages/ui/src/components/AreaChart.tsx`, `LineChart.tsx`, `BarChart.tsx`, `DonutChart.tsx`, `FunnelChart.tsx`, `Sparkline.tsx`, `Heatmap.tsx`, `ProgressRing.tsx`
- `packages/ui/src/internal/CartesianChart.tsx`, `ChartShell.tsx` — motor + a11y
- `packages/ui/src/lib/scale.ts`, `path.ts`, `chart.ts`, `format.ts` — escalas, paths, `es-MX`/`MXN`
- `packages/ui/src/index.ts` — exports explícitos bajo “visualizacion”
- `packages/ui/src/styles/tokens.ts` — `colorVar` pensado para atributos SVG de charts
