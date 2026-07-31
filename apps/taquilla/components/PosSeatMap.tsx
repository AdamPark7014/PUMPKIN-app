'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  calculateSightlines,
  normalizeSeatMap,
  projectTo2D,
  resolveGeometry,
  sightlineHeatColor,
  priceHeatColor,
  buildEgressPathOverlays,
} from '@boletera/venue-engine';
import styles from './PosSeatMap.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
/** Above this seat count, seats render on canvas (SVG stays for venue chrome). */
const CANVAS_SEAT_THRESHOLD = 64;
const SEAT_HALF_W = 7;
const SEAT_HALF_H = 6;

type HeatMode = 'off' | 'price' | 'view';

type MapData = {
  version?: number;
  sections?: {
    id?: string;
    name?: string;
    slug?: string;
    zone?: string;
    color?: string;
    seats?: { id: string; label?: string; x: number; y: number; rotation?: number }[];
  }[];
  viewport?: { minX?: number; minY?: number; width?: number; height?: number };
};

type OfferRow = { id: string; zone: string; name?: string; basePrice: string | number };

type SeatView = {
  id: string;
  sectionId: string;
  levelId?: string;
  x: number;
  y: number;
  rotation?: number;
  label: string;
  color?: string;
  sectionName: string;
  sectionColor: string;
  price?: number;
  visibility?: {
    blocked?: boolean;
    restrictedView?: boolean;
    premiumView?: boolean;
  };
};

type PosSeatMapProps = {
  eventId: string;
  mapData: MapData | null;
  selected: string[];
  onToggle: (seatId: string) => void;
  offers?: OfferRow[];
};

