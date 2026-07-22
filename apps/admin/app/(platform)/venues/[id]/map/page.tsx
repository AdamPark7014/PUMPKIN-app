'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { SeatMapData } from '@boletera/shared';
import { SeatMapEditor } from '@/components/SeatMapEditor';
import {
  suggestLayout,
  getVenueLayout,
  importAiLayout,
  listEvents,
  publishEvent,
  saveVenueLayout,
} from '@/lib/platform-api';
import platform from '../../../_styles/platform.module.scss';

export default function VenueMapEditorPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');
  const [events, setEvents] = useState<{ id: string; title: string; venueId?: string }[]>([]);
  const [publishEventId, setPublishEventId] = useState('');
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !venueId) return;
    getVenueLayout(token, venueId).then((data) => {
      setMap(data.layout.mapData);
      setVenueName(data.venue?.name ?? 'Venue');
    });
    listEvents(token).then((list) => {
      const filtered = list.filter((e) => (e as { venueId?: string }).venueId === venueId);
      setEvents(filtered);
      if (filtered[0]) setPublishEventId(filtered[0].id);
    });
  }, [venueId]);

  if (!map) return <p>Cargando editor de mapa…</p>;

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Editor de mapa — {venueName}</h1>
          <p>Dibuja secciones, tiers y publica inventario en eventos</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {events.length > 0 && (
            <>
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
                onClick={async () => {
                  const token = localStorage.getItem('boletera_token');
                  if (!token || !publishEventId) return;
                  setPublishMsg(null);
                  try {
                    const r = await publishEvent(token, publishEventId);
                    setPublishMsg(`✓ ${r.totalSeats} boletos en ${r.sections} zonas`);
                  } catch (e) {
                    setPublishMsg(e instanceof Error ? e.message : 'Error');
                  }
                }}
              >
                Publicar en evento
              </button>
            </>
          )}
          <Link href={`/venues/${venueId}/3d`} className={platform.ghostBtn}>
            Vista 3D
          </Link>
        </div>
      </header>
      {publishMsg && <p style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>{publishMsg}</p>}

      <SeatMapEditor
        initial={map}
        onSave={async (mapData) => {
          const token = localStorage.getItem('boletera_token')!;
          await saveVenueLayout(token, venueId, mapData);
          const refreshed = await getVenueLayout(token, venueId);
          setMap(refreshed.layout.mapData);
        }}
        onAiSuggest={async (description) => {
          const token = localStorage.getItem('boletera_token')!;
          const result = await suggestLayout(token, venueId, description);
          await importAiLayout(token, venueId, result.sections);
          const refreshed = await getVenueLayout(token, venueId);
          setMap(refreshed.layout.mapData);
          return result.sections;
        }}
      />
    </div>
  );
}
