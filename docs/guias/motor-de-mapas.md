# Motor de mapas — `@boletera/venue-engine`

Cómo consumir el motor de render y la geometría. Fuentes: `packages/venue-engine/src/index.ts`, `src/render/index.ts`, integración en `apps/admin/components/venue-builder/canvas/`.

**Paquete:** `name` = `@boletera/venue-engine`.

---

## Subpaths de import (campo `exports`)

Verificado en `packages/venue-engine/package.json`:

| Import | Contenido |
|--------|-----------|
| `@boletera/venue-engine` | Geometría, `map-utils`, `seatmap-canvas`, `layout-templates` — **sin DOM/WebGL** (seguro en Node/API) |
| `@boletera/venue-engine/render` | `SeatMapRenderer`, cámara, LOD, WebGL/Canvas2D, buffers, hit-testing |

El entry raíz lo deja explícito:

```1:5:packages/venue-engine/src/index.ts
export * from './map-utils';
export * from './seatmap-canvas';
export * from './layout-templates';
export * from './geometry';
// Browser render engine is a separate entry — keep Node/API consumers DOM-free.
```

En admin, `next.config.ts` ya incluye `transpilePackages: [..., '@boletera/venue-engine']`.

---

## Ciclo de vida del renderer (obligatorio)

JSDoc de `render/index.ts` y de `SeatMapRenderer`:

```ts
import { SeatMapRenderer } from '@boletera/venue-engine/render';

const r = new SeatMapRenderer(/* SeatMapRendererOptions */);
r.mount(canvas);
r.setScene(mapData, { colorMode: 'status', colorContext: { ... } });
// hitTest / queryRect / updateSeats / setColorMode / setLayerVisibility …
r.destroy(); // libera GPU, listeners, RAF — OBLIGATORIO al desmontar
```

Opciones reales (`render/types.ts`): `minZoom`, `maxZoom`, `seatRadius`, `cellSize`, `background`, `forceCanvas2d`, `reducedMotion`.

### Integración React (venue-builder)

Piezas reales:

| Archivo | Rol |
|---------|-----|
| `canvas/renderer-context.tsx` | `RendererProvider` + `useRendererHandle()` (`ref` + `ready`) |
| `canvas/CanvasHost.tsx` | Gestos; `CanvasSurface` hace `mount` / cleanup `destroy` |
| `canvas/useRendererBridge.ts` | Empuja store → `setScene` / `updateSeats` / color / layers / overlays |
| `canvas/VectorOverlay.tsx` | Overlay vectorial |
| `canvas/BackgroundUnderlayLayer.tsx` | Fondo |

Cleanup real:

```186:192:apps/admin/components/venue-builder/canvas/CanvasHost.tsx
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = handle.ref.current;
    if (!canvas || !renderer) return undefined;
    renderer.mount(canvas);
    return () => renderer.destroy();
  }, [handle]);
```

### Estado de la integración (importante)

Al escribir esta guía, **no hay ningún `new SeatMapRenderer()` en `apps/admin`** (solo el ejemplo del JSDoc del paquete). El canvas asume que `handle.ref.current` ya apunta a una instancia creada por un padre (`RendererProvider`) que **aún no está cableado** en una página de maps completa.

Conclusión: el puente (bridge, host, overlays, tools, store) está avanzado; el **wiring de instancia + página** está a medio construir. Sigue el ciclo de vida del JSDoc al completar el shell.

---

## Tipos clave (`render/types.ts`)

| Tipo | Uso |
|------|-----|
| `ColorMode` | `'zone' \| 'tier' \| 'price' \| 'status' \| 'sightline'` |
| `LayerId` | `background`, `sections`, `rows`, `seats`, `furniture`, `stage`, `analysis`, `guides`, `grid`, `interaction` |
| `LodLevel` | `'sections' \| 'rows' \| 'seats'` |
| `HitResult` | `seatId`, `index`, `world`, `screen`, `distance` |
| `SeatPatch` | Parches parciales sin rebuild completo |
| `SceneOptions` | `colorMode`, `colorContext`, `seatRadius` |
| `ColorModeContext` | maps de status/price/sightline, `offers`, `selectedIds`, `priceRange` |
| `RenderStats` | fps, drawCalls, lod, `backend: 'webgl2' \| 'canvas2d'`, timings |
| `SeatMapRendererOptions` | clamp de zoom, radio, cellSize, forceCanvas2d, … |

