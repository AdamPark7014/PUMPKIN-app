/// <reference path="./react-three-fiber.d.ts" />
'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Canvas } from '@react-three/fiber';
import {
  layoutSeatsAuto,
  sectionColor,
  type BowlSeat,
  type LaidOutSeat,
} from './bowlLayout';
import {
  calculateSightlines,
  priceHeatColor,
  projectEgressOverlaysTo3D,
  resolveGeometry,
  sightlineHeatColor,
} from '@boletera/venue-engine';
import styles from './Venue3DViewer.module.css';
import {
  resolveHeatDefault,
  type Venue3DCameraCommandOptions,
  type Venue3DCameraPreset,
  type Venue3DFitOptions,
  type Venue3DHeatMode,
  type Venue3DPerfStats,
  type Venue3DViewerHandle,
  type Venue3DViewerProps,
} from './types';
import { computeBounds } from './viewer/bounds';
import { CompatibleVenueView } from './viewer/CompatibleVenueView';
import { DEFAULT_TRANSITION_MS } from './viewer/CameraRig';
import type { CameraController } from './viewer/cameraController';
import { resolveHud } from './viewer/hud';
import { resolveLayers, resolveOpacity } from './viewer/layers';
import { resolveQuality } from './viewer/quality';
import { Scene } from './viewer/Scene';
import { usePrefersReducedMotion } from './viewer/useReducedMotion';
import { ViewerHud } from './viewer/ViewerHud';

export type {
  Seat3D,
  Venue3DBounds,
  Venue3DCameraCommandOptions,
  Venue3DCameraPreset,
  Venue3DCameraState,
  Venue3DFitOptions,
  Venue3DHeatMode,
  Venue3DHud,
  Venue3DHudOptions,
  Venue3DLayerKey,
  Venue3DLayerOpacity,
  Venue3DLayerVisibility,
  Venue3DOpacityKey,
  Venue3DPerfStats,
  Venue3DQuality,
  Venue3DQualityPreset,
  Venue3DQualitySettings,
  Venue3DVec3,
  Venue3DViewerHandle,
  Venue3DViewerProps,
} from './types';

/**
 * Interactive 3D venue viewer.
 *
 * Everything beyond `seats` is optional and additive: with no new props the
 * component renders exactly like the 1.x viewer (internal HUD, free orbit,
 * balanced quality). Hosts that need to drive the camera, layers or telemetry
 * from their own chrome can opt in through `cameraPreset`, `layers`, `hud`,
 * `onFps` and `apiRef`.
 *
 * @example Studio-style embed with external chrome
 * ```tsx
 * const viewer = useRef<Venue3DViewerHandle>(null);
 *
 * <Venue3DViewer
 *   apiRef={viewer}
 *   seats={seats}
 *   hud={false}
 *   cameraPreset={preset}
 *   onCameraPresetChange={setPreset}
 *   layers={{ furniture: showFurniture }}
 *   opacity={{ seats: 0.8 }}
 *   quality="high"
 *   onFps={setFps}
 * />;
 *
 * viewer.current?.fitToBounds({ padding: 1.2 });
 * ```
 */