function statusesEqual(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function seatFillColor(
  seat: SeatView,
  status: string | undefined,
  isSelected: boolean,
  heatMode: HeatMode,
  priceRange: { min: number; max: number },
  priceCap: number | null,
  viewScore: number | undefined,
): string {
  const blocked = Boolean(seat.visibility?.blocked);
  const price = typeof seat.price === 'number' ? seat.price : 0;
  const overBudget = priceCap != null && price > priceCap;
  if (isSelected) return '#e11d48';
  if (blocked || status === 'sold') return '#3f3f46';
  if (status === 'held') return '#d4a017';
  if (overBudget) return '#2a2a2e';
  if (heatMode === 'price' && price > 0 && priceRange.max > 0) {
    return priceHeatColor(price, priceRange.min, priceRange.max);
  }
  if (heatMode === 'view' && viewScore != null) return sightlineHeatColor(viewScore);
  if (seat.visibility?.premiumView) return '#d4a017';
  return seat.sectionColor;
}

function isSeatDisabled(
  seat: SeatView,
  status: string | undefined,
  priceCap: number | null,
): boolean {
  const blocked = Boolean(seat.visibility?.blocked);
  const price = typeof seat.price === 'number' ? seat.price : 0;
  const overBudget = priceCap != null && price > priceCap;
  return status === 'sold' || status === 'held' || blocked || overBudget;
}

/** Simple uniform grid for O(1)-ish hit tests on dense maps. */
function buildSeatGrid(seats: SeatView[], cell = 28) {
  const grid = new Map<string, string[]>();
  for (const s of seats) {
    const cx = Math.floor(s.x / cell);
    const cy = Math.floor(s.y / cell);
    const key = `${cx}:${cy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(s.id);
    else grid.set(key, [s.id]);
  }
  return { grid, cell };
}

function hitTestSeat(
  worldX: number,
  worldY: number,
  seatsById: Map<string, SeatView>,
  index: ReturnType<typeof buildSeatGrid>,
): string | null {
  const { grid, cell } = index;
  const cx = Math.floor(worldX / cell);
  const cy = Math.floor(worldY / cell);
  let best: string | null = null;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = grid.get(`${cx + dx}:${cy + dy}`);
      if (!bucket) continue;
      for (const id of bucket) {
        const s = seatsById.get(id);
        if (!s) continue;
        const ddx = worldX - s.x;
        const ddy = worldY - s.y;
        if (Math.abs(ddx) <= SEAT_HALF_W + 2 && Math.abs(ddy) <= SEAT_HALF_H + 2) {
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
  }
  return best;
}

type SeatLayerProps = {
  seats: SeatView[];
  statusBySeat: Record<string, string>;
  selectedSet: Set<string>;
  heatMode: HeatMode;
  priceRange: { min: number; max: number };
  priceCap: number | null;
  sightlineBySeat: Map<string, number> | null;
  focusedId: string | null;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  useCanvas: boolean;
  scale: number;
  tx: number;
  ty: number;
  levelFilter: string | 'ALL';
};

const SvgSeatLayer = memo(function SvgSeatLayer({
  seats,
  statusBySeat,
  selectedSet,
  heatMode,
  priceRange,
  priceCap,
  sightlineBySeat,
  onFocus,
  onToggle,
  levelFilter,
}: Omit<SeatLayerProps, 'useCanvas' | 'scale' | 'tx' | 'ty' | 'focusedId'>) {
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent, seatId: string, disabled: boolean) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(seatId);
      }
    },
    [onToggle],
  );

  const layerSeats = useMemo(
    () =>
      levelFilter === 'ALL'
        ? seats
        : seats.filter((s) => (s.levelId ?? '') === levelFilter),
    [seats, levelFilter],
  );

  return (
    <>
      {layerSeats.map((s) => {
        const st = statusBySeat[s.id];
        const disabled = isSeatDisabled(s, st, priceCap);
        const isSelected = selectedSet.has(s.id);
        const restricted = Boolean(s.visibility?.restrictedView);
        const fill = seatFillColor(
          s,
          st,
          isSelected,
          heatMode,
          priceRange,
          priceCap,
          sightlineBySeat?.get(s.id),
        );
        const blocked = Boolean(s.visibility?.blocked);
        const price = typeof s.price === 'number' ? s.price : 0;
        const overBudget = priceCap != null && price > priceCap;
        return (
          <g
            key={s.id}
            transform={`translate(${s.x} ${s.y}) rotate(${s.rotation ?? 0})`}
            opacity={blocked || overBudget ? 0.4 : 1}
          >
            <rect
              x={-SEAT_HALF_W}
              y={-SEAT_HALF_H}
              width={SEAT_HALF_W * 2}
              height={SEAT_HALF_H * 2}
              rx={2}
              fill={fill}
              stroke={isSelected ? '#fff' : restricted ? 'rgba(148,163,184,0.9)' : 'transparent'}
              strokeWidth={1.5}
              strokeDasharray={restricted ? '2 1.5' : undefined}
              className={disabled ? styles.seatDisabled : styles.seat}
              tabIndex={disabled ? -1 : 0}
              role="button"
              aria-label={s.label}
              aria-pressed={isSelected}
              aria-disabled={disabled}
              onFocus={() => onFocus(s.id)}
              onClick={() => !disabled && onToggle(s.id)}
              onKeyDown={(e) => onKeyDown(e, s.id, disabled)}
            />
          </g>
        );
      })}
    </>
  );
});

const CanvasSeatLayer = memo(function CanvasSeatLayer({
  seats,
  statusBySeat,
  selectedSet,
  heatMode,
  priceRange,
  priceCap,
  sightlineBySeat,
  focusedId,
  onFocus,
  onToggle,
  scale,
  tx,
  ty,
  levelFilter,
}: Omit<SeatLayerProps, 'useCanvas'>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seatsById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const visible = useMemo(
    () => (levelFilter === 'ALL' ? seats : seats.filter((s) => (s.levelId ?? '') === levelFilter)),
    [seats, levelFilter],
  );
  const index = useMemo(() => buildSeatGrid(visible), [visible]);
  const drawGen = useRef(0);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const gen = ++drawGen.current;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx || gen !== drawGen.current) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    for (const s of visible) {
      const st = statusBySeat[s.id];
      const disabled = isSeatDisabled(s, st, priceCap);
      const isSelected = selectedSet.has(s.id);
      const restricted = Boolean(s.visibility?.restrictedView);
      const blocked = Boolean(s.visibility?.blocked);
      const price = typeof s.price === 'number' ? s.price : 0;
      const overBudget = priceCap != null && price > priceCap;
      const fill = seatFillColor(
        s,
        st,
        isSelected,
        heatMode,
        priceRange,
        priceCap,
        sightlineBySeat?.get(s.id),
      );

      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.rotation) ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.globalAlpha = blocked || overBudget ? 0.4 : disabled && !isSelected ? 0.55 : 1;
      ctx.beginPath();
      const r = 2;
      const x = -SEAT_HALF_W;
      const y = -SEAT_HALF_H;
      const bw = SEAT_HALF_W * 2;
      const bh = SEAT_HALF_H * 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, r);
      ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + bw, y, r);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (isSelected || restricted || focusedId === s.id) {
        ctx.strokeStyle = isSelected || focusedId === s.id ? '#fff' : 'rgba(148,163,184,0.9)';
        ctx.lineWidth = 1.5 / Math.max(scale, 0.5);
        if (restricted && !isSelected) ctx.setLineDash([2, 1.5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    ctx.restore();
  }, [
    visible,
    statusBySeat,
    selectedSet,
    heatMode,
    priceRange,
    priceCap,
    sightlineBySeat,
    focusedId,
    scale,
    tx,
    ty,
  ]);

  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(paint);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      if (scale === 0) return null;
      return { x: (sx - tx) / scale, y: (sy - ty) / scale };
    },
    [scale, tx, ty],
  );

  const lastToggleRef = useRef<{ id: string; at: number } | null>(null);

  const onPointer = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const world = toWorld(e.clientX, e.clientY);
      if (!world) return;
      const id = hitTestSeat(world.x, world.y, seatsById, index);
      if (!id) return;
      const seat = seatsById.get(id);
      if (!seat) return;
      onFocus(id);
      if (isSeatDisabled(seat, statusBySeat[id], priceCap)) return;
      const now = performance.now();
      const last = lastToggleRef.current;
      if (last && last.id === id && now - last.at < 280) return;
      lastToggleRef.current = { id, at: now };
      e.preventDefault();
      onToggle(id);
    },
    [toWorld, seatsById, index, onFocus, onToggle, statusBySeat, priceCap],
  );

  const focused = focusedId ? seatsById.get(focusedId) : undefined;
  const focusedDisabled = focused ? isSeatDisabled(focused, statusBySeat[focused.id], priceCap) : true;

  const onKeyNav = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!visible.length) return;
      const idx = focusedId ? visible.findIndex((s) => s.id === focusedId) : -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = visible[(idx + 1 + visible.length) % visible.length];
        onFocus(next.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = visible[(idx - 1 + visible.length) % visible.length];
        onFocus(next.id);
      } else if ((e.key === 'Enter' || e.key === ' ') && focusedId && !focusedDisabled) {
        e.preventDefault();
        onToggle(focusedId);
      }
    },
    [visible, focusedId, focusedDisabled, onFocus, onToggle],
  );

  return (
    <div ref={wrapRef} className={styles.canvasLayer}>
      <canvas
        ref={canvasRef}
        className={styles.seatCanvas}
        onPointerDown={onPointer}
        aria-hidden
      />
      <button
        type="button"
        className={styles.canvasA11y}
        aria-label={
          focused
            ? `${focused.label}${focused.sectionName ? ` · ${focused.sectionName}` : ''}${
                focused.price != null ? ` · $${focused.price}` : ''
              }. Flechas para navegar, Enter para seleccionar.`
            : 'Mapa de asientos. Usa flechas para enfocar un asiento.'
        }
        aria-pressed={focusedId ? selectedSet.has(focusedId) : undefined}
        aria-disabled={focusedDisabled}
        onKeyDown={onKeyNav}
        onClick={() => {
          if (focusedId && !focusedDisabled) onToggle(focusedId);
        }}
      />
    </div>
  );
});

export const PosSeatMap = memo(function PosSeatMap({
  eventId,
  mapData,
  selected,
  onToggle,
  offers = [],
}: PosSeatMapProps) {
  const [statusBySeat, setStatusBySeat] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [heatMode, setHeatMode] = useState<HeatMode>('off');
  const [showEgress, setShowEgress] = useState(false);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(statusBySeat);
  const availabilityInFlight = useRef(false);
  const availabilityDirty = useRef(false);
  statusRef.current = statusBySeat;

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const map = useMemo(() => normalizeSeatMap(mapData ?? { sections: [] }), [mapData]);
  const scene = useMemo(() => resolveGeometry(map), [map]);
  const projected = useMemo(() => projectTo2D(scene), [scene]);
  const bounds = useMemo(() => projected.bounds, [projected.bounds]);

  const offersKey = useMemo(
    () => offers.map((o) => `${o.id}:${o.zone}:${o.basePrice}`).join('|'),
    [offers],
  );

  const seats: SeatView[] = useMemo(() => {
    return projected.seats.map((s) => {
      const section = map.sections.find((sec) => sec.id === s.sectionId);
      const offer =
        offers.find(
          (o) =>
            o.zone.toLowerCase() === (section?.slug ?? '').toLowerCase() ||
            o.zone.toLowerCase() === (section?.name ?? '').toLowerCase(),
        ) ?? null;
      return {
        id: s.id,
        sectionId: s.sectionId,
        levelId: s.levelId,
        x: s.x,
        y: s.y,
        rotation: s.rotation,
        label: s.label,
        color: s.color,
        sectionName: section?.name ?? s.sectionId,
        sectionColor: s.color || section?.color || '#5b9fd4',
        price: offer ? Number(offer.basePrice) : undefined,
        visibility: s.visibility,
      };
    });
    // offersKey captures offers content without unstable array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projected.seats, map.sections, offersKey]);

  const levels = useMemo(() => {
    const list = [...(map.venue?.levels ?? [])];
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }, [map.venue?.levels]);

  const visibleSeats = useMemo(() => {
    if (levelFilter === 'ALL') return seats;
    return seats.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [seats, levelFilter]);

  const useCanvas = seats.length >= CANVAS_SEAT_THRESHOLD;

  const priceRange = useMemo(() => {
    const prices = visibleSeats
      .map((s) => s.price)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [visibleSeats]);

  useEffect(() => {
    if (priceCap == null && priceRange.max > 0) setPriceCap(priceRange.max);
  }, [priceRange.max, priceCap]);

  const sightlineBySeat = useMemo(() => {
    if (heatMode !== 'view') return null;
    const result = calculateSightlines(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    return new Map(result.scores.map((s) => [s.seatId, s.score]));
  }, [heatMode, scene, levelFilter]);

  function toggleHeat(mode: Exclude<HeatMode, 'off'>) {
    setHeatMode((cur) => (cur === mode ? 'off' : mode));
  }

  const egressOverlay = useMemo(() => {
    if (!showEgress) return null;
    return buildEgressPathOverlays(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, scene, levelFilter]);

  const highlightEgressSectionId = useMemo(() => {
    if (!egressOverlay?.paths.length) return null;
    if (selected.length) {
      const seat = seats.find((s) => s.id === selected[0]);
      if (seat?.sectionId) return seat.sectionId;
    }
    return egressOverlay.paths[0]?.sectionId ?? null;
  }, [egressOverlay, selected, seats]);

  const counts = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const s of visibleSeats) {
      const st = statusBySeat[s.id];
      if (st === 'sold') sold += 1;
      else if (st === 'held') held += 1;
      else available += 1;
    }
    return { available, held, sold, total: visibleSeats.length };
  }, [visibleSeats, statusBySeat]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !seats.length) return;
    const pad = 20;
    const vw = el.clientWidth - pad * 2;
    const vh = el.clientHeight - pad * 2;
    if (vw <= 0 || vh <= 0) return;
    const next = Math.min(vw / bounds.width, vh / bounds.height, 2.4);
    setScale(next);
    setTx(el.clientWidth / 2 - (bounds.minX + bounds.width / 2) * next);
    setTy(el.clientHeight / 2 - (bounds.minY + bounds.height / 2) * next);
  }, [bounds, seats.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (availabilityInFlight.current) {
        availabilityDirty.current = true;
        return;
      }
      availabilityInFlight.current = true;
      try {
        const res = await fetch(`${API}/inventory/${eventId}/availability`);
        if (cancelled) return;
        if (!res.ok) {
          setConnError(`Disponibilidad HTTP ${res.status}`);
          setLive(false);
          return;
        }
        const data = (await res.json()) as {
          tickets?: Array<{ seatId?: string; status?: string }>;
        };
        const next: Record<string, string> = {};
        for (const t of data.tickets ?? []) {
          if (t.seatId) next[t.seatId] = String(t.status ?? '').toLowerCase();
        }
        if (!statusesEqual(statusRef.current, next)) {
          setStatusBySeat(next);
        }
        setConnError(null);
      } catch {
        if (!cancelled) {
          setConnError(`Sin API (${API})`);
          setLive(false);
        }
      } finally {
        availabilityInFlight.current = false;
        if (!cancelled && availabilityDirty.current) {
          availabilityDirty.current = false;
          void loadAvailability();
        }
      }
    }

    void loadAvailability();
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API}/inventory/${eventId}/stream`);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.onmessage = () => void loadAvailability();
    } catch {
      setLive(false);
    }
    // Live SSE already pushes updates; poll is a resilient backstop.
    const poll = setInterval(() => void loadAvailability(), 6000);
    const onVis = () => {
      if (!document.hidden) void loadAvailability();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      es?.close();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [eventId]);

  const onFocus = useCallback((id: string) => setFocusedId(id), []);

  if (!seats.length) {
    return <p className={styles.empty}>Sin mapa — usa venta por zona.</p>;
  }

  const focused = seats.find((s) => s.id === focusedId);

  return (
    <div className={styles.wrap}>
      {connError && (
        <p className={styles.connError} role="alert">
          {connError}
        </p>
      )}
      <div className={styles.toolbar}>
        <ul className={styles.legend}>
          <li>
            <span className={`${styles.dot} ${styles.dotAvailable}`} /> Disp. <em>{counts.available}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotHeld}`} /> Hold <em>{counts.held}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotSold}`} /> Vend. <em>{counts.sold}</em>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotSelected}`} /> Sel. <em>{selected.length}</em>
          </li>
        </ul>
        {levels.length > 0 && (
          <div className={styles.levelBar} role="toolbar" aria-label="Niveles">
            <button
              type="button"
              className={levelFilter === 'ALL' ? styles.levelActive : styles.levelBtn}
              onClick={() => setLevelFilter('ALL')}
            >
              Todos
            </button>
            {levels.map((lv) => (
              <button
                key={lv.id}
                type="button"
                className={levelFilter === lv.id ? styles.levelActive : styles.levelBtn}
                onClick={() => setLevelFilter(lv.id)}
              >
                {lv.name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={heatMode === 'price' ? styles.levelActive : styles.levelBtn}
          onClick={() => toggleHeat('price')}
          aria-pressed={heatMode === 'price'}
          title="Colorea asientos por precio de oferta"
          disabled={!(priceRange.max > 0)}
        >
          Precio
        </button>
        <button
          type="button"
          className={heatMode === 'view' ? styles.levelActive : styles.levelBtn}
          onClick={() => toggleHeat('view')}
          aria-pressed={heatMode === 'view'}
          title="Colorea asientos por calidad de vista"
        >
          Vista
        </button>
        <button
          type="button"
          className={showEgress ? styles.levelActive : styles.levelBtn}
          onClick={() => setShowEgress((v) => !v)}
          aria-pressed={showEgress}
          aria-controls="pos-egress-legend pos-egress-status"
          title="Rutas de salida por sección"
          disabled={!(projected.aisles.length || projected.exits.length || projected.stairs.length)}
        >
          Salidas
        </button>
        <span className={live ? styles.liveOn : styles.liveOff}>
          {live ? 'En vivo' : 'Polling'}
          {useCanvas ? ' · Canvas' : ''}
        </span>
      </div>

      {heatMode === 'price' && priceRange.max > 0 && (
        <div className={styles.priceHeatPanel}>
          <div className={styles.viewHeatBar} aria-hidden>
            <span>${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
            <div className={styles.priceHeatScale} />
            <span>${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
          </div>
          {priceRange.max > priceRange.min && (
            <label className={styles.priceFilter}>
              Máx. $
              {((priceCap ?? priceRange.max) || 0).toLocaleString('es-MX', {
                maximumFractionDigits: 0,
              })}
              <input
                type="range"
                min={priceRange.min}
                max={priceRange.max}
                step={Math.max(1, Math.round((priceRange.max - priceRange.min) / 20))}
                value={priceCap ?? priceRange.max}
                onChange={(e) => setPriceCap(Number(e.target.value))}
                aria-label="Precio máximo"
              />
            </label>
          )}
        </div>
      )}
      {heatMode === 'view' && (
        <div className={styles.viewHeatBar} aria-hidden>
          <span>Restringida</span>
          <div className={styles.viewHeatScale} />
          <span>Premium</span>
        </div>
      )}
      {showEgress && (
        <ul id="pos-egress-legend" className={styles.egressLegend} aria-label="Leyenda de salidas">
          <li>
            <span className={`${styles.swatch} ${styles.swatchExit}`} aria-hidden />
            Salida
          </li>
          <li>
            <span className={`${styles.swatch} ${styles.swatchRoute}`} aria-hidden />
            Ruta
          </li>
          <li>
            <span className={`${styles.swatch} ${styles.swatchRouteActive}`} aria-hidden />
            Activa
          </li>
          <li>
            <span className={`${styles.swatch} ${styles.swatchBottleneck}`} aria-hidden />
            Cuello
          </li>
        </ul>
      )}
      {showEgress && egressOverlay && (
        <p id="pos-egress-status" className={styles.egressHint} role="status" aria-live="polite">
          {egressOverlay.hasNetwork
            ? `Rutas · ${egressOverlay.paths.length} sec.${
                egressOverlay.clearanceMinutes != null
                  ? ` · ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                  : ''
              }`
            : 'Sin red de egreso'}
        </p>
      )}

      <div ref={viewportRef} className={styles.mapShell}>
        <p className={styles.stage}>Escenario</p>
        <svg
          className={styles.map}
          role="img"
          aria-label={showEgress ? 'Mapa POS con rutas de salida' : 'Mapa POS'}
          aria-describedby={showEgress ? 'pos-egress-legend pos-egress-status' : undefined}
        >
          <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
            {projected.stage ? (
              <rect
                x={projected.stage.x}
                y={projected.stage.y}
                width={projected.stage.width}
                height={18}
                rx={2}
                className={styles.stageRect}
              />
            ) : (
              <rect
                x={bounds.minX + (bounds.width - bounds.width * 0.42) / 2}
                y={bounds.minY - 32}
                width={bounds.width * 0.42}
                height={18}
                rx={2}
                className={styles.stageRect}
              />
            )}
            {projected.aisles.map((aisle) => {
              if (levelFilter !== 'ALL' && aisle.levelId && aisle.levelId !== levelFilter) {
                return null;
              }
              return (
                <polyline
                  key={aisle.id}
                  points={aisle.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(148,163,184,0.4)"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
            {projected.obstacles.map((obs) => {
              if (levelFilter !== 'ALL' && obs.levelId && obs.levelId !== levelFilter) {
                return null;
              }
              return (
                <polygon
                  key={obs.id}
                  points={obs.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="rgba(63,63,70,0.5)"
                  stroke="rgba(161,161,170,0.45)"
                  strokeWidth={1}
                />
              );
            })}
            {projected.stairs.map((stair) => {
              if (
                levelFilter !== 'ALL' &&
                stair.fromLevelId &&
                stair.toLevelId &&
                stair.fromLevelId !== levelFilter &&
                stair.toLevelId !== levelFilter
              ) {
                return null;
              }
              return (
                <polyline
                  key={stair.id}
                  points={stair.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(251,146,60,0.75)"
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="8 5"
                />
              );
            })}
            {projected.exits.map((ex) => {
              if (levelFilter !== 'ALL' && ex.levelId && ex.levelId !== levelFilter) return null;
              if (!ex.points.length) return null;
              const [x, y] = ex.points[0];
              const r = Math.max((ex.width ?? 32) * 0.28, 7);
              return (
                <g key={ex.id} style={{ pointerEvents: 'none' }}>
                  {ex.points.length >= 2 ? (
                    <polyline
                      points={ex.points.map(([px, py]) => `${px},${py}`).join(' ')}
                      fill="none"
                      stroke="rgba(34,197,94,0.5)"
                      strokeWidth={ex.width ?? 28}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill="rgba(34,197,94,0.9)"
                    stroke="#14532d"
                    strokeWidth={1.5}
                  />
                  <text
                    x={x}
                    y={y - r - 3}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={700}
                    fill="#bbf7d0"
                  >
                    {ex.label ?? 'Salida'}
                  </text>
                </g>
              );
            })}
            {showEgress &&
              egressOverlay?.paths.map((path) => {
                const active = path.sectionId === highlightEgressSectionId;
                return (
                  <polyline
                    key={`egress-${path.sectionId}`}
                    points={path.points.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={active ? '#f472b6' : 'rgba(244,114,182,0.4)'}
                    strokeWidth={active ? 5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={active ? '10 6' : '6 5'}
                    opacity={active ? 0.95 : 0.55}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}
            {showEgress &&
              egressOverlay?.bottlenecks.map((b) => (
                <polyline
                  key={`bn-${b.edgeId}`}
                  points={b.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="rgba(251,146,60,0.9)"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.85}
                  style={{ pointerEvents: 'none' }}
                />
              ))}

            {projected.furniture.map((item) => {
              if (levelFilter !== 'ALL' && item.levelId && item.levelId !== levelFilter) {
                return null;
              }
              if (item.type === 'led') {
                return (
                  <g
                    key={item.id}
                    transform={`translate(${item.x} ${item.y})`}
                    style={{ pointerEvents: 'none' }}
                  >
                    <rect
                      x={-26}
                      y={-8}
                      width={52}
                      height={16}
                      rx={2}
                      fill="#1a0510"
                      stroke="#be123c"
                      strokeWidth={1}
                    />
                    <rect x={-22} y={-5} width={44} height={10} rx={1} fill="#be123c" opacity={0.55} />
                    <text y={-12} textAnchor="middle" fontSize={7} fontWeight={700} fill="#fda4af">
                      LED
                    </text>
                  </g>
                );
              }
              if (item.type === 'speaker') {
                return (
                  <g
                    key={item.id}
                    transform={`translate(${item.x} ${item.y})`}
                    style={{ pointerEvents: 'none' }}
                  >
                    <rect
                      x={-7}
                      y={-10}
                      width={14}
                      height={20}
                      rx={2}
                      fill="#0f0f12"
                      stroke="#404040"
                      strokeWidth={1}
                    />
                    <circle cx={0} cy={-4} r={3.4} fill="#27272a" />
                    <circle cx={0} cy={5} r={2.4} fill="#27272a" />
                  </g>
                );
              }
              if (item.type === 'door') {
                return (
                  <g
                    key={item.id}
                    transform={`translate(${item.x} ${item.y})`}
                    style={{ pointerEvents: 'none' }}
                  >
                    <rect
                      x={-10}
                      y={-4}
                      width={20}
                      height={8}
                      rx={1}
                      fill="rgba(34,197,94,0.35)"
                      stroke="#22c55e"
                      strokeWidth={1.2}
                    />
                    <text y={-8} textAnchor="middle" fontSize={7} fill="#86efac" fontWeight={700}>
                      Puerta
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {(map.venue?.focusPoints ?? []).map((f) => {
              if (levelFilter !== 'ALL' && f.levelId && f.levelId !== levelFilter) return null;
              return (
                <g key={f.id} style={{ pointerEvents: 'none' }}>
                  <circle
                    cx={f.x}
                    cy={f.y}
                    r={6}
                    fill="rgba(250,250,250,0.92)"
                    stroke="#e11d48"
                    strokeWidth={2}
                  />
                  <text
                    x={f.x}
                    y={f.y - 10}
                    textAnchor="middle"
                    fontSize={8}
                    fontWeight={700}
                    fill="#fecdd3"
                  >
                    {f.label ?? 'Foco'}
                  </text>
                </g>
              );
            })}

            {map.sections.map((sec) => {
              if (!sec.seats.length) return null;
              if (levelFilter !== 'ALL' && (sec.levelId ?? '') !== levelFilter) return null;
              const xs = sec.seats.map((s) => s.x);
              const ys = sec.seats.map((s) => s.y);
              const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
              const ly = Math.min(...ys) - 16;
              return (
                <text
                  key={sec.id}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  className={styles.sectionLabel}
                  fill={sec.color || '#a1a1aa'}
                >
                  {sec.name}
                </text>
              );
            })}

            {!useCanvas && (
              <SvgSeatLayer
                seats={seats}
                statusBySeat={statusBySeat}
                selectedSet={selectedSet}
                heatMode={heatMode}
                priceRange={priceRange}
                priceCap={priceCap}
                sightlineBySeat={sightlineBySeat}
                onFocus={onFocus}
                onToggle={onToggle}
                levelFilter={levelFilter}
              />
            )}
          </g>
        </svg>

        {useCanvas && (
          <CanvasSeatLayer
            seats={seats}
            statusBySeat={statusBySeat}
            selectedSet={selectedSet}
            heatMode={heatMode}
            priceRange={priceRange}
            priceCap={priceCap}
            sightlineBySeat={sightlineBySeat}
            focusedId={focusedId}
            onFocus={onFocus}
            onToggle={onToggle}
            scale={scale}
            tx={tx}
            ty={ty}
            levelFilter={levelFilter}
          />
        )}
      </div>

      <p className={styles.focusHint}>
        {focused
          ? `${focused.label}${focused.sectionName ? ` · ${focused.sectionName}` : ''}${
              focused.price != null
                ? ` · $${focused.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`
                : ''
            }`
          : useCanvas
            ? 'Toca asientos · flechas/Enter en foco del mapa'
            : 'Selecciona asientos · mismo mapa que web (DB)'}
      </p>
    </div>
  );
});
