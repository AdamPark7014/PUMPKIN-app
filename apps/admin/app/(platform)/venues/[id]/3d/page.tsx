'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { flatSeats, normalizeSeatMap } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import {
  applyLayoutTemplate,
  getVenueLayout,
  listEvents,
  publishEvent,
  saveVenueLayout,
} from '@/lib/platform-api';
import platform from '../../../_styles/platform.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

const TEMPLATES = [
  { id: 'arena' as const, label: 'Arena' },
  { id: 'theater' as const, label: 'Teatro' },
  { id: 'stadium' as const, label: 'Estadio' },
  { id: 'festival' as const, label: 'Festival' },
];

export default function Venue3DPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const search = useSearchParams();
  const studio = search.get('studio') === '1';
  const [mapData, setMapData] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; title: string; venueId?: string }[]>([]);
  const [publishEventId, setPublishEventId] = useState('');

  async function reload(token: string) {
    const data = await getVenueLayout(token, venueId);
    setMapData(data.layout.mapData);
    setVenueName(data.venue?.name ?? 'Venue');
  }

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !venueId) return;
    reload(token).catch(() => setMsg('No se pudo cargar el layout'));
    listEvents(token)
      .then((list) => {
        const filtered = list.filter((e) => (e as { venueId?: string }).venueId === venueId);
        setEvents(filtered);
        if (filtered[0]) setPublishEventId(filtered[0].id);
      })
      .catch(() => setEvents([]));
  }, [venueId]);

  const normalized = useMemo(() => (mapData ? normalizeSeatMap(mapData) : null), [mapData]);
  const seats = useMemo(() => {
    if (!normalized) return [];
    return flatSeats(normalized).map((seat) => ({
      id: seat.id,
      label: seat.label,
      x: seat.x,
      y: seat.y,
      z: seat.position?.y ?? seat.elevation ?? 0,
      section: seat.sectionName,
      row: seat.row,
      color: seat.sectionColor,
      rotation: seat.rotation,
      elevation: seat.elevation,
      position: seat.position,
      rotation3d: seat.rotation3d,
      coord3d: seat.coord3d,
      visibility: seat.visibility,
      status: seat.visibility?.blocked ? ('blocked' as const) : ('available' as const),
      levelId: seat.levelId,
    }));
  }, [normalized]);

  async function applyTemplate(template: (typeof TEMPLATES)[number]['id']) {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    setBusy(template);
    setMsg(null);
    try {
      const result = await applyLayoutTemplate(token, venueId, template);
      setMapData(result.layout.mapData);
      setMsg(`Plantilla ${template} aplicada. La planta 2D y los eventos vinculados se sincronizan al guardar.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al aplicar plantilla');
    } finally {
      setBusy(null);
    }
  }

  async function saveCurrent() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !mapData) return;
    setBusy('save');
    setMsg(null);
    try {
      await saveVenueLayout(token, venueId, mapData);
      await reload(token);
      setMsg('Mapa guardado. Snapshots de eventos del venue actualizados (congruencia venue ↔ evento).');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setBusy(null);
    }
  }

  async function publishToEvent() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !publishEventId) return;
    setBusy('publish');
    setMsg(null);
    try {
      if (mapData) await saveVenueLayout(token, venueId, mapData);
      const r = await publishEvent(token, publishEventId);
      setMsg(`Publicado en evento: ${r.totalSeats} boletos · ${r.sections} zonas`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al publicar');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>{studio ? 'Estudio 3D' : 'Preview 3D'} — {venueName || 'Venue'}</h1>
          <p>
            {seats.length} asientos · la planta 2D se deriva de esta geometría · eventos usan el mismo
            layout
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={!mapData || busy === 'save'}
            onClick={saveCurrent}
          >
            {busy === 'save' ? 'Guardando…' : 'Guardar mapa'}
          </button>
          <Link href={`/venues/${venueId}/map`} className={platform.ghostBtn}>
            Vista planta
          </Link>
          <Link href="/maps" className={platform.ghostBtn}>
            ← Creador
          </Link>
        </div>
      </header>

      {studio && (
        <section
          className={platform.panel}
          style={{ marginBottom: '1rem', display: 'grid', gap: '0.75rem' }}
        >
          <div>
            <strong style={{ fontSize: 13 }}>Armar desde plantilla</strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: 12, color: '#737373' }}>
              Genera el bowl en 3D. La planta se arma sola a partir de las mismas coordenadas.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={platform.ghostBtn}
                  disabled={!!busy}
                  onClick={() => applyTemplate(t.id)}
                >
                  {busy === t.id ? '…' : t.label}
                </button>
              ))}
            </div>
          </div>
          {events.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={publishEventId}
                onChange={(e) => setPublishEventId(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: 8, border: '1px solid #d4d4d4' }}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={platform.primaryBtn}
                disabled={!publishEventId || busy === 'publish'}
                onClick={publishToEvent}
              >
                {busy === 'publish' ? 'Publicando…' : 'Publicar a evento'}
              </button>
            </div>
          )}
        </section>
      )}

      {msg && (
        <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: '#404040' }}>{msg}</p>
      )}

      {!mapData ? (
        <p>Cargando venue…</p>
      ) : seats.length === 0 ? (
        <div className={platform.panel}>
          <p style={{ marginTop: 0 }}>
            Este mapa está vacío. Elige una plantilla arriba para armar el 3D (y la planta) desde cero,
            o abre la vista planta solo para ajustes finos.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={platform.primaryBtn}
                disabled={!!busy}
                onClick={() => applyTemplate(t.id)}
              >
                Empezar con {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Venue3DViewer
          mode="orbit"
          seats={seats}
          height={620}
          stage={normalized?.venue?.stage}
          aisles={normalized?.venue?.aisles}
          obstacles={normalized?.venue?.obstacles}
          stairs={normalized?.venue?.stairs}
          exits={normalized?.venue?.exits}
          furniture={normalized?.venue?.furniture}
          focusPoints={normalized?.venue?.focusPoints}
          levels={normalized?.venue?.levels}
          mapData={normalized}
        />
      )}
    </div>
  );
}
