# `@boletera/venue-3d`

React Three Fiber viewer for authored venue seat maps. Used by the public
storefront (`EventPurchaseClient`) and by the admin Estudio 3D.

## Install

Peer dependencies (already provided by the admin / web apps):

```
react@^19  react-dom@^19  three@^0.170  @react-three/fiber@^9  @react-three/drei@^10
```

```ts
import { Venue3DViewer, type Venue3DViewerHandle } from '@boletera/venue-3d';
```

## Quick start (unchanged)

Existing embeds keep working with zero changes:

```tsx
<Venue3DViewer
  mode="orbit"
  seats={seats}
  selectedIds={selected}
  onToggleSeat={toggle}
  stage={map.venue?.stage}
/>
```

Defaults still match 1.x: free orbit, internal HUD, balanced quality (low-power
GL context, `dpr ≤ 1.25`, no shadows, no pan).

## Migration: Estudio 3D / external chrome

The studio builds its own camera, layers and FPS chrome. Point the viewer at it
with the new optional props — nothing in the legacy surface is removed.

```tsx
const viewer = useRef<Venue3DViewerHandle>(null);

<Venue3DViewer
  apiRef={viewer}
  seats={coloredSeats}
  selectedIds={selectedIds}
  onToggleSeat={toggleSeat}
  // Hide the built-in overlays so the studio chrome owns the UI.
  hud={false}
  // Drive the camera from the studio panel / keyboard shortcuts.
  cameraPreset={camera}           // 'orbit' | 'plan' | 'side' | 'stage' | 'seat'
  onCameraPresetChange={setCamera}
  reducedMotion={reducedMotion}   // pass the design-system hook result
  // External layer / level / opacity controls.
  levelFilter={levelFilter}
  onLevelFilterChange={setLevelFilter}
  layers={{
    furniture: layers.furniture,
    aisles: layers.aisles,
    obstacles: layers.obstacles,
    stairs: layers.structure,
    exits: layers.exits && layers.structure,
    plates: layers.sections,
  }}
  opacity={{
    seats: layers.opacity.seats,
    furniture: layers.opacity.furniture,
    structure: layers.opacity.structure,
  }}
  // Quality + real WebGL FPS (not a bare rAF counter).
  quality={quality}               // 'high' | 'balanced' | 'low' | 'auto'
  onFps={setFps}
  onHoverSeat={(seat) => setHovered(seat?.id ?? null)}
  onCameraChange={(state) => {/* optional telemetry */}}
  // …legacy props (stage, aisles, mapData, heatMode, …) still work
/>;

// Imperative helpers (prefer these over remounting with a new `key`).
viewer.current?.fitToBounds({ padding: 1.2 });
viewer.current?.setCameraPreset('plan');
viewer.current?.pan(2, 0);
viewer.current?.dispose();        // free geometries / materials / WebGL context
```

### What replaced what

| Studio need | Before | Now |
| --- | --- | --- |
| Camera presets (planta / lateral / escenario) | Remount with a new `key` | `cameraPreset` / `apiRef.setCameraPreset` |
| Fit to venue | Remount | `apiRef.fitToBounds()` |
| Reduced-motion transitions | CSS fade around remount | Built-in camera tween; jumps when `reducedMotion` |
| Layer / opacity control | Pre-filter geometry props | `layers` + `opacity` (partial opacity on meshes) |
| FPS readout | Host `requestAnimationFrame` counter | `onFps` (samples inside the WebGL render loop) |
| Hide internal HUD | CSS overlay | `hud={false}` |
| GPU teardown | Rely on React unmount | `apiRef.dispose()` + automatic teardown on unmount |

## Camera API

```ts
type Venue3DCameraPreset = 'orbit' | 'plan' | 'side' | 'stage' | 'seat';
```

- `orbit` — legacy free orbit (same framing as before).
- `plan` — top-down, pan enabled.
- `side` — elevation from +X.
- `stage` — parked in front of the authored stage.
- `seat` — first-person via `selectedSeat` (same as `mode="seat"`).

Transitions default to 520 ms and collapse to an instant jump when
`prefers-reduced-motion` is on (or when `reducedMotion={true}`).

Imperative surface (`Venue3DViewerHandle`):

- `setCameraPreset(preset, { animate?, durationMs? })`
- `fitToBounds({ padding?, seatIds?, includeStage?, animate? })`
- `pan(deltaX, deltaZ)` / `panTo(target)` / `focusSeat(id)`
- `getCameraState()` / `getBounds()` / `getFps()` / `getPerformance()`
- `dispose()`

## Layers & opacity

```ts
layers?: Partial<Record<
  'seats' | 'decorativeSeats' | 'plates' | 'aisles' | 'obstacles' |
  'stairs' | 'exits' | 'furniture' | 'focusPoints' | 'stage' | 'shell' | 'egress',
  boolean
>>;

opacity?: Partial<Record<'seats' | 'furniture' | 'structure' | 'plates', number>>;
```

Missing keys stay visible / fully opaque. `opacity.structure` covers aisles,
stairs, exits and obstacles together. A value of `0` skips the draw entirely.

`levelFilter` / `onLevelFilterChange` mirror the internal level chips; when the
host owns them, hide the chips with `hud={{ levels: false }}` (or `hud={false}`).

## Quality & GPU memory

```ts
quality?: 'high' | 'balanced' | 'low' | 'auto' | Partial<Venue3DQualitySettings>;
```

| Preset | dpr | shadows | instancing ≥ | LOD backrests |
| --- | --- | --- | --- | --- |
| `low` | 1 | off | 80 seats | 22 u |
| `balanced` (default) | ≤ 1.25 | off | 180 seats | 38 u |
| `high` | ≤ 2 | on, 2k map | 400 seats | never |

Decision notes:

1. **Instancing** — above the threshold the seating set is two `InstancedMesh`
   draws (cushion + backrest) instead of two meshes per chair. Shared geometries
   and materials are disposed on unmount.
2. **LOD** — backrests hide past `lodDistance`, roughly cutting seat triangle
   count in half when the camera is far out.
3. **Decorative cap** — `maxDecorativeSeats` drops filler chairs under low
   quality so a stadium map does not allocate tens of thousands of instances.
4. **Dispose** — `WebGLTeardown` runs on every Canvas unmount and frees every
   geometry, material, texture and the WebGL context. Call `apiRef.dispose()`
   from the host to trigger the same path without waiting for React to unmount
   (the component keeps its DOM box and falls back to the SVG view).
5. **Quality switches** that change immutable GL attributes (`antialias`,
   `powerPreference`) recreate the Canvas; the previous context is disposed
   first so the GPU does not hold two contexts.

Telemetry:

```tsx
onFps={(fps) => setFps(fps)}
onPerformance={(stats) => {
  // stats.fps, frameMs, drawCalls, triangles, geometries, textures, programs
}}
```

## HUD

```tsx
hud={false}                       // hide everything
hud={{ tooltip: false, fps: true }} // keep chrome, drop tooltip, show FPS
```

## Scripts

```bash
pnpm --filter @boletera/venue-3d check-types
```

There is no separate build step — the package is consumed as TypeScript source
(`main` / `types` point at `src/index.ts`).
