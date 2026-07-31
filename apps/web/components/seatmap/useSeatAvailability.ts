'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import type { AvailabilitySnapshot } from '@/lib/storefront-types';

type AvailabilityState = {
  statusBySeat: Record<string, string>;
  live: boolean;
  connError: string | null;
  flashIds: Record<string, number>;
};

/**
 * Inventario en vivo: snapshot REST + stream SSE + polling de respaldo.
 * Nunca inventa estados — sólo refleja lo que responde la API.
 */
export function useSeatAvailability(eventId: string): AvailabilityState {
  const [statusBySeat, setStatusBySeat] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});
  const statusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    function applyAvailability(data: AvailabilitySnapshot) {
      const next: Record<string, string> = {};
      for (const t of data.tickets ?? []) {
        if (t.seatId) next[t.seatId] = String(t.status ?? '').toLowerCase();
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
        const res = await fetch(`${API_BASE}/inventory/${eventId}/availability`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          setConnError(
            `Disponibilidad HTTP ${res.status}. Revisa que la API esté en ${API_BASE}.`,
          );
          return;
        }
        applyAvailability((await res.json()) as AvailabilitySnapshot);
      } catch {
        if (!cancelled) {
          setConnError(
            `Sin conexión a la API (${API_BASE}). Arranca el backend en :4000 y recarga.`,
          );
        }
      }
    }

    void loadAvailability();
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/inventory/${eventId}/stream`);
      es.onopen = () => {
        if (!cancelled) setLive(true);
      };
      es.onerror = () => {
        if (!cancelled) setLive(false);
      };
      es.onmessage = (ev) => {
        try {
          applyAvailability(JSON.parse(ev.data) as AvailabilitySnapshot);
        } catch {
          void loadAvailability();
        }
      };
    } catch {
      setLive(false);
    }
    const poll = setInterval(() => void loadAvailability(), 12_000);

    return () => {
      cancelled = true;
      es?.close();
      clearInterval(poll);
    };
  }, [eventId]);

  return { statusBySeat, live, connError, flashIds };
}