---

## Selección, hit-testing, capas, LOD

- **Índice espacial:** `SpatialIndex` / `estimateCellSize` (`spatial-index.ts`) — usado por el renderer para hit y culling.
- **Cámara:** `Camera` (`camera.ts`) — `screenToWorld`, `fitToBounds`, zoom/pan.
- **LOD:** `LodController` + `buildLodAggregates` — al alejar, agrega por sección/fila.
- **Capas:** `LayerStack` / `DEFAULT_LAYER_ORDER` — `setLayerVisibility` / `setLayerLocked` desde el bridge.
- **Color:** `bakeSeatColors`, `statusColorRgba`, `priceHeatRgba`, `sightlineHeatRgba` (`colors.ts`); `rebakeColors` sin rebuild de geometría.
- **Buffers:** `buildSceneBuffers`, `applySeatPatches`, `rebakeColors`, `generateSyntheticVenue` (`scene-buffers.ts`).
- **Scheduler:** `RenderScheduler` — dirty flags + RAF budget.

El bridge reacciona a epochs del editor:

- `structuralEpoch` → `setScene`
- `patchEpoch` → `updateSeats` (+ resync idle de agregados LOD)
- cambios de color/selección → `setColorMode`
- layers / validation overlays → APIs correspondientes

---

## Fallback Canvas2D

En `mount`:

1. Si no `forceCanvas2d`, intenta `tryCreateWebGL2(canvas)`.
2. Si hay GL: seats en WebGL2 + canvas overlay 2D para vectores/grid.
3. Si no: un solo `Canvas2DRenderer` sobre el canvas principal (`backend = 'canvas2d'`).

Qué pierdes / cambia:

- Menos throughput en venues grandes (un draw-call instanced WebGL vs paths 2D).
- `RenderStats.backend` reporta `'canvas2d'`.
- Overlays de análisis/interacción siguen dibujándose en 2D (el 2D también es overlay cuando hay WebGL).

Forzar 2D en CI/tests: `new SeatMapRenderer({ forceCanvas2d: true })`.

---

## Entry raíz: geometría (inventario)

Exportado vía `geometry/index.ts`. Madurez relativa según presencia de smokes/tests y uso en admin:

| Módulo | Estado práctico |
|--------|-----------------|
| `migrate`, `resolve`, `project`, `types` | Núcleo v3 — base de casi todo |
| `generators`, `regenerate`, `fill-shape`, `snaps` | Generación / edición de geometría |
| `validate` | Validación espacial (overlaps, clearance); smokes `smoke-validate-*`, `smoke-clearance` |
| `sightlines` | Scoring 0..1 + grades; smokes y color mode `sightline` |
| `circulation`, `egress-report`, `egress-overlay` | Egress/circulación; **muchos** smokes (`smoke-egress*`) — maduro en análisis |
| `svg-import` / `svg-export`, `dxf-import` / `dxf-export` | CAD roundtrip; smokes `smoke-cad-*`, `smoke-regen-svg` |
| `cad-import-apply`, `cad-level-tags`, `venue-levels` | Multi-nivel / locks; smokes level/focus |
| `map-utils`, `seatmap-canvas`, `layout-templates` | Helpers SVG/colores legacy + templates |

Uso ligero en admin hoy: `InventoryPanel` importa `flatSeats`, `normalizeSeatMap`, `resolveOfferForSection` del entry raíz (no del render).

---

## Smokes y benchmark

Scripts del paquete (`packages/venue-engine/package.json`):

```json
"smoke": "node scripts/run-smokes.cjs",
"bench:render": "pnpm build && node scripts/bench-render.cjs"
```

Desde la raíz:

```powershell
pnpm smoke:venue-engine
# equivale a: build del paquete + smoke

pnpm --filter @boletera/venue-engine bench:render
```

Hay ~25 smokes en `packages/venue-engine/scripts/` (egress, CAD, sightline, levels, capacity, …) orquestados por `run-smokes.cjs`.

También: `pnpm --filter @boletera/venue-engine build` / `check-types`.

---

## Enlaces

- [README del paquete](../../packages/venue-engine/README.md)
- [Design system](./design-system.md) (UI alrededor del editor)
- [Arquitectura](../arquitectura.md)
- [Índice](./README.md)
