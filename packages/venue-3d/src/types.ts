import type { Ref } from 'react';
import type { SeatMapData } from '@boletera/shared';
import type { BowlSeat, LaidOutSeat } from './bowlLayout';

export type Venue3DHeatMode = 'off' | 'price' | 'view';

export interface Seat3D extends BowlSeat {
  x: number;
  y: number;
  z: number;
}

/** Plain world-space point (three's `Vector3` is never part of the public surface). */
export type Venue3DVec3 = { x: number; y: number; z: number };

/**
 * Camera presets exposed to hosts.
 *
 * - `orbit` — free orbit around the bowl (legacy default, unchanged framing).
 * - `plan` — top-down floor plan, matches the 2D designer orientation.
 * - `side` — elevation from +X, useful to read rake/tiers.
 * - `stage` — parked in front of the stage looking at it.
 * - `seat` — first person from `selectedSeat` (same as the legacy `mode="seat"`).
 */
export type Venue3DCameraPreset = 'orbit' | 'plan' | 'side' | 'stage' | 'seat';

export type Venue3DCameraState = {
  preset: Venue3DCameraPreset;
  position: Venue3DVec3;
  target: Venue3DVec3;
  /** Distance from camera to orbit target, in world units. */
  distance: number;
  /** Orbit angle around Y, radians. */
  azimuth: number;
  /** Angle from the +Y axis, radians (0 = straight above). */
  polar: number;
  /** `true` while a preset/fit transition is still interpolating. */
  animating: boolean;
};

export type Venue3DBounds = {
  min: Venue3DVec3;
  max: Venue3DVec3;
  center: Venue3DVec3;
  /** Half-diagonal of the bounding box — what `fitToBounds` frames. */
  radius: number;
};

export type Venue3DCameraCommandOptions = {
  /** Defaults to `true`; forced off when reduced motion is active. */
  animate?: boolean;
  /** Overrides `cameraTransitionMs` for this command. */
  durationMs?: number;
};

export type Venue3DFitOptions = Venue3DCameraCommandOptions & {
  /** Extra room around the bounds. `1` = tight, default `1.15`. */
  padding?: number;
  /** Frame only these seats instead of the whole visible bowl. */
  seatIds?: string[];
  /** Include the stage volume in the bounds (default `true`). */
  includeStage?: boolean;
};

export type Venue3DQualityPreset = 'high' | 'balanced' | 'low' | 'auto';

export type Venue3DQualitySettings = {
  /** `[min, max]` device pixel ratio handed to the renderer. */
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  powerPreference: 'default' | 'high-performance' | 'low-power';
  /** Interactive seat count at which rendering switches to `InstancedMesh`. */
  instancingThreshold: number;
  /** Camera distance beyond which seat backrests stop rendering (LOD). */
  lodDistance: number;
  /** Hard cap on decorative (non-interactive) seats drawn. */
  maxDecorativeSeats: number;
};

/** Either a named preset or a partial override merged over `balanced`. */
export type Venue3DQuality = Venue3DQualityPreset | Partial<Venue3DQualitySettings>;

export type Venue3DPerfStats = {
  /** Frames actually rasterized by WebGL over the sample window. */
  fps: number;
  /** Mean frame time in ms over the sample window. */
  frameMs: number;
  drawCalls: number;
  triangles: number;
  /** Live geometries retained by the renderer (GPU memory pressure). */
  geometries: number;
  /** Live textures retained by the renderer. */
  textures: number;
  programs: number;
};

export type Venue3DLayerKey =
  | 'seats'
  | 'decorativeSeats'
  | 'plates'
  | 'aisles'
  | 'obstacles'
  | 'stairs'
  | 'exits'
  | 'furniture'
  | 'focusPoints'
  | 'stage'
  | 'shell'
  | 'egress';

/** Any key left out stays visible. */
export type Venue3DLayerVisibility = Partial<Record<Venue3DLayerKey, boolean>>;

