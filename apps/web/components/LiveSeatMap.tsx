'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import styles from './LiveSeatMap.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Seat = {
  id: string;
  label?: string;
  x: number;
  y: number;
  status?: string;
  section?: string;
  price?: number;
};
type MapData = {
  sections: { name?: string; zone?: string; price?: number; seats: Seat[] }[];
};

export function LiveSeatMap({
  eventId,
  mapData,
  selected,
  onToggle,
  offers = [],
}: {
  eventId: string;
  mapData: MapData | null;
  selected: string[];
  onToggle: (seatId: string) => void;
  offers?: { id: string; zone: string; basePrice: string }[];
}) {
  const [statusBySeat, setStatusBySeat] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const seats = useMemo(() => {
    if (!mapData?.sections) return [];
    return mapData.sections.flatMap((section) =>
      (section.seats ?? []).map((s) => ({
        ...s,
        section: s.section ?? section.name ?? section.zone,
        price:
          s.price ??
          section.price ??
          (Number(offers.find((o) => o.zone === (section.zone || section.name))?.basePrice) ||
            Number(offers[0]?.basePrice) ||
            undefined),
      })),
    );
  }, [mapData, offers]);

  const priceHint = useMemo(() => {
    const prices = offers.map((o) => Number(o.basePrice)).filter((n) => !Number.isNaN(n));
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `$${min.toFixed(0)} MXN` : `$${min.toFixed(0)} – $${max.toFixed(0)} MXN`;
  }, [offers]);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      const res = await fetch(`${API}/inventory/${eventId}/availability`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const t of data.tickets ?? []) {
        if (t.seatId) map[t.seatId] = String(t.status).toLowerCase();
      }
      setStatusBySeat(map);
    }

    void loadAvailability();
    const es = new EventSource(`${API}/inventory/${eventId}/stream`);
    es.onmessage = () => void loadAvailability();
    const poll = setInterval(() => void loadAvailability(), 8000);

    return () => {
      cancelled = true;
      es.close();
      clearInterval(poll);
    };
  }, [eventId]);

  function seatClass(seatId: string) {
    const st = statusBySeat[seatId];
    if (selected.includes(seatId)) return styles.selected;
    if (st === 'sold') return styles.sold;
    if (st === 'held') return styles.held;
    return styles.available;
  }

  function onKeyDown(e: KeyboardEvent, seatId: string, disabled: boolean) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(seatId);
    }
  }

  if (!seats.length) {
    return <p className={styles.empty}>Mapa no disponible — selecciona por oferta.</p>;
  }

  const focused = seats.find((s) => s.id === focusedId);

  return (
    <div className={styles.wrap}>
      <ul className={styles.legend} aria-label="Leyenda del mapa">
        <li>
          <span className={`${styles.swatch} ${styles.available}`} /> Disponible
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.held}`} /> Reservado
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.sold}`} /> Vendido
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.selected}`} /> Seleccionado
        </li>
      </ul>
      {priceHint && <p className={styles.priceRange}>Zonas desde {priceHint}</p>}
      {offers.length > 0 && (
        <ul className={styles.zones}>
          {offers.map((o) => (
            <li key={o.id}>
              <strong>{o.zone}</strong> · ${Number(o.basePrice).toFixed(0)} MXN
            </li>
          ))}
        </ul>
      )}
      <svg viewBox="0 0 400 200" className={styles.map} role="img" aria-label="Mapa de asientos">
        {seats.map((s) => {
          const st = statusBySeat[s.id];
          const disabled = st === 'sold' || st === 'held';
          const label = s.label || s.id.slice(-4);
          return (
            <g key={s.id}>
              <circle
                cx={s.x}
                cy={s.y}
                r={8}
                className={seatClass(s.id)}
                tabIndex={disabled ? -1 : 0}
                role="button"
                aria-label={`${label}${s.section ? `, ${s.section}` : ''}${s.price ? `, $${s.price}` : ''}${disabled ? ', no disponible' : ''}`}
                aria-pressed={selected.includes(s.id)}
                aria-disabled={disabled}
                onFocus={() => setFocusedId(s.id)}
                onClick={() => !disabled && onToggle(s.id)}
                onKeyDown={(e) => onKeyDown(e, s.id, disabled)}
              />
              <text x={s.x} y={s.y + 18} className={styles.seatLabel} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {focused && (
        <p className={styles.focusHint} aria-live="polite">
          {focused.label || focused.id}
          {focused.section ? ` · ${focused.section}` : ''}
          {focused.price != null ? ` · $${focused.price} MXN` : ''}
        </p>
      )}
    </div>
  );
}
