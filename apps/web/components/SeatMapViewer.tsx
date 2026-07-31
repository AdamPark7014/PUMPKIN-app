'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SEAT_STATUS_COLORS,
  buildEgressPathOverlays,
  calculateSightlines,
  flatSeats,
  normalizeSeatMap,
  priceHeatColor,
  resolveGeometry,
  resolveOfferForSection,
  sectionBounds,
} from '@boletera/venue-engine';
import type { AnalysisOverlay, ColorMode } from '@boletera/venue-engine/render';
import { money } from '@/lib/format';
import { GpuViewport, dispatchSeatMapCommand } from './seatmap/GpuViewport';
import { useSeatAvailability } from './seatmap/useSeatAvailability';
import {
  selectionTotal as sumSelection,
  type SeatMapOffer,
  type SelectedSeatInfo,
} from './seatmap/types';
import styles from './SeatMapViewer.module.scss';

export type { SelectedSeatInfo } from './seatmap/types';
export { primaryOfferIdFromSelection, selectionTotal } from './seatmap/types';

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
  offers?: SeatMapOffer[];
  maxSelect?: number;
  currency?: string;
  heatDefault?: boolean;
  focusZone?: string | null;
}) {
  const map = useMemo(() => normalizeSeatMap(mapData), [mapData]);
  const scene = useMemo(() => resolveGeometry(map), [map]);
  const renderMap = scene.map;
  const seats = useMemo(() => flatSeats(renderMap), [renderMap]);
  const bounds = useMemo(
    () => ({
      minX: scene.bounds.minX,
      minY: scene.bounds.minY,
      maxX: scene.bounds.maxX,
      maxY: scene.bounds.maxY,
      width: scene.bounds.width,
      height: scene.bounds.height,
    }),
    [scene.bounds],
  );

  const { statusBySeat, live, connError } = useSeatAvailability(eventId);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [sectionFilter, setSectionFilter] = useState<string | 'ALL'>('ALL');
  const [heatMode, setHeatMode] = useState<'off' | 'price' | 'view'>(
    heatDefault ? 'price' : 'off',
  );
  const [showEgress, setShowEgress] = useState(false);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [fitBounds, setFitBounds] = useState(bounds);
  const [backendLabel, setBackendLabel] = useState<string>('');

  const sectionMeta = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; levelId?: string }>();
    for (const sec of renderMap.sections) {
      m.set(sec.id, { slug: sec.slug, name: sec.name, levelId: sec.levelId });
    }
    return m;
  }, [renderMap.sections]);

  const priceOf = useCallback(
    (sectionId: string) => {
      const meta = sectionMeta.get(sectionId);
      const offer = resolveOfferForSection(offers, meta?.slug ?? '', meta?.name);
      return offer ? Number(offer.basePrice) : 0;
    },
    [offers, sectionMeta],
  );

  const priceBySeatId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of seats) out[s.id] = priceOf(s.sectionId);
    return out;
  }, [seats, priceOf]);

  const priceRange = useMemo(() => {
    const prices = Object.values(priceBySeatId).filter((n) => Number.isFinite(n) && n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [priceBySeatId]);

  useEffect(() => {
    if (priceCap == null && priceRange.max > 0) setPriceCap(priceRange.max);
  }, [priceRange.max, priceCap]);

  useEffect(() => {
    if (!focusZone) return;
    const needle = focusZone.toLowerCase();
    const match = renderMap.sections.find(
      (s) =>
        s.slug.toLowerCase() === needle ||
        s.name.toLowerCase() === needle ||
        s.name.toLowerCase().includes(needle) ||
        s.slug.toLowerCase().includes(needle),
    );
    if (match) {
      setSectionFilter(match.id);
      setFitBounds(sectionBounds(match, 28));
      setFitToken((t) => t + 1);
    }
  }, [focusZone, renderMap.sections]);

  const sightlineBySeatId = useMemo(() => {
    if (heatMode !== 'view') return null;
    const result = calculateSightlines(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    const out: Record<string, number> = {};
    for (const s of result.scores) out[s.seatId] = s.score;
    return out;
  }, [heatMode, scene, levelFilter]);

  const analysis = useMemo((): AnalysisOverlay[] => {
    if (!showEgress) return [];
    const overlay = buildEgressPathOverlays(scene, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    const paths: AnalysisOverlay['paths'] = [];
    for (const path of overlay.paths) {
      const active =
        (sectionFilter !== 'ALL' && path.sectionId === sectionFilter) ||
        (sectionFilter === 'ALL' &&
          selected.length > 0 &&
          seats.find((s) => s.id === selected[0])?.sectionId === path.sectionId);
      paths.push({
        points: path.points.map(([x, y]) => ({ x, y })),
        color: active ? '#f472b6' : 'rgba(244,114,182,0.45)',
        width: active ? 5 : 2.5,
      });
    }
    for (const b of overlay.bottlenecks) {
      paths.push({
        points: b.points.map(([x, y]) => ({ x, y })),
        color: 'rgba(251,146,60,0.9)',
        width: 6,
      });
    }
    return paths.length ? [{ kind: 'egress', paths }] : [];
  }, [showEgress, scene, levelFilter, sectionFilter, selected, seats]);

  const levels = useMemo(() => {
    const list = [...(renderMap.venue?.levels ?? [])];
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }, [renderMap.venue?.levels]);

  const visibleSections = useMemo(() => {
    if (levelFilter === 'ALL') return renderMap.sections;
    return renderMap.sections.filter((s) => (s.levelId ?? '') === levelFilter);
  }, [renderMap.sections, levelFilter]);

  const dimmedIds = useMemo(() => {
    const dimmed = new Set<string>();
    for (const s of seats) {
      const meta = sectionMeta.get(s.sectionId);
      const onLevel =
        levelFilter === 'ALL' ||
        (s.levelId ?? meta?.levelId ?? '') === levelFilter;
      const onSection = sectionFilter === 'ALL' || s.sectionId === sectionFilter;
      const price = priceBySeatId[s.id] ?? 0;
      const overBudget = priceCap != null && price > priceCap;
      const blocked = Boolean(s.visibility?.blocked);
      if (!onLevel || !onSection || overBudget || blocked) dimmed.add(s.id);
    }
    return dimmed;
  }, [seats, sectionMeta, levelFilter, sectionFilter, priceBySeatId, priceCap]);

  const counts = useMemo(() => {
    let available = 0;
    let held = 0;
    let sold = 0;
    for (const s of seats) {
      if (dimmedIds.has(s.id) && statusBySeat[s.id] !== 'sold' && statusBySeat[s.id] !== 'held') {
        continue;
      }
      if (dimmedIds.has(s.id) && !statusBySeat[s.id]) continue;
      const st = statusBySeat[s.id];
      if (st === 'sold') sold += 1;
      else if (st === 'held') held += 1;
      else if (!dimmedIds.has(s.id)) available += 1;
    }
    return { available, held, sold };
  }, [seats, statusBySeat, dimmedIds]);

  const selectedInfo: SelectedSeatInfo[] = useMemo(() => {
    return selected
      .map((id) => {
        const seat = seats.find((s) => s.id === id);
        if (!seat) return null;
        const meta = sectionMeta.get(seat.sectionId);
        const offer = resolveOfferForSection(
          offers,
          meta?.slug ?? seat.sectionId,
          seat.sectionName,
        );
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

  const total = sumSelection(selectedInfo);
  const focused = seats.find((s) => s.id === focusedId);

  const colorMode: ColorMode =
    heatMode === 'price' ? 'price' : heatMode === 'view' ? 'sightline' : 'status';

  function selectSection(id: string | 'ALL') {
    setSectionFilter(id);
    if (id === 'ALL') {
      setFitBounds(bounds);
    } else {
      const sec = renderMap.sections.find((s) => s.id === id);
      if (sec) setFitBounds(sectionBounds(sec, 28));
    }
    setFitToken((t) => t + 1);
  }

  function canSelect(seatId: string) {
    if (dimmedIds.has(seatId)) return false;
    const st = statusBySeat[seatId];
    if (st === 'sold' || st === 'held') return false;
    if (!selected.includes(seatId) && selected.length >= maxSelect) return false;
    return true;
  }

  function tryToggle(seatId: string) {
    if (!canSelect(seatId) && !selected.includes(seatId)) return;
    onToggle(seatId);
  }

  // Announce GPU backend once after first paint (for support / perf debugging).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-seatmap-viewport] canvas',
      );
      if (!canvas) return;
      const gl = canvas.getContext('webgl2');
      setBackendLabel(gl ? 'WebGL2' : 'Canvas2D');
    }, 400);
    return () => clearTimeout(t);
  }, [eventId]);

  if (!seats.length) {
    return <p className={styles.empty}>Mapa no disponible para este evento.</p>;
  }

  const hasCirculation =
    (renderMap.venue?.aisles?.length ?? 0) > 0 ||
    (renderMap.venue?.exits?.length ?? 0) > 0 ||
    (renderMap.venue?.stairs?.length ?? 0) > 0;

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
            {backendLabel ? ` · ${backendLabel}` : ''}
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
            title="Calor de calidad de vista"
          >
            Vista
          </button>
          <button
            type="button"
            className={showEgress ? styles.toggleOn : undefined}
            onClick={() => setShowEgress((v) => !v)}
            aria-pressed={showEgress}
            title="Rutas de salida"
            disabled={!hasCirculation}
          >
            Salidas
          </button>
          <button
            type="button"
            onClick={() => dispatchSeatMapCommand('zoom-in')}
            aria-label="Acercar"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => dispatchSeatMapCommand('zoom-out')}
            aria-label="Alejar"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => {
              setFitBounds(bounds);
              setFitToken((t) => t + 1);
              dispatchSeatMapCommand('fit');
            }}
            aria-label="Ajustar"
          >
            Encajar
          </button>
        </div>
      </div>

      {heatMode === 'price' && priceRange.max > priceRange.min && (
        <div className={styles.heatBar}>
          <div className={styles.heatScale} aria-hidden />
          <div className={styles.heatLabels}>
            <span>{money(priceRange.min, currency)}</span>
            <span>Heat de precio</span>
            <span>{money(priceRange.max, currency)}</span>
          </div>
          <label className={styles.priceFilter}>
            Máx. {money(priceCap ?? priceRange.max, currency)}
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

      {levels.length > 0 && (
        <div className={styles.sections} role="toolbar" aria-label="Niveles">
          <button
            type="button"
            className={levelFilter === 'ALL' ? styles.secActive : styles.sec}
            onClick={() => {
              setLevelFilter('ALL');
              setSectionFilter('ALL');
              setFitBounds(bounds);
              setFitToken((t) => t + 1);
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
                {price > 0 && <em>{money(price, currency)}</em>}
              </button>
            );
          })}
        </div>
      )}

      <GpuViewport
        map={renderMap}
        selected={selected}
        statusBySeat={statusBySeat}
        offers={offers}
        colorMode={colorMode}
        priceBySeatId={priceBySeatId}
        sightlineBySeatId={sightlineBySeatId}
        priceRange={priceRange}
        dimmedIds={dimmedIds}
        analysis={analysis}
        fitToken={fitToken}
        fitBounds={fitBounds}
        onHover={setFocusedId}
        onToggle={tryToggle}
        canSelect={canSelect}
      />

      {/* Lista accesible: el canvas GPU no expone nodos enfocables por asiento. */}
      <label className={styles.a11ySelect}>
        <span>Elegir asiento (teclado / lector de pantalla)</span>
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) tryToggle(id);
            e.currentTarget.value = '';
          }}
        >
          <option value="">Selecciona un asiento libre…</option>
          {seats
            .filter((s) => canSelect(s.id) || selected.includes(s.id))
            .slice(0, 400)
            .map((s) => {
              const price = priceBySeatId[s.id] ?? 0;
              const taken = selected.includes(s.id);
              return (
                <option key={s.id} value={s.id}>
                  {taken ? '✓ ' : ''}
                  {s.label}
                  {s.row ? ` · Fila ${s.row}` : ''} · {s.sectionName}
                  {price ? ` · ${money(price, currency)}` : ''}
                </option>
              );
            })}
        </select>
      </label>

      <p className={styles.focus} aria-live="polite">
        {focused
          ? `${focused.label}${focused.row ? ` · Fila ${focused.row}` : ''} · ${focused.sectionName} · ${money(priceOf(focused.sectionId), currency)}`
          : `${seats.length.toLocaleString('es-MX')} asientos · pasa el cursor o elige en el mapa`}
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
                ? `Total ${money(total, currency)}`
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
                    {item.sectionName} · {money(item.price, currency)}
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
