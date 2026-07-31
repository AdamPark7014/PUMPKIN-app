'use client';

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { normalizeSeatMap, computeMapBounds } from '@boletera/venue-engine';
import {
  SeatMapRenderer,
  type AnalysisOverlay,
  type ColorMode,
  type ColorModeContext,
  type SeatRenderStatus,
} from '@boletera/venue-engine/render';
import type { SeatMapOffer } from './types';
import styles from '../SeatMapViewer.module.scss';

type SeatMapData = ReturnType<typeof normalizeSeatMap>;
type SeatMapBounds = ReturnType<typeof computeMapBounds>;

export type GpuViewportProps = {
  map: SeatMapData;
  selected: readonly string[];
  statusBySeat: Readonly<Record<string, string>>;
  offers: readonly SeatMapOffer[];
  colorMode: ColorMode;
  priceBySeatId: Readonly<Record<string, number>>;
  sightlineBySeatId: Readonly<Record<string, number>> | null;
  priceRange: { min: number; max: number };
  /** Seats that should render dimmed / not be selectable (filters). */
  dimmedIds: ReadonlySet<string>;
  analysis: AnalysisOverlay[];
  fitToken: number;
  fitBounds: SeatMapBounds | null;
  onHover: (seatId: string | null) => void;
  onToggle: (seatId: string) => void;
  canSelect: (seatId: string) => boolean;
};

function toRenderStatus(
  seatId: string,
  selected: ReadonlySet<string>,
  statusBySeat: Readonly<Record<string, string>>,
  dimmedIds: ReadonlySet<string>,
): SeatRenderStatus {
  if (selected.has(seatId)) return 'selected';
  const st = statusBySeat[seatId];
  if (st === 'sold') return 'sold';
  if (st === 'held') return 'held';
  if (dimmedIds.has(seatId)) return 'dimmed';
  return 'available';
}

/**
 * Viewport GPU del mapa: WebGL2 instancing con fallback Canvas2D.
 * Lifecycle estricto — `destroy()` en unmount para liberar RAF/GL.
 */