export type Venue3DOpacityKey = 'seats' | 'furniture' | 'structure' | 'plates';

/** `0..1` multipliers applied to the layer materials. `0` skips the draw entirely. */
export type Venue3DLayerOpacity = Partial<Record<Venue3DOpacityKey, number>>;

export type Venue3DHudOptions = {
  /** "Venue 3D" pill. */
  badge?: boolean;
  /** Seat count / level / orbit state line. */
  meta?: boolean;
  /** Internal level chips (ignored when `levelFilter` is controlled and `hud.levels` is false). */
  levels?: boolean;
  /** Price / view heat toggles. */
  heat?: boolean;
  /** Egress toggle, hint and legend. */
  egress?: boolean;
  /** Bottom-left color legend. */
  legend?: boolean;
  /** Bottom-right section counters. */
  sections?: boolean;
  /** Floating seat tooltip on hover. */
  tooltip?: boolean;
  /** Selected-seat counter pill. */
  selection?: boolean;
  /** Live FPS readout (off by default). */
  fps?: boolean;
};

/** `false` hides every built-in overlay so the host can render its own chrome. */
export type Venue3DHud = boolean | Venue3DHudOptions;

/** Imperative surface handed to hosts through `apiRef` (or `ref`). */
export interface Venue3DViewerHandle {
  /** Move to a preset. No-op for `seat` when no seat is selected. */
  setCameraPreset(preset: Venue3DCameraPreset, opts?: Venue3DCameraCommandOptions): void;
  /** Frame the visible bowl (or `opts.seatIds`) without changing the preset. */
  fitToBounds(opts?: Venue3DFitOptions): void;
  /** Slide camera and orbit target by a world-space XZ delta. */
  pan(deltaX: number, deltaZ: number, opts?: Venue3DCameraCommandOptions): void;
  /** Move the orbit target to a world point, keeping the current view direction. */
  panTo(target: Venue3DVec3, opts?: Venue3DCameraCommandOptions): void;
  /** Center a seat by id; returns `false` when the seat is not in the visible set. */
  focusSeat(seatId: string, opts?: Venue3DFitOptions): boolean;
  getCameraState(): Venue3DCameraState | null;
  getBounds(): Venue3DBounds | null;
  /** Last sampled WebGL FPS (0 before the first sample). */
  getFps(): number;
  getPerformance(): Venue3DPerfStats | null;
  /**
   * Tear down the canvas and free every geometry, material, texture and the
   * WebGL context. The component keeps its DOM box but stops rendering.
   */
  dispose(): void;
}

export interface Venue3DViewerProps {
  selectedSeat?: { x: number; y: number; z: number };
  seats?: Seat3D[];
  selectedIds?: string[];
  onToggleSeat?: (seatId: string) => void;
  /** Legacy camera switch. `cameraPreset` wins when both are set. */
  mode?: 'orbit' | 'seat';
  className?: string;
  height?: number;
  currency?: string;
  /** Authored stage position/width from the 2D designer, used to center the 3D projection. */
  stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
  aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
  obstacles?: {
    id: string;
    type: string;
    points: [number, number][];
    height?: number;
    levelId?: string;
  }[];
  stairs?: {
    id: string;
    kind?: string;
    points: [number, number][];
    width?: number;
    fromLevelId?: string;
    toLevelId?: string;
  }[];
  exits?: {
    id: string;
    points: [number, number][];
    width?: number;
    label?: string;
    levelId?: string;
  }[];
  furniture?: {
    id: string;
    type: string;
    x: number;
    y: number;
    rotation?: number;
    levelId?: string;
  }[];
  focusPoints?: { id: string; label?: string; x: number; y: number; z?: number; levelId?: string }[];
  /** Multi-level venue filter chips (same ids as map.venue.levels). */
  levels?: { id: string; name: string; elevation?: number; zIndex?: number }[];
  /** Full map for egress path overlays (same geometry as 2D Salidas) + view heat. */
  mapData?: SeatMapData | null;
  /**
   * Initial heat mode when uncontrolled.
   * `true` → price (same as SeatMapViewer.heatDefault).
   */
  heatDefault?: boolean | Venue3DHeatMode;
  /** Controlled heat mode (omit for internal state). */
  heatMode?: Venue3DHeatMode;
  onHeatModeChange?: (mode: Venue3DHeatMode) => void;

