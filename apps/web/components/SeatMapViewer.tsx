'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  SEAT_STATUS_COLORS,
  flatSeats,
  normalizeSeatMap,
  priceHeatColor,
  sightlineHeatColor,
  calculateSightlines,
  projectTo2D,
  resolveGeometry,
  resolveOfferForSection,
  sectionBounds,
  buildEgressPathOverlays,
} from '@boletera/venue-engine';
import styles from './SeatMapViewer.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Offer = { id: string; zone: string; name?: string; basePrice: string };

export type SelectedSeatInfo = {
  seatId: string;
  label: string;
  sectionName: string;
  sectionSlug: string;
  price: number;
  offerId: string;
};

export function SeatMapViewer({
  eventId,
  mapData,
  selected,
  onToggle,
  onClear,
  offers = [],
  maxSelect = 8,
  currency = 'MXN',
  heatDefault = false,
  focusZone,
}: {
  eventId: string;
  mapData: unknown;
  selected: string[];
  onToggle: (seatId: string) => void;
  onClear?: () => void;
  offers?: Offer[];
  maxSelect?: number;
  currency?: string;
  heatDefault?: boolean;
  /** Offer zone / section slug to pre-filter the map */
  focusZone?: string | null;
}) {
  const map = useMemo(() => normalizeSeatMap(mapData), [mapData]);
  const scene = useMemo(() => resolveGeometry(map), [map]);
  const projected = useMemo(() => projectTo2D(scene), [scene]);
  const bounds = useMemo(() => projected.bounds, [projected.bounds]);
  const seats = useMemo(() => {
    const byId = new Map(flatSeats(scene.map).map((s) => [s.id, s]));
    return projected.seats.map((p) => {
      const full = byId.get(p.id);
      return {
        ...p,
        sectionName: full?.sectionName ?? p.sectionId,
        sectionColor: p.color,
        row: p.row ?? full?.row,
        visibility: p.visibility,
      };
    });
  }, [projected.seats, scene.map]);
  const stage = useMemo(() => {
    if (projected.stage) return projected.stage;
    const width = bounds.width * 0.42;
    return {
      x: bounds.minX + (bounds.width - width) / 2,
      y: bounds.minY - 34,
      width,
    };
  }, [projected.stage, bounds]);
  const furniture = projected.furniture;
  const aisles = projected.aisles;
  const obstacles = projected.obstacles;
  const stairs = projected.stairs;
  const exits = projected.exits;

  const [statusBySeat, setStatusBySeat] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [sectionFilter, setSectionFilter] = useState<string | 'ALL'>('ALL');
  const [heatMode, setHeatMode] = useState<'off' | 'price' | 'view'>(
    heatDefault ? 'price' : 'off',
  );
  const [showEgress, setShowEgress] = useState(false);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});
  const statusRef = useRef<Record<string, string>>({});

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const sectionMeta = useMemo(() => {
    const m = new Map<string, { slug: string; name: string }>();
    for (const sec of map.sections) m.set(sec.id, { slug: sec.slug, name: sec.name });
    return m;
  }, [map.sections]);

  const priceOf = useCallback(
    (sectionId: string) => {
      const meta = sectionMeta.get(sectionId);
      const offer = resolveOfferForSection(offers, meta?.slug ?? '', meta?.name);
      return offer ? Number(offer.basePrice) : 0;
    },
    [offers, sectionMeta],
  );

  const priceRange = useMemo(() => {
    const prices = map.sections
      .map((s) => priceOf(s.id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [map.sections, priceOf]);

  const sightlineBySeat = useMemo(() => {
    if (heatMode !== 'view') return null;
    const result = calculateSightlines(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    return new Map(result.scores.map((s) => [s.seatId, s]));
  }, [heatMode, scene, levelFilter]);

  const egressOverlay = useMemo(() => {
    if (!showEgress) return null;
    return buildEgressPathOverlays(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, scene, levelFilter]);

  const highlightEgressSectionId = useMemo(() => {
    if (!egressOverlay?.paths.length) return null;
    if (sectionFilter !== 'ALL') return sectionFilter;
    if (focusZone) {
      const match = map.sections.find(
        (s) =>
          s.slug === focusZone ||
          s.name.toLowerCase() === focusZone.toLowerCase() ||
          s.id === focusZone,
      );
      if (match) return match.id;
    }
    if (selected.length) {
      const seat = seats.find((s) => s.id === selected[0]);
      if (seat?.sectionId) return seat.sectionId;
    }
    return egressOverlay.paths[0]?.sectionId ?? null;
  }, [egressOverlay, sectionFilter, focusZone, map.sections, selected, seats]);

  useEffect(() => {
    if (priceCap == null && priceRange.max > 0) setPriceCap(priceRange.max);
  }, [priceRange.max, priceCap]);

  useEffect(() => {
    if (!focusZone) return;
    const needle = focusZone.toLowerCase();
    const match = map.sections.find(
      (s) =>
        s.slug.toLowerCase() === needle ||
        s.name.toLowerCase() === needle ||
        s.name.toLowerCase().includes(needle) ||
        s.slug.toLowerCase().includes(needle),
    );
    if (match) setSectionFilter(match.id);
  }, [focusZone, map.sections]);

  const selectedInfo: SelectedSeatInfo[] = useMemo(() => {
    return selected
      .map((id) => {
        const seat = seats.find((s) => s.id === id);
        if (!seat) return null;
        const meta = sectionMeta.get(seat.sectionId);
        const offer = resolveOfferForSection(offers, meta?.slug ?? seat.sectionId, seat.sectionName);
        return {
          seatId: id,
          label: seat.label,
          sectionName: seat.sectionName,
          sectionSlug: meta?.slug ?? '',
          price: offer ? Number(offer.basePrice) : 0,
          offerId: offer?.id ?? '',
        };
      })
      .filter((x): x is SelectedSeatInfo => Boolean(x));
  }, [selected, seats, sectionMeta, offers]);

  const selectionTotal = selectedInfo.reduce((s, x) => s + x.price, 0);

  const levels = useMemo(() => {
    const list = [...(map.venue?.levels ?? [])];
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }, [map.venue?.levels]);

  const sectionLevelId = useCallback(
    (sectionId: string) => map.sections.find((s) => s.id === sectionId)?.levelId,
    [map.sections],
  );

  const visibleSections = useMemo(() => {
    if (levelFilter === 'ALL') return map.sections;
    return map.sections.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [map.sections, levelFilter]);

  const seatOnLevel = useCallback(
    (s: { sectionId: string; levelId?: string }) => {
      if (levelFilter === 'ALL') return true;
      const lid = s.levelId ?? sectionLevelId(s.sectionId) ?? '';
      return lid === levelFilter;
    },
    [levelFilter, sectionLevelId],
  );

  const counts = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const s of seats) {
      if (!seatOnLevel(s)) continue;
      if (sectionFilter !== 'ALL' && s.sectionId !== sectionFilter) continue;
      const price = priceOf(s.sectionId);
      if (priceCap != null && price > priceCap) continue;
      const st = statusBySeat[s.id];
      if (st === 'sold') sold += 1;
      else if (st === 'held') held += 1;
      else available += 1;
    }
    return { available, held, sold };
  }, [seats, statusBySeat, sectionFilter, priceCap, priceOf, seatOnLevel]);

  const fitToView = useCallback(
    (target = bounds) => {
      const el = viewportRef.current;
      if (!el) return false;
      const pad = 28;
      const vw = el.clientWidth - pad * 2;
      const vh = el.clientHeight - pad * 2;
      if (vw <= 0 || vh <= 0 || target.width <= 0 || target.height <= 0) return false;
      const next = Math.min(vw / target.width, vh / target.height, 2.8);
      const cx = target.minX + target.width / 2;
      const cy = target.minY + target.height / 2;
      setScale(next);
      setTx(el.clientWidth / 2 - cx * next);
      setTy(el.clientHeight / 2 - cy * next);
      setReady(true);
      return true;
    },
    [bounds],
  );

  // Fit once the viewport has real size (flex/layout often reports 0 on first paint).
  useEffect(() => {
    setReady(false);
  }, [eventId, bounds.minX, bounds.minY, bounds.width, bounds.height]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || ready) return;

    let cancelled = false;
    const tryFit = () => {
      if (cancelled) return;
      fitToView();
    };

    tryFit();
    const raf = requestAnimationFrame(tryFit);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => tryFit())
        : null;
    ro?.observe(el);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [fitToView, ready]);

  useEffect(() => {
    let cancelled = false;

    function applyAvailability(data: { tickets?: { seatId?: string; status?: string }[] }) {
      const next: Record<string, string> = {};
      for (const t of data.tickets ?? []) {
        if (t.seatId) next[t.seatId] = String(t.status).toLowerCase();
      }
      const prev = statusRef.current;
      const changed: Record<string, number> = {};
      const now = Date.now();
      for (const id of Object.keys(next)) {
        if (prev[id] && prev[id] !== next[id]) changed[id] = now;
      }
      for (const id of Object.keys(prev)) {
        if (!(id in next) && prev[id]) changed[id] = now;
      }
      statusRef.current = next;
      setStatusBySeat(next);
      if (Object.keys(changed).length) {
        setFlashIds((f) => ({ ...f, ...changed }));
        window.setTimeout(() => {
          if (cancelled) return;
          setFlashIds((f) => {
            const copy = { ...f };
            for (const id of Object.keys(changed)) {
              if (copy[id] === changed[id]) delete copy[id];
            }
            return copy;
          });
        }, 700);
      }
      setConnError(null);
    }

    async function loadAvailability() {
      try {
        const res = await fetch(`${API}/inventory/${eventId}/availability`);
        if (cancelled) return;
        if (!res.ok) {
          setConnError(`Disponibilidad HTTP ${res.status}. Revisa que la API esté en ${API}.`);
          return;
        }
        applyAvailability(await res.json());
      } catch {
        if (!cancelled) {
          setConnError(
            `Sin conexión a la API (${API}). Arranca el backend en :4000 y recarga.`,
          );
        }
      }
    }

    void loadAvailability();
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API}/inventory/${eventId}/stream`);
      es.onopen = () => {
        if (!cancelled) setLive(true);
      };
      es.onerror = () => {
        if (!cancelled) setLive(false);
      };
      es.onmessage = (ev) => {
        try {
          applyAvailability(JSON.parse(ev.data));
        } catch {
          void loadAvailability();
        }
      };
    } catch {
      setLive(false);
    }
    const poll = setInterval(() => void loadAvailability(), 12000);

    return () => {
      cancelled = true;
      es?.close();
      clearInterval(poll);
    };
  }, [eventId]);

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const next = Math.min(4, Math.max(0.35, scale * factor));
    const worldX = (px - tx) / scale;
    const worldY = (py - ty) / scale;
    setScale(next);
    setTx(px - worldX * next);
    setTy(py - worldY * next);
  }

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, e.clientX, e.clientY);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('[data-seat]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragRef.current) return;
    setTx(dragRef.current.tx + (e.clientX - dragRef.current.x));
    setTy(dragRef.current.ty + (e.clientY - dragRef.current.y));
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  function statusOf(seatId: string) {
    const st = statusBySeat[seatId];
    if (selected.includes(seatId)) return 'selected';
    if (st === 'sold') return 'sold';
    if (st === 'held') return 'held';
    return 'available';
  }

  function selectSection(id: string | 'ALL') {
    setSectionFilter(id);
    if (id === 'ALL') {
      fitToView(bounds);
      return;
    }
    const sec = map.sections.find((s) => s.id === id);
    if (sec) fitToView(sectionBounds(sec, 28));
  }

  function tryToggle(seatId: string, disabled: boolean) {
    if (disabled) return;
    if (!selected.includes(seatId) && selected.length >= maxSelect) return;
    onToggle(seatId);
  }

  function onKeyDown(e: KeyboardEvent, seatId: string, disabled: boolean) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tryToggle(seatId, disabled);
    }
  }

  const focused = seats.find((s) => s.id === focusedId);

  if (!seats.length) {
    return <p className={styles.empty}>Mapa no disponible para este evento.</p>;
  }

  return (
    <div className={styles.wrap}>
      {connError && (
        <p className={styles.connError} role="alert">
          {connError}
        </p>
      )}
      <div className={styles.toolbar}>
        <ul className={styles.legend} aria-label="Leyenda">
          <li>
            <span className={styles.dot} style={{ background: SEAT_STATUS_COLORS.available }} />
            Libre <em>{counts.available}</em>
          </li>
          <li>
            <span className={styles.dot} style={{ background: SEAT_STATUS_COLORS.held }} />
            Hold <em>{counts.held}</em>
          </li>
          <li>
            <span className={styles.dot} style={{ background: SEAT_STATUS_COLORS.sold }} />
            Vendido <em>{counts.sold}</em>
          </li>
          <li>
            <span className={styles.dot} style={{ background: SEAT_STATUS_COLORS.selected }} />
            Sel. <em>{selected.length}</em>
          </li>
        </ul>
        <div className={styles.zoomBtns}>
          <span className={live ? styles.liveOn : styles.liveOff} aria-live="polite">
            {live ? 'En vivo' : 'Polling'}
          </span>
          <button
            type="button"
            className={heatMode === 'price' ? styles.toggleOn : undefined}
            onClick={() => setHeatMode((v) => (v === 'price' ? 'off' : 'price'))}
            aria-pressed={heatMode === 'price'}
          >
            Precio
          </button>
          <button
            type="button"
            className={heatMode === 'view' ? styles.toggleOn : undefined}
            onClick={() => setHeatMode((v) => (v === 'view' ? 'off' : 'view'))}
            aria-pressed={heatMode === 'view'}
            title="Calor de calidad de vista (sightlines)"
          >
            Vista
          </button>
          <button
            type="button"
            className={showEgress ? styles.toggleOn : undefined}
            onClick={() => setShowEgress((v) => !v)}
            aria-pressed={showEgress}
            aria-controls="egress-legend egress-status"
            title="Rutas de salida por sección"
            disabled={!projected.aisles.length && !projected.exits.length && !projected.stairs.length}
          >
            Salidas
          </button>
          <button type="button" onClick={() => zoomAt(1.2)} aria-label="Acercar">
            +
          </button>
          <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="Alejar">
            −
          </button>
          <button type="button" onClick={() => fitToView()} aria-label="Ajustar">
            Encajar
          </button>
        </div>
      </div>

      {heatMode === 'price' && priceRange.max > priceRange.min && (
        <div className={styles.heatBar}>
          <div className={styles.heatScale} aria-hidden />
          <div className={styles.heatLabels}>
            <span>${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
            <span>Heat de precio</span>
            <span>${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
          </div>
          <label className={styles.priceFilter}>
            Máx. ${((priceCap ?? priceRange.max) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            <input
              type="range"
              min={priceRange.min}
              max={priceRange.max}
              step={Math.max(1, Math.round((priceRange.max - priceRange.min) / 20))}
              value={priceCap ?? priceRange.max}
              onChange={(e) => setPriceCap(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {heatMode === 'view' && (
        <div className={styles.heatBar}>
          <div className={styles.viewHeatScale} aria-hidden />
          <div className={styles.heatLabels}>
            <span>Restringida</span>
            <span>Heat de vista</span>
            <span>Premium</span>
          </div>
        </div>
      )}

      {showEgress && (
        <ul id="egress-legend" className={styles.egressLegend} aria-label="Leyenda de salidas">
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
            Ruta activa
          </li>
          <li>
            <span className={`${styles.swatch} ${styles.swatchBottleneck}`} aria-hidden />
            Cuello de botella
          </li>
        </ul>
      )}

      {showEgress && egressOverlay && (
        <p id="egress-status" className={styles.egressHint} role="status" aria-live="polite">
          {egressOverlay.hasNetwork
            ? `Rutas de salida · ${egressOverlay.paths.length} sección(es)${
                egressOverlay.clearanceMinutes != null
                  ? ` · vaciado ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                  : ''
              }`
            : 'Sin red de pasillos/salidas para calcular rutas'}
        </p>
      )}

      {levels.length > 0 && (
        <div className={styles.sections} role="toolbar" aria-label="Niveles">
          <button
            type="button"
            className={levelFilter === 'ALL' ? styles.secActive : styles.sec}
            onClick={() => {
              setLevelFilter('ALL');
              setSectionFilter('ALL');
            }}
          >
            Todos los niveles
          </button>
          {levels.map((lv) => (
            <button
              key={lv.id}
              type="button"
              className={levelFilter === lv.id ? styles.secActive : styles.sec}
              onClick={() => {
                setLevelFilter(lv.id);
                setSectionFilter('ALL');
              }}
            >
              {lv.name}
            </button>
          ))}
        </div>
      )}

      {visibleSections.length > 0 && (
        <div className={styles.sections} role="toolbar" aria-label="Secciones">
          <button
            type="button"
            className={sectionFilter === 'ALL' ? styles.secActive : styles.sec}
            onClick={() => selectSection('ALL')}
          >
            Todo el venue
          </button>
          {visibleSections.map((sec) => {
            const price = priceOf(sec.id);
            return (
              <button
                key={sec.id}
                type="button"
                className={sectionFilter === sec.id ? styles.secActive : styles.sec}
                onClick={() => selectSection(sec.id)}
              >
                <i
                  style={{
                    background:
                      heatMode === 'price'
                        ? priceHeatColor(price, priceRange.min, priceRange.max)
                        : sec.color,
                  }}
                />
                {sec.name}
                {price > 0 && (
                  <em>${price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</em>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={viewportRef}
        className={`${styles.viewport} ${dragging ? styles.dragging : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.stageBanner}>
          <span>Escenario</span>
        </div>
        <svg
          className={styles.svg}
          style={{ opacity: ready ? 1 : 0 }}
          role="img"
          aria-label={
            showEgress
              ? 'Mapa de asientos con rutas de salida'
              : 'Mapa de asientos'
          }
          aria-describedby={showEgress ? 'egress-legend egress-status' : undefined}
        >
          <defs>
            <linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2a1218" />
              <stop offset="100%" stopColor="#12080c" />
            </linearGradient>
          </defs>
          <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
            {/* Stage — single clean bar */}
            <rect
              x={stage.x}
              y={stage.y}
              width={stage.width}
              height={20}
              rx={2}
              fill="url(#stageGrad)"
              stroke="rgba(225,29,72,0.45)"
              strokeWidth={1}
            />
            <rect
              x={stage.x + stage.width * 0.22}
              y={stage.y - 4}
              width={stage.width * 0.56}
              height={3}
              rx={1}
              fill="#e11d48"
              opacity={0.9}
            />

            {/* Circulation / obstacles from geometry engine */}
            {aisles.map((aisle) => {
              if (levelFilter !== 'ALL' && aisle.levelId && aisle.levelId !== levelFilter) {
                return null;
              }
              return (
              <polyline
                key={aisle.id}
                points={aisle.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="rgba(148,163,184,0.35)"
                strokeWidth={10}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              );
            })}
            {obstacles.map((obs) => {
              if (levelFilter !== 'ALL' && obs.levelId && obs.levelId !== levelFilter) {
                return null;
              }
              return (
              <polygon
                key={obs.id}
                points={obs.points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="rgba(63,63,70,0.55)"
                stroke="rgba(161,161,170,0.5)"
                strokeWidth={1}
              />
              );
            })}
            {stairs.map((stair) => {
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
                stroke="rgba(251,146,60,0.7)"
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="8 5"
              />
              );
            })}
            {exits.map((ex) => {
              if (levelFilter !== 'ALL' && ex.levelId && ex.levelId !== levelFilter) return null;
              if (!ex.points.length) return null;
              const [x, y] = ex.points[0];
              const r = Math.max((ex.width ?? 32) * 0.28, 7);
              return (
                <g key={ex.id} opacity={0.95} style={{ pointerEvents: 'none' }}>
                  {ex.points.length >= 2 ? (
                    <polyline
                      points={ex.points.map(([px, py]) => `${px},${py}`).join(' ')}
                      fill="none"
                      stroke="rgba(34,197,94,0.55)"
                      strokeWidth={ex.width ?? 28}
                      strokeLinecap="round"
                    />
                  ) : null}
                  <circle cx={x} cy={y} r={r} fill="rgba(34,197,94,0.85)" stroke="#14532d" strokeWidth={1.5} />
                  <text
                    x={x}
                    y={y - r - 4}
                    textAnchor="middle"
                    fontSize={9}
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
                    stroke={active ? '#f472b6' : 'rgba(244,114,182,0.35)'}
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

            {/* Venue furniture — LED wall / speakers / doors authored in the admin designer */}
            {furniture.map((item) => {
              if (levelFilter !== 'ALL' && item.levelId && item.levelId !== levelFilter) {
                return null;
              }
              if (item.type === 'led') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`}>
                    <rect x={-26} y={-8} width={52} height={16} rx={2} fill="#1a0510" stroke="#be123c" strokeWidth={1} />
                    <rect x={-22} y={-5} width={44} height={10} rx={1} fill="#be123c" opacity={0.55} />
                  </g>
                );
              }
              if (item.type === 'speaker') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`}>
                    <rect x={-7} y={-10} width={14} height={20} rx={2} fill="#0f0f12" stroke="#404040" strokeWidth={1} />
                    <circle cx={0} cy={-4} r={3.4} fill="#27272a" />
                    <circle cx={0} cy={5} r={2.4} fill="#27272a" />
                  </g>
                );
              }
              if (item.type === 'door') {
                return (
                  <g key={item.id} transform={`translate(${item.x} ${item.y})`} style={{ pointerEvents: 'none' }}>
                    <rect x={-10} y={-4} width={20} height={8} rx={1} fill="rgba(34,197,94,0.35)" stroke="#22c55e" strokeWidth={1.2} />
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
                <circle cx={f.x} cy={f.y} r={6} fill="rgba(250,250,250,0.92)" stroke="#e11d48" strokeWidth={2} />
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

            {/* Section labels above each zone (not on seats) */}
            {map.sections.map((sec) => {
              if (!sec.seats.length) return null;
              const active =
                (levelFilter === 'ALL' || (sec.levelId ?? '') === levelFilter) &&
                (sectionFilter === 'ALL' || sectionFilter === sec.id);
              const fill =
                heatMode === 'price'
                  ? priceHeatColor(priceOf(sec.id), priceRange.min, priceRange.max)
                  : sec.color || '#5b9fd4';
              const xs = sec.seats.map((s) => s.x);
              const ys = sec.seats.map((s) => s.y);
              const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
              const top = Math.min(...ys) - 20;
              const label = sec.name.length > 14 ? `${sec.name.slice(0, 13)}…` : sec.name;
              const tw = Math.max(52, label.length * 6.2);
              return (
                <g
                  key={`label-${sec.id}`}
                  opacity={active ? 1 : 0.28}
                  transform={`translate(${cx} ${top})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSection(sec.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={-tw / 2}
                    y={-9}
                    width={tw}
                    height={16}
                    rx={2}
                    fill="rgba(8,8,10,0.88)"
                    stroke={fill}
                    strokeWidth={1}
                    strokeOpacity={0.55}
                  />
                  <text
                    y={2.5}
                    textAnchor="middle"
                    className={styles.sectionLabel}
                    fill="#f4f4f5"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {seats.map((s) => {
              const st = statusOf(s.id);
              const blocked = Boolean(s.visibility?.blocked);
              const restricted = Boolean(s.visibility?.restrictedView);
              const premium = Boolean(s.visibility?.premiumView);
              const disabled = st === 'sold' || st === 'held' || blocked;
              const price = priceOf(s.sectionId);
              const overBudget = priceCap != null && price > priceCap;
              const dimmed =
                !seatOnLevel(s) ||
                (sectionFilter !== 'ALL' && s.sectionId !== sectionFilter) ||
                overBudget;
              const viewScore = sightlineBySeat?.get(s.id)?.score;
              const fill =
                st === 'selected'
                  ? SEAT_STATUS_COLORS.selected
                  : blocked
                    ? '#3f3f46'
                    : st === 'sold'
                      ? SEAT_STATUS_COLORS.sold
                      : st === 'held'
                        ? SEAT_STATUS_COLORS.held
                        : dimmed
                          ? SEAT_STATUS_COLORS.dimmed
                          : heatMode === 'price'
                            ? priceHeatColor(price, priceRange.min, priceRange.max)
                            : heatMode === 'view' && viewScore != null
                              ? sightlineHeatColor(viewScore)
                              : premium
                                ? '#d4a017'
                                : s.sectionColor || SEAT_STATUS_COLORS.available;

              const w = st === 'selected' ? 15 : 12;
              const h = st === 'selected' ? 13 : 10;
              const showLabel = scale >= 1.45;

              return (
                <g
                  key={s.id}
                  data-seat={s.id}
                  opacity={dimmed ? 0.2 : blocked ? 0.35 : 1}
                  transform={`translate(${s.x} ${s.y}) rotate(${s.rotation ?? 0})`}
                >
                  {st === 'selected' && (
                    <rect
                      x={-w / 2 - 1.5}
                      y={-h / 2 - 1.5}
                      width={w + 3}
                      height={h + 3}
                      rx={2}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={1.25}
                    />
                  )}
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={1.5}
                    fill={fill}
                    stroke={
                      restricted
                        ? 'rgba(148,163,184,0.9)'
                        : st === 'available' && !dimmed
                          ? 'rgba(255,255,255,0.12)'
                          : 'transparent'
                    }
                    strokeWidth={restricted ? 1.25 : 0.75}
                    strokeDasharray={restricted ? '2 1.5' : undefined}
                    className={`${disabled || overBudget ? styles.seatDisabled : styles.seat}${flashIds[s.id] ? ` ${styles.seatFlash}` : ''}`}
                    tabIndex={disabled || dimmed ? -1 : 0}
                    role="button"
                    aria-label={`${s.label}${s.row ? `, fila ${s.row}` : ''}, ${s.sectionName}${price ? `, $${price}` : ''}${disabled ? ', no disponible' : ''}${restricted ? ', vista restringida' : ''}`}
                    aria-pressed={selected.includes(s.id)}
                    aria-disabled={disabled || overBudget}
                    onFocus={() => setFocusedId(s.id)}
                    onMouseEnter={() => setFocusedId(s.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!dimmed) tryToggle(s.id, disabled);
                    }}
                    onKeyDown={(e) => onKeyDown(e, s.id, disabled || dimmed)}
                  />
                  {showLabel && (
                    <text y={h / 2 + 8} className={styles.label} textAnchor="middle">
                      {s.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <p className={styles.hint}>Scroll zoom · Arrastra pan · Click asiento</p>
      </div>

      <p className={styles.focus} aria-live="polite">
        {focused
          ? `${focused.label}${focused.row ? ` · Fila ${focused.row}` : ''} · ${focused.sectionName} · $${priceOf(focused.sectionId).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
          : 'Pasa el cursor o selecciona asientos'}
      </p>

      <aside className={styles.tray} aria-label="Selección">
        <div className={styles.trayHead}>
          <div>
            <p className={styles.trayTitle}>
              {selectedInfo.length
                ? `${selectedInfo.length} asiento${selectedInfo.length === 1 ? '' : 's'}`
                : 'Ninguno seleccionado'}
            </p>
            <p className={styles.traySub}>
              {selectedInfo.length
                ? `Total $${selectionTotal.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
                : `Máx. ${maxSelect} · elige en el mapa`}
            </p>
          </div>
          {selectedInfo.length > 0 && onClear && (
            <button type="button" className={styles.trayClear} onClick={onClear}>
              Limpiar
            </button>
          )}
        </div>
        {selectedInfo.length > 0 && (
          <ul className={styles.trayList}>
            {selectedInfo.map((item) => (
              <li key={item.seatId}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.sectionName} · ${item.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Quitar ${item.label}`}
                  onClick={() => onToggle(item.seatId)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

/** Derive checkout offerId from majority zone among selected seats */
export function primaryOfferIdFromSelection(items: SelectedSeatInfo[], fallback = ''): string {
  if (!items.length) return fallback;
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.offerId) continue;
    counts.set(i.offerId, (counts.get(i.offerId) ?? 0) + 1);
  }
  let best = fallback;
  let n = 0;
  for (const [id, c] of counts) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best || items[0]?.offerId || fallback;
}

export function selectionTotal(items: SelectedSeatInfo[]): number {
  return items.reduce((s, i) => s + i.price, 0);
}
