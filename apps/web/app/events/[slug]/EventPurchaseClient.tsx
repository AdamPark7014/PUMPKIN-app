'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LiveSeatMap } from '@/components/LiveSeatMap';
import { useCartStore } from '@/lib/cart-store';
import styles from './event.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

interface Seat {
  id: string;
  label: string;
  x: number;
  y: number;
  z?: number;
  status?: string;
  coord3d?: { x: number; y: number; z: number };
}

interface MapData {
  sections: { seats: Seat[] }[];
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export function EventPurchaseClient({
  eventId,
  eventTitle,
  mapData,
  offers,
}: {
  eventId: string;
  eventTitle?: string;
  mapData: unknown;
  offers: { id: string; zone: string; basePrice: string }[];
}) {
  const router = useRouter();
  const addToCart = useCartStore((s) => s.addItem);
  const map = mapData as MapData | null;
  const seats2d = map?.sections?.flatMap((s) => s.seats) ?? [];
  const [seats3d, setSeats3d] = useState<Seat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [view3d, setView3d] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/3d/events/${eventId}/interactive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.venue) return;
        const flat = data.venue.flatMap(
          (section: { seats: Seat[] }) =>
            section.seats?.map((s) => ({
              id: s.id,
              label: s.label,
              x: s.x,
              y: s.y,
              z: s.z,
              status: s.status,
            })) ?? [],
        );
        setSeats3d(flat);
      })
      .catch(() => {});
  }, [eventId]);

  const seats = view3d && seats3d.length ? seats3d : seats2d;
  const selectedSeat = seats.find((s) => s.id === selected[0]);

  async function recommend() {
    setAiLoading(true);
    try {
      const res = await fetch(`${API}/3d/events/${eventId}/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 2, tier: 'premium', viewQuality: 'best' }),
      });
      const data = await res.json();
      const ids = (data.recommended ?? []).map((s: { id: string }) => s.id);
      if (ids.length) setSelected(ids);
    } finally {
      setAiLoading(false);
    }
  }

  async function checkout() {
    if (!selected.length) return;
    setLoading(true);
    try {
      const holdRes = await fetch(`${API}/inventory/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, seatIds: selected, sessionId: crypto.randomUUID() }),
      });
      const holdData = await holdRes.json();
      const holdIds = holdData.holds?.map((h: { id: string }) => h.id) ?? [];
      const offerId = offers[0]?.id ?? '';
      addToCart({
        eventId,
        eventTitle: eventTitle ?? 'Evento',
        holdIds,
        offerId,
        expiresAt: holdData.expiresAt ?? new Date(Date.now() + 900_000).toISOString(),
        seatCount: holdIds.length,
      });
      const params = new URLSearchParams({
        eventId,
        holdIds: holdIds.join(','),
        offerId,
      });
      router.push(`/checkout?${params}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.purchase}>
      <div className={styles.toggle}>
        <button type="button" onClick={() => setView3d(false)} className={!view3d ? styles.active : ''}>
          Mapa 2D
        </button>
        <button type="button" onClick={() => setView3d(true)} className={view3d ? styles.active : ''}>
          Vista 3D + IA
        </button>
        <button type="button" onClick={recommend} disabled={aiLoading} className={styles.aiBtn}>
          {aiLoading ? '…' : '✦ Mejores asientos'}
        </button>
      </div>

      {view3d ? (
        <Venue3DViewer
          mode={selectedSeat ? 'seat' : 'orbit'}
          seats={seats3d.map((s) => ({
            id: s.id,
            x: s.x,
            y: s.y,
            z: s.z ?? 0,
            status: (s.status as 'available' | 'held' | 'sold') ?? 'available',
          }))}
          selectedSeat={
            selectedSeat?.coord3d ?? {
              x: (selectedSeat?.x ?? 0) / 50,
              y: (selectedSeat?.z ?? 0) / 20 + 0.5,
              z: (selectedSeat?.y ?? 0) / 50,
            }
          }
        />
      ) : (
        <LiveSeatMap
          eventId={eventId}
          mapData={map}
          selected={selected}
          offers={offers}
          onToggle={(seatId) =>
            setSelected((prev) =>
              prev.includes(seatId) ? prev.filter((id) => id !== seatId) : [...prev, seatId],
            )
          }
        />
      )}

      <p className={styles.selection}>
        {selected.length ? `${selected.length} asiento(s)` : 'Selecciona asientos o usa recomendación IA'}
      </p>
      <button type="button" className={styles.cta} disabled={!selected.length || loading} onClick={checkout}>
        {loading ? 'Reservando…' : 'Continuar al pago'}
      </button>
    </div>
  );
}