  // ── Camera ────────────────────────────────────────────────────────────────
  /** Controlled camera preset. Omit to let the viewer own it. */
  cameraPreset?: Venue3DCameraPreset;
  /** Initial preset when uncontrolled. Defaults to `mode === 'seat' ? 'seat' : 'orbit'`. */
  defaultCameraPreset?: Venue3DCameraPreset;
  onCameraPresetChange?: (preset: Venue3DCameraPreset) => void;
  /** Preset/fit transition length in ms (default 520, ignored under reduced motion). */
  cameraTransitionMs?: number;
  /** Allow right-drag / two-finger panning. Default `false` for `orbit`, `true` elsewhere. */
  enablePan?: boolean;
  /** Auto-rotate the bowl until the user interacts. Default `true`, off under reduced motion. */
  autoRotate?: boolean;
  /**
   * `'auto'` (default) reads `prefers-reduced-motion`. Pass a boolean to force it —
   * useful when the host already resolved the preference.
   */
  reducedMotion?: boolean | 'auto';
  onCameraChange?: (state: Venue3DCameraState) => void;
  /** Throttle for `onCameraChange`, in ms (default 120). */
  cameraSampleMs?: number;

  // ── Layers, levels, opacity ───────────────────────────────────────────────
  /** Controlled level filter; `'ALL'` shows every level. */
  levelFilter?: string | 'ALL';
  /** Initial level filter when uncontrolled (default `'ALL'`). */
  defaultLevelFilter?: string | 'ALL';
  onLevelFilterChange?: (levelId: string | 'ALL') => void;
  /** Per-layer visibility overrides. Missing keys stay visible. */
  layers?: Venue3DLayerVisibility;
  /** Per-layer opacity overrides (`0..1`). */
  opacity?: Venue3DLayerOpacity;
  /** Controlled egress overlay toggle. */
  showEgress?: boolean;
  onShowEgressChange?: (visible: boolean) => void;

  // ── Quality & telemetry ───────────────────────────────────────────────────
  /** Named preset or partial overrides. Default `'balanced'` (legacy settings). */
  quality?: Venue3DQuality;
  /** Sampling window for `onFps` / `onPerformance`, in ms (default 500). */
  fpsSampleMs?: number;
  /** Real WebGL frame rate, sampled inside the render loop. */
  onFps?: (fps: number) => void;
  /** Full renderer telemetry, including GPU resource counts. */
  onPerformance?: (stats: Venue3DPerfStats) => void;

  // ── Callbacks & chrome ────────────────────────────────────────────────────
  /** Fires with the laid-out seat under the pointer, or `null` on exit. */
  onHoverSeat?: (seat: LaidOutSeat | null) => void;
  onWebGLContextLost?: () => void;
  /** `false` hides all built-in overlays; an object toggles them individually. */
  hud?: Venue3DHud;
  /** Imperative handle. Prefer this over `ref` when loading via `next/dynamic`. */
  apiRef?: Ref<Venue3DViewerHandle | null>;
  /** React 19 ref-as-prop. Equivalent to `apiRef`. */
  ref?: Ref<Venue3DViewerHandle | null>;
}

export function resolveHeatDefault(heatDefault?: boolean | Venue3DHeatMode): Venue3DHeatMode {
  if (heatDefault === true || heatDefault === 'price') return 'price';
  if (heatDefault === 'view') return 'view';
  return 'off';
}
