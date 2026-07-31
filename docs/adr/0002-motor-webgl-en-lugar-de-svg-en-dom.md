# ADR-0002: Motor WebGL2 en lugar de SVG en el DOM

- **Estado**: Aceptada e implementada en el editor admin; SVG/Canvas2D residual en taquilla y como fallback
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `packages/venue-engine` (`src/render/*`), consumidores en `apps/admin` (venue-builder) y `apps/taquilla` (mapa POS)

## Contexto

Los mapas de asientos empresariales pueden superar decenas o cientos de miles de asientos. Un nodo DOM/SVG por asiento no escala: layout, hit-testing y pintura del browser se vuelven el cuello de botella. El paquete `@boletera/venue-engine` expone un motor de render **GPU-first** (WebGL2 con instancing) y un fallback Canvas2D, con índice espacial, LOD y buffers tipados.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| Un `<circle>` / path SVG por asiento en React | Accesibilidad por elemento; debug fácil en DevTools | Coste DOM lineal; el comentario en `webgl-renderer.ts` asume mapas de ~250k donde solo un subconjunto visible se dibuja |
| Librería WebGL genérica (Three.js / Pixi) | Ecosistema, efectos | Peso y abstracción innecesarios para círculos instanciados 2D; el motor propio cabe en un paquete sin deps de render |
| Solo Canvas2D | API simple, sin WebGL | Sin instancing GPU; se conserva solo como **fallback** cuando `tryCreateWebGL2` falla o `forceCanvas2d` |
| **WebGL2 instanced + overlay 2D** | Un draw call de asientos visibles, typed arrays, LOD, hit-test O(células) | — (elegida para el editor) |

## Decisión

El render de asientos del editor admin pasa por `SeatMapRenderer`:

1. Intenta WebGL2 (`WebGlSeatRenderer` — shaders ES 300, `drawArraysInstanced`).
2. Si no hay GL, usa `Canvas2DRenderer` en el mismo canvas.
3. Con WebGL, un canvas overlay 2D pinta capas vectoriales (secciones, guías, overlays).
4. Datos de escena en `scene-buffers.ts` (posiciones/colores/escalas como typed arrays).
5. Culling vía `spatial-index.ts`; detalle vía `lod.ts` (seats → rows → sections).
6. `RenderScheduler` marca dirty y evita RAF innecesario.

El archivo `seatmap-canvas.ts` **sigue existiendo**, pero ya no es un renderer SVG de mapa completo: exporta helpers de path SVG, paleta de estados y colores de heat. Se reexporta desde `packages/venue-engine/src/index.ts` y lo consumen paneles admin (p. ej. `Legend.tsx`, `InventoryPanel.tsx`) para colores, no para pintar miles de nodos.

### Capacidad 250k: qué está respaldado y qué no

- El bench `packages/venue-engine/scripts/bench-render.cjs` genera **250_000** asientos y mide **build del índice espacial, hit-test y culling** — no FPS de GPU ni frame time de `drawArraysInstanced`.
- Comentarios en `webgl-renderer.ts` y `spatial-index.ts` hablan de mapas 100k–250k como objetivo de diseño.
- **No** hay en el repo una cifra verificada del tipo “SVG aguanta 10k / WebGL 250k a 60 fps”. Esa comparación, si se comunica, debe etiquetarse como **objetivo de diseño** justificado por: instancing (un draw call sobre instancias culadas), typed arrays, gather ≤64k visibles, LOD que deja de pintar asientos individuales al alejar el zoom.

Comandos verificados en `package.json` / `packages/venue-engine/package.json`:

- `pnpm smoke:venue-engine` → build + `scripts/run-smokes.cjs`
- `pnpm --filter @boletera/venue-engine bench:render` → build + `bench-render.cjs`

## Consecuencias

- **Positivas**: el venue-builder admin (`CanvasHost` + `useRendererBridge`) no re-renderiza React en cada gesto; el motor es headless y liberable con `destroy()`.
- **Negativas**: dos backends que mantener (WebGL + Canvas2D); depuración GPU más dura; taquilla aún tiene ruta SVG.
- **Obligaciones**:
  - Consumir `@boletera/venue-engine/render` para mapas grandes en admin; no reintroducir un asiento = un nodo React.
  - Llamar siempre a `SeatMapRenderer.destroy` al desmontar.
  - No citar FPS/capacidad sin pasar el bench o un perfil real.

### Residuo SVG (honesto)

`apps/taquilla/components/PosSeatMap.tsx` mantiene `SvgSeatLayer` para mapas con **&lt; 64** asientos (`CANVAS_SEAT_THRESHOLD = 64`) y pasa a Canvas2D propio (no al `SeatMapRenderer` WebGL) por encima de ese umbral. Es una decisión de POS distinta; la ADR del motor WebGL **no está cerrada al 100 % en todo el monorepo**.

## Evidencia en el código

- `packages/venue-engine/src/render/index.ts` — superficie pública del motor
- `packages/venue-engine/src/render/seat-map-renderer.ts` — orquestación WebGL2 / Canvas2D + overlay
- `packages/venue-engine/src/render/webgl-renderer.ts` — instancing, gather, comentario 250k
- `packages/venue-engine/src/render/canvas2d-renderer.ts` — fallback / overlay vectorial
- `packages/venue-engine/src/render/scene-buffers.ts` — typed arrays + `generateSyntheticVenue`
- `packages/venue-engine/src/render/spatial-index.ts` — grid para 100k–250k
- `packages/venue-engine/src/render/lod.ts` — umbrales seats/rows/sections
- `packages/venue-engine/src/render/camera.ts`, `render-scheduler.ts`, `colors.ts`, `layers.ts`
- `packages/venue-engine/src/seatmap-canvas.ts` — helpers SVG/colores (no renderer de mapa)
- `packages/venue-engine/scripts/bench-render.cjs` — bench a 250_000 (índice/hit/cull)
- `packages/venue-engine/package.json` — scripts `smoke` / `bench:render`
- `apps/admin/components/venue-builder/canvas/CanvasHost.tsx` — host React del motor
- `apps/taquilla/components/PosSeatMap.tsx` — `SvgSeatLayer` + umbral 64