export function GpuViewport({
  map,
  selected,
  statusBySeat,
  offers,
  colorMode,
  priceBySeatId,
  sightlineBySeatId,
  priceRange,
  dimmedIds,
  analysis,
  fitToken,
  fitBounds,
  onHover,
  onToggle,
  canSelect,
}: GpuViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SeatMapRenderer | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
  } | null>(null);
  const selectedRef = useRef(selected);
  const canSelectRef = useRef(canSelect);
  const onToggleRef = useRef(onToggle);
  const onHoverRef = useRef(onHover);

  selectedRef.current = selected;
  canSelectRef.current = canSelect;
  onToggleRef.current = onToggle;
  onHoverRef.current = onHover;

  // Mount once. Destroy on unmount — critical for GPU/RAF leaks.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new SeatMapRenderer({
      background: '#0a0a0c',
      minZoom: 0.08,
      maxZoom: 12,
      seatRadius: 6,
    });
    renderer.mount(canvas);
    renderer.setLayerVisibility('grid', false);
    renderer.setLayerVisibility('guides', false);
    rendererRef.current = renderer;

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Full scene rebuild when the map identity changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const selectedSet = new Set(selectedRef.current);
    const statusMap: Record<string, SeatRenderStatus> = {};
    for (const sec of map.sections) {
      for (const seat of sec.seats) {
        statusMap[seat.id] = toRenderStatus(
          seat.id,
          selectedSet,
          statusBySeat,
          dimmedIds,
        );
      }
    }
    const ctx: ColorModeContext = {
      statusBySeatId: statusMap,
      priceBySeatId,
      sightlineBySeatId: sightlineBySeatId ?? undefined,
      offers: [...offers],
      selectedIds: selectedSet,
      priceRange: priceRange.max > priceRange.min ? priceRange : undefined,
    };
    renderer.setScene(map, { colorMode, colorContext: ctx });
    renderer.setAnalysisOverlays(analysis);
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps -- full rebuild only on map change

  // Incremental color / selection / inventory updates.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.getScene()) return;
    const selectedSet = new Set(selected);
    const statusMap: Record<string, SeatRenderStatus> = {};
    const scene = renderer.getScene();
    if (!scene) return;
    for (const id of scene.seatIds) {
      statusMap[id] = toRenderStatus(id, selectedSet, statusBySeat, dimmedIds);
    }
    renderer.setColorMode(colorMode, {
      statusBySeatId: statusMap,
      priceBySeatId,
      sightlineBySeatId: sightlineBySeatId ?? undefined,
      offers: [...offers],
      selectedIds: selectedSet,
      priceRange: priceRange.max > priceRange.min ? priceRange : undefined,
    });
    renderer.setInteractionOverlay({
      selectedIds: selectedSet,
      hoverSeatId: null,
    });
  }, [
    selected,
    statusBySeat,
    dimmedIds,
    colorMode,
    priceBySeatId,
    sightlineBySeatId,
    offers,
    priceRange,
  ]);

  useEffect(() => {
    rendererRef.current?.setAnalysisOverlays(analysis);
  }, [analysis]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !fitBounds) return;
    renderer.camera.fitToBounds(fitBounds, 48, true);
  }, [fitToken, fitBounds]);

  function clientToCanvas(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const renderer = rendererRef.current;
    if (!renderer) return;
    const screen = clientToCanvas(e.clientX, e.clientY);
    renderer.camera.zoomAtScreen(screen, e.deltaY > 0 ? 0.9 : 1.1, false);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.camera.stopInertia();
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
      if (dragRef.current.moved) {
        const now = performance.now();
        const dt = Math.max(1, now - dragRef.current.lastT);
        // panByScreen: positive dx moves content right → camera pans opposite.
        renderer.camera.panByScreen(e.clientX - dragRef.current.lastX, e.clientY - dragRef.current.lastY);
        dragRef.current.vx = (e.clientX - dragRef.current.lastX) / dt;
        dragRef.current.vy = (e.clientY - dragRef.current.lastY) / dt;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        dragRef.current.lastT = now;
      }
      return;
    }

    const hit = renderer.hitTest(clientToCanvas(e.clientX, e.clientY));
    onHoverRef.current(hit?.seatId ?? null);
    renderer.setInteractionOverlay({
      selectedIds: selectedRef.current,
      hoverSeatId: hit?.seatId ?? null,
    });
  }

  function onPointerUp(e: ReactPointerEvent) {
    const renderer = rendererRef.current;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!renderer) return;

    if (drag?.moved) {
      // Screen px/ms → world units/ms for inertia.
      const zoom = renderer.camera.zoom || 1;
      renderer.camera.settleInertia(-drag.vx / zoom, -drag.vy / zoom);
      return;
    }

    const hit = renderer.hitTest(clientToCanvas(e.clientX, e.clientY));
    if (!hit) return;
    if (!canSelectRef.current(hit.seatId)) return;
    onToggleRef.current(hit.seatId);
  }

  function onPointerLeave() {
    onHoverRef.current(null);
    rendererRef.current?.setInteractionOverlay({
      selectedIds: selectedRef.current,
      hoverSeatId: null,
    });
  }

  function zoomBy(factor: number) {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    renderer.camera.zoomAtScreen({ x: rect.width / 2, y: rect.height / 2 }, factor, true);
  }

  function fitAll() {
    const renderer = rendererRef.current;
    const scene = renderer?.getScene();
    if (!renderer || !scene) return;
    renderer.camera.fitToBounds(scene.bounds, 48, true);
  }

  // Expose zoom helpers via data attributes + custom events from parent toolbar.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onZoomIn = () => zoomBy(1.2);
    const onZoomOut = () => zoomBy(1 / 1.2);
    const onFit = () => fitAll();
    host.addEventListener('seatmap:zoom-in', onZoomIn);
    host.addEventListener('seatmap:zoom-out', onZoomOut);
    host.addEventListener('seatmap:fit', onFit);
    return () => {
      host.removeEventListener('seatmap:zoom-in', onZoomIn);
      host.removeEventListener('seatmap:zoom-out', onZoomOut);
      host.removeEventListener('seatmap:fit', onFit);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={styles.viewport}
      data-seatmap-viewport
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <div className={styles.stageBanner}>
        <span>Escenario</span>
      </div>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Mapa de asientos interactivo"
      />
      <p className={styles.hint}>Scroll zoom · Arrastra pan · Toca un asiento</p>
    </div>
  );
}

export function dispatchSeatMapCommand(
  command: 'zoom-in' | 'zoom-out' | 'fit',
): void {
  const host = document.querySelector('[data-seatmap-viewport]');
  host?.dispatchEvent(new Event(`seatmap:${command}`));
}
