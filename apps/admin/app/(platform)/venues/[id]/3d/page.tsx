'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { flatSeats, normalizeSeatMap } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import { getVenueLayout } from '@/lib/platform-api';
import platform from '../../../_styles/platform.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

export default function Venue3DPage() {
  const { id: venueId } = useParams<{ id: string }>();
  const [mapData, setMapData] = useState<SeatMapData | null>(null);
  const [venueName, setVenueName] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token || !venueId) return;
    getVenueLayout(token, venueId).then((data) => {
      setMapData(data.layout.mapData);
      setVenueName(data.venue?.name ?? 'Venue');
    });
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

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Preview 3D — {venueName || 'Venue'}</h1>
          <p>{seats.length} asientos reales del layout guardado</p>
        </div>
        <Link href={`/venues/${venueId}/map`} className={platform.ghostBtn}>
          Editar mapa 2D
        </Link>
      </header>
      {!mapData ? (
        <p>Cargando venue…</p>
      ) : seats.length === 0 ? (
        <p>Este venue todavía no tiene asientos en su layout. Ve al editor de mapa y aplica una plantilla.</p>
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