export function Venue3DViewer({
  selectedSeat,
  seats = [],
  selectedIds = [],
  onToggleSeat,
  mode = 'orbit',
  className,
  height = 520,
  currency = 'MXN',
  stage,
  aisles: aislesProp,
  obstacles: obstaclesProp,
  stairs: stairsProp,
  exits: exitsProp,
  furniture: furnitureProp,
  focusPoints: focusPointsProp,
  levels: levelsProp = [],
  mapData = null,
  heatDefault,
  heatMode: heatModeProp,
  onHeatModeChange,
  cameraPreset: cameraPresetProp,
  defaultCameraPreset,
  onCameraPresetChange,
  cameraTransitionMs = DEFAULT_TRANSITION_MS,
  enablePan,
  autoRotate = true,
  reducedMotion: reducedMotionProp = 'auto',
  onCameraChange,
  cameraSampleMs = 120,
  levelFilter: levelFilterProp,
  defaultLevelFilter = 'ALL',
  onLevelFilterChange,
  layers: layersProp,
  opacity: opacityProp,
  showEgress: showEgressProp,
  onShowEgressChange,
  quality: qualityProp,
  fpsSampleMs = 500,
  onFps,
  onPerformance,
  onHoverSeat,
  onWebGLContextLost,
  hud: hudProp,
  apiRef,
  ref,
}: Venue3DViewerProps) {
  const [hover, setHover] = useState<LaidOutSeat | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [webglLost, setWebglLost] = useState(false);
  const [disposed, setDisposed] = useState(false);
  const [levelFilterInternal, setLevelFilterInternal] = useState<string | 'ALL'>(
    defaultLevelFilter,
  );
  const [showEgressInternal, setShowEgressInternal] = useState(false);
  const [heatModeInternal, setHeatModeInternal] = useState(() =>
    resolveHeatDefault(heatDefault),
  );
  const [presetInternal, setPresetInternal] = useState<Venue3DCameraPreset>(
    () => defaultCameraPreset ?? (mode === 'seat' ? 'seat' : 'orbit'),
  );
  const [fps, setFps] = useState(0);

  const controllerRef = useRef<CameraController | null>(null);
  const presetOptionsRef = useRef<Venue3DCameraCommandOptions | undefined>(undefined);
  const fpsRef = useRef(0);
  const perfRef = useRef<Venue3DPerfStats | null>(null);
  const onHoverSeatRef = useRef(onHoverSeat);
  onHoverSeatRef.current = onHoverSeat;

  const heatMode = heatModeProp ?? heatModeInternal;
  const levelFilter = levelFilterProp ?? levelFilterInternal;
  const showEgress = showEgressProp ?? showEgressInternal;
  const cameraPreset = cameraPresetProp ?? presetInternal;
  const reducedMotion = usePrefersReducedMotion(reducedMotionProp);
  const quality = useMemo(() => resolveQuality(qualityProp), [qualityProp]);
  const hud = useMemo(() => resolveHud(hudProp), [hudProp]);
  const layers = useMemo(() => resolveLayers(layersProp), [layersProp]);
  const opacity = useMemo(() => resolveOpacity(opacityProp), [opacityProp]);

  // Legacy `mode` still drives seat/orbit when the host does not control
  // `cameraPreset`. Plan/side/stage set through the new API are preserved.
  useEffect(() => {
    if (cameraPresetProp !== undefined) return;
    setPresetInternal((prev) => {
      if (mode === 'seat') return 'seat';
      if (prev === 'seat') return 'orbit';
      return prev;
    });
  }, [mode, cameraPresetProp]);

  function setHeatMode(next: Venue3DHeatMode) {
    onHeatModeChange?.(next);
    if (heatModeProp === undefined) setHeatModeInternal(next);
  }

  function toggleHeat(next: Exclude<Venue3DHeatMode, 'off'>) {
    setHeatMode(heatMode === next ? 'off' : next);
  }

  const setLevelFilter = useCallback(
    (next: string | 'ALL') => {
      onLevelFilterChange?.(next);
      if (levelFilterProp === undefined) setLevelFilterInternal(next);
    },
    [levelFilterProp, onLevelFilterChange],
  );

  const toggleEgress = useCallback(() => {
    const next = !showEgress;
    onShowEgressChange?.(next);
    if (showEgressProp === undefined) setShowEgressInternal(next);
  }, [showEgress, showEgressProp, onShowEgressChange]);

  const levels = useMemo(() => {
    const list = [...levelsProp];
    list.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    return list;
  }, [levelsProp]);

  const layout = useMemo(() => {
    const enriched: BowlSeat[] = seats.map((s, i) => ({
      ...s,
      color: s.color || sectionColor(s.section || String(i)),
    }));
    return layoutSeatsAuto(enriched, {
      mode: 'published',
      stage,
      aisles: aislesProp,
      obstacles: obstaclesProp,
      stairs: stairsProp,
      exits: exitsProp,
      furniture: furnitureProp,
      focusPoints: focusPointsProp,
    });
  }, [
    seats,
    stage,
    aislesProp,
    obstaclesProp,
    stairsProp,
    exitsProp,
    furnitureProp,
    focusPointsProp,
  ]);

  const {
    seats: laidOutAll,
    plates: platesAll,
    stageZ,
    stagePose,
    aisles: aislesAll,
    obstacles: obstaclesAll,
    stairs: stairsAll,
    exits: exitsAll,
    furniture: furnitureAll,
    focusPoints: focusPointsAll,
  } = layout;

  const laidOut = useMemo(() => {
    if (levelFilter === 'ALL') return laidOutAll;
    return laidOutAll.filter((s) => !s.levelId || s.levelId === levelFilter);
  }, [laidOutAll, levelFilter]);

  const plates = useMemo(() => {
    if (levelFilter === 'ALL') return platesAll;
    return platesAll.filter((p) => !p.levelId || p.levelId === levelFilter);
  }, [platesAll, levelFilter]);

  const aisles = useMemo(() => {
    if (levelFilter === 'ALL') return aislesAll;
    return aislesAll.filter((a) => !a.levelId || a.levelId === levelFilter);
  }, [aislesAll, levelFilter]);

  const obstacles = useMemo(() => {
    if (levelFilter === 'ALL') return obstaclesAll;
    return obstaclesAll.filter((o) => !o.levelId || o.levelId === levelFilter);
  }, [obstaclesAll, levelFilter]);

  const stairs = useMemo(() => {
    if (levelFilter === 'ALL') return stairsAll;
    return stairsAll.filter((st) => {
      if (!st.fromLevelId && !st.toLevelId) return true;
      return st.fromLevelId === levelFilter || st.toLevelId === levelFilter;
    });
  }, [stairsAll, levelFilter]);

  const exits = useMemo(() => {
    if (levelFilter === 'ALL') return exitsAll;
    return exitsAll.filter((e) => !e.levelId || e.levelId === levelFilter);
  }, [exitsAll, levelFilter]);

  const furniture = useMemo(() => {
    if (levelFilter === 'ALL') return furnitureAll;
    return furnitureAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [furnitureAll, levelFilter]);

  const focusPoints = useMemo(() => {
    if (levelFilter === 'ALL') return focusPointsAll;
    return focusPointsAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [focusPointsAll, levelFilter]);

  const egressOverlay = useMemo(() => {
    if (!showEgress || !mapData || !layers.egress) return null;
    return projectEgressOverlaysTo3D(mapData, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, mapData, levelFilter, layers.egress]);

  const priceRange = useMemo(() => {
    const prices: number[] = [];
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price === 'number' && Number.isFinite(s.price) && s.price > 0) {
        prices.push(s.price);
      }
    }
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [laidOut]);

  const sightlineMeta = useMemo(() => {
    if (heatMode !== 'view' || !mapData) return null;
    const result = calculateSightlines(resolveGeometry(mapData), {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    const heatBySeat = new Map<string, string>();
    const gradeBySeat = new Map<string, string>();
    for (const s of result.scores) {
      heatBySeat.set(s.seatId, sightlineHeatColor(s.score));
      gradeBySeat.set(s.seatId, s.grade);
    }
    return { heatBySeat, gradeBySeat, summary: result.summary };
  }, [heatMode, mapData, levelFilter]);

  const priceHeatBySeat = useMemo(() => {
    if (heatMode !== 'price' || !priceRange) return null;
    const heatBySeat = new Map<string, string>();
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price !== 'number' || !Number.isFinite(s.price)) continue;
      heatBySeat.set(s.id, priceHeatColor(s.price, priceRange.min, priceRange.max));
    }
    return heatBySeat.size ? heatBySeat : null;
  }, [heatMode, laidOut, priceRange]);

  const heatBySeat =
    heatMode === 'view'
      ? sightlineMeta?.heatBySeat
      : heatMode === 'price'
        ? priceHeatBySeat
        : null;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const interactiveCount = useMemo(
    () => laidOut.reduce((total, seat) => (seat.decorative ? total : total + 1), 0),
    [laidOut],
  );

  const sections = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const s of laidOut) {
      if (s.decorative || !s.section) continue;
      const cur = map.get(s.section) ?? {
        name: s.section,
        color: s.color || sectionColor(s.section),
        count: 0,
      };
      cur.count += 1;
      map.set(s.section, cur);
    }
    return Array.from(map.values());
  }, [laidOut]);

  const bounds = useMemo(
    () => computeBounds({ seats: laidOut, stagePose, stageZ }),
    [laidOut, stagePose, stageZ],
  );

  const handleHoverSeat = useCallback((seat: LaidOutSeat | null) => {
    setHover(seat);
    onHoverSeatRef.current?.(seat);
  }, []);

  const wantsPerf = Boolean(onFps || onPerformance || hud.fps);
  const handlePerfSample = useCallback(
    (stats: Venue3DPerfStats) => {
      fpsRef.current = stats.fps;
      perfRef.current = stats;
      onFps?.(stats.fps);
      onPerformance?.(stats);
      setFps((prev) => (prev === stats.fps ? prev : stats.fps));
    },
    [onFps, onPerformance],
  );

  const setCameraPreset = useCallback(
    (next: Venue3DCameraPreset, opts?: Venue3DCameraCommandOptions) => {
      if (next === cameraPreset) {
        controllerRef.current?.applyPreset(next === 'seat' ? 'orbit' : next, opts);
        return;
      }
      presetOptionsRef.current = opts;
      onCameraPresetChange?.(next);
      if (cameraPresetProp === undefined) setPresetInternal(next);
    },
    [cameraPreset, cameraPresetProp, onCameraPresetChange],
  );

  const fitToBounds = useCallback(
    (opts?: Venue3DFitOptions) => {
      const controller = controllerRef.current;
      if (!controller) return;
      const target = computeBounds({
        seats: laidOut,
        stagePose,
        stageZ,
        seatIds: opts?.seatIds ?? null,
        includeStage: opts?.includeStage ?? true,
      });
      controller.frameBounds(target, opts);
    },
    [laidOut, stagePose, stageZ],
  );

  const handle = useMemo<Venue3DViewerHandle>(
    () => ({
      setCameraPreset,
      fitToBounds,
      pan: (deltaX, deltaZ, opts) => controllerRef.current?.pan(deltaX, deltaZ, opts),
      panTo: (target, opts) => controllerRef.current?.panTo(target, opts),
      focusSeat: (seatId, opts) => {
        const seat = laidOut.find((entry) => entry.id === seatId && !entry.decorative);
        if (!seat) return false;
        controllerRef.current?.panTo({ x: seat.px, y: seat.py + 0.6, z: seat.pz }, opts);
        return true;
      },
      getCameraState: () => controllerRef.current?.getState() ?? null,
      getBounds: () => bounds,
      getFps: () => fpsRef.current,
      getPerformance: () => perfRef.current,
      dispose: () => setDisposed(true),
    }),
    [setCameraPreset, fitToBounds, laidOut, bounds],
  );

  useImperativeHandle(apiRef, () => handle, [handle]);
  useImperativeHandle(ref, () => handle, [handle]);

  const seatView = cameraPreset === 'seat' && Boolean(selectedSeat);
  const showFallback = webglLost || disposed;
  const wrapStyle = { ['--venue-h' as string]: `${height}px` } as CSSProperties;

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} style={wrapStyle}>
      <div className={styles.canvas}>
        {!disposed && (
          <Canvas
            // WebGL context attributes are immutable, so a quality switch that
            // changes them must recreate the context (old one is disposed).
            key={`${quality.antialias}-${quality.powerPreference}`}
            dpr={quality.dpr}
            shadows={quality.shadows}
            camera={{ fov: 40, position: [0, 11, 13.5], near: 0.1, far: 400 }}
            gl={{
              antialias: quality.antialias,
              alpha: false,
              powerPreference: quality.powerPreference,
              failIfMajorPerformanceCaveat: false,
            }}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener(
                'webglcontextlost',
                (event) => {
                  event.preventDefault();
                  setWebglLost(true);
                  onWebGLContextLost?.();
                },
                { once: true },
              );
            }}
          >
            <Scene
              seats={laidOut}
              plates={plates}
              stageZ={stageZ}
              stagePose={stagePose}
              aisles={aisles}
              obstacles={obstacles}
              stairs={stairs}
              exits={exits}
              furniture={furniture}
              focusPoints={focusPoints}
              egressOverlay={egressOverlay}
              highlightEgressSection={hover?.section ?? null}
              selectedIds={selectedSet}
              heatBySeat={heatBySeat}
              onToggleSeat={onToggleSeat}
              onHoverSeat={handleHoverSeat}
              seatView={seatView}
              selectedSeat={selectedSeat}
              cameraPreset={cameraPreset}
              bounds={bounds}
              controllerRef={controllerRef}
              presetOptionsRef={presetOptionsRef}
              autoOrbit={autoRotate && autoOrbit && selectedIds.length === 0}
              reducedMotion={reducedMotion}
              cameraTransitionMs={cameraTransitionMs}
              cameraSampleMs={cameraSampleMs}
              enablePan={enablePan}
              onCameraChange={onCameraChange}
              onUserInteract={() => setAutoOrbit(false)}
              layers={layers}
              opacity={opacity}
              quality={quality}
              fpsSampleMs={fpsSampleMs}
              onPerfSample={wantsPerf ? handlePerfSample : undefined}
            />
          </Canvas>
        )}

        {showFallback && (
          <CompatibleVenueView
            seats={laidOut}
            note={
              disposed
                ? 'Visor 3D liberado · vista compatible'
                : 'Vista compatible · activa la aceleración por hardware para órbita 3D'
            }
          />
        )}

        <ViewerHud
          hud={hud}
          levels={levels}
          levelFilter={levelFilter}
          onLevelFilterChange={setLevelFilter}
          interactiveCount={interactiveCount}
          autoOrbit={autoRotate && autoOrbit && !reducedMotion}
          heatMode={heatMode}
          onToggleHeat={toggleHeat}
          hasPricedSeats={Boolean(priceRange && priceRange.max > 0)}
          hasMapData={Boolean(mapData)}
          priceRange={priceRange}
          sightlineMeta={sightlineMeta}
          showEgress={showEgress}
          onToggleEgress={toggleEgress}
          egressOverlay={egressOverlay}
          selectedCount={selectedIds.length}
          selectedIds={selectedSet}
          hover={hover}
          currency={currency}
          sections={sections}
          fps={fps}
        />
      </div>
    </div>
  );
}
