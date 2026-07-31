'use client';

import dynamic from 'next/dynamic';
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { useRouter } from 'next/navigation';
import type { SelectedSeatInfo } from '@/components/SeatMapViewer';
import {
  flatSeats,
  normalizeSeatMap,
  resolveOfferForSection,
} from '@boletera/venue-engine';
import type { Venue3DViewerProps } from '@boletera/venue-3d';
import { API_BASE, errorMessage } from '@/lib/api';
import { useCartStore, type CartOfferLine } from '@/lib/cart-store';
import { money, plural } from '@/lib/format';
import type { CartPricing, HoldResponse, OfferSummary } from '@/lib/storefront-types';
import styles from './event.module.scss';

type MapOffer = { id: string; zone: string; name?: string; basePrice: string };

function toMapOffers(offers: OfferSummary[]): MapOffer[] {
  return offers.map((o) => ({
    id: o.id,
    zone: o.zone,
    name: o.name ?? undefined,
    basePrice: o.basePrice,
  }));
}

const SeatMapViewer = dynamic(
  () =>
    import('@/components/SeatMapViewer').then((m) => m.SeatMapViewer),
  {
    ssr: false,
    loading: () => (
      <p className={styles.mapLoading} role="status">
        Cargando mapa de asientos…
      </p>
    ),
  },
);

const SECTION_PALETTE = ['#5b9fd4', '#c45c6a', '#c4a35a', '#5a9e78', '#7a8fd4', '#b87a9a'];

function colorForSection(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SECTION_PALETTE[h % SECTION_PALETTE.length];
}

function offerLabel(o: Pick<OfferSummary, 'name' | 'zone'>): string {
  return o.name?.trim() || `Zona ${o.zone.toUpperCase()}`;
}

export function EventPurchaseClient({
  eventId,
  eventTitle,
  slug,
  startsAt,
  venueName,
  venueCity,
  mapData,
  offers,
  minPrice = 0,
  currency = 'MXN',
  focusZone = null,
  canPurchase = true,
  saleMessage = null,
  maxTickets = 8,
  holdMinutes = 15,
}: {
  eventId: string;
  eventTitle?: string;
  slug?: string;
  startsAt?: string;
  venueName?: string;
  venueCity?: string;
  mapData: unknown;
  offers: OfferSummary[];
  minPrice?: number;
  currency?: string;
  focusZone?: string | null;
  canPurchase?: boolean;
  saleMessage?: string | null;
  maxTickets?: number;
  holdMinutes?: number;
}) {
  const router = useRouter();
  const addToCart = useCartStore((s) => s.addItem);
  const ticketCap = Math.min(Math.max(1, maxTickets || 8), 8);

  const mapOffers = useMemo(() => toMapOffers(offers), [offers]);
  const normalized = useMemo(() => normalizeSeatMap(mapData), [mapData]);
  const seats2d = useMemo(() => flatSeats(normalized), [normalized]);
  const hasSeatMap = seats2d.length > 0;

  const [seats3dStatus, setSeats3dStatus] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [view3d, setView3d] = useState(false);
  const [Venue3DViewer, setVenue3DViewer] = useState<ComponentType<Venue3DViewerProps> | null>(
    null,
  );
  const [viewer3dError, setViewer3dError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyMode, setBuyMode] = useState<'map' | 'best' | 'ga'>(hasSeatMap ? 'map' : 'ga');
  const [qty, setQty] = useState(Math.min(2, ticketCap));
  const [livePricing, setLivePricing] = useState<CartPricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);

  const focusedOffer = useMemo(() => {
    if (focusZone) {
      const needle = focusZone.toLowerCase();
      return (
        mapOffers.find(
          (o) =>
            o.zone.toLowerCase() === needle ||
            (o.name && o.name.toLowerCase().includes(needle)),
        ) ?? null
      );
    }
    for (const sec of normalized.sections) {
      const match = resolveOfferForSection(mapOffers, sec.slug, sec.name);
      if (match && (match.zone === sec.slug || match.name === sec.name || match.zone === sec.name)) {
        return match;
      }
      const bySlug = mapOffers.find((o) => o.zone.toLowerCase() === sec.slug.toLowerCase());
      if (bySlug) return bySlug;
    }
    return mapOffers[0] ?? null;
  }, [focusZone, mapOffers, normalized.sections]);

  const seatsForFocusedOffer = useMemo(() => {
    if (!focusedOffer) return [];
    return seats2d.filter((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(mapOffers, sec?.slug ?? '', seat.sectionName);
      return offer?.id === focusedOffer.id;
    });
  }, [focusedOffer, seats2d, normalized.sections, mapOffers]);

  const isGaOffer = useMemo(() => {
    if (!hasSeatMap) return true;
    if (!focusedOffer || !focusZone) return false;
    if (seatsForFocusedOffer.length > 0) return false;
    const label = `${focusedOffer.zone} ${focusedOffer.name ?? ''}`.toLowerCase();
    return /\bga\b|general|pista/.test(label);
  }, [hasSeatMap, focusedOffer, focusZone, seatsForFocusedOffer.length]);

  useEffect(() => {
    if (!hasSeatMap) {
      setBuyMode('ga');
      return;
    }
    if (isGaOffer) setBuyMode('ga');
    else setBuyMode((m) => (m === 'ga' ? 'map' : m));
  }, [hasSeatMap, isGaOffer]);

  useEffect(() => {
    setQty((q) => Math.min(q, ticketCap));
  }, [ticketCap]);

  useEffect(() => {
    if (!view3d || Venue3DViewer || viewer3dError) return;
    let cancelled = false;
    import('@boletera/venue-3d')
      .then((m) => {
        if (cancelled) return;
        setVenue3DViewer(() => m.Venue3DViewer);
      })
      .catch(() => {
        if (cancelled) return;
        setViewer3dError('No se pudo cargar la vista 3D');
        setView3d(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view3d, Venue3DViewer, viewer3dError]);

  useEffect(() => {
    fetch(`${API_BASE}/3d/events/${eventId}/interactive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (!data || typeof data !== 'object') return;
        const payload = data as {
          statusBySeat?: Record<string, string>;
          venue?: { seats?: { id: string; status?: string }[] }[];
        };
        if (payload.statusBySeat && typeof payload.statusBySeat === 'object') {
          setSeats3dStatus(payload.statusBySeat);
          return;
        }
        if (!payload.venue) return;
        const status: Record<string, string> = {};
        for (const section of payload.venue) {
          for (const s of section.seats ?? []) {
            if (s.status) status[s.id] = s.status;
          }
        }
        setSeats3dStatus(status);
      })
      .catch(() => {});
  }, [eventId]);

  const seatsFor3d = useMemo(() => {
    return seats2d.map((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(mapOffers, sec?.slug ?? '', seat.sectionName);
      return {
        id: seat.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        z: seat.position?.y ?? seat.elevation ?? 0,
        rotation: seat.rotation ?? 0,
        row: seat.row,
        elevation: seat.elevation,
        position: seat.position,
        rotation3d: seat.rotation3d,
        coord3d: seat.coord3d,
        visibility: seat.visibility,
        section: seat.sectionName,
        color: seat.sectionColor || colorForSection(seat.sectionName || sec?.slug || 'zona'),
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status:
          seat.visibility?.blocked
            ? ('blocked' as const)
            : (seats3dStatus[seat.id] as 'available' | 'held' | 'sold' | 'blocked') || 'available',
      };
    });
  }, [seats2d, normalized.sections, mapOffers, seats3dStatus]);

  const selectedInfo: SelectedSeatInfo[] = useMemo(() => {
    return selected
      .map((id) => {
        const seat = seats2d.find((s) => s.id === id);
        if (!seat) return null;
        const sec = normalized.sections.find((s) => s.id === seat.sectionId);
        const offer = resolveOfferForSection(mapOffers, sec?.slug ?? '', seat.sectionName);
        return {
          seatId: id,
          label: seat.label,
          sectionName: seat.sectionName,
          sectionSlug: sec?.slug ?? '',
          price: offer ? Number(offer.basePrice) : 0,
          offerId: offer?.id ?? '',
        };
      })
      .filter((x): x is SelectedSeatInfo => Boolean(x));
  }, [selected, seats2d, normalized.sections, mapOffers]);

  const estimate = selectedInfo.reduce((sum, info) => sum + info.price, 0);
  const bestEstimate = focusedOffer ? Number(focusedOffer.basePrice) * qty : 0;

  const pricingKey = useMemo(() => {
    if (buyMode === 'map') {
      const byOffer = new Map<string, number>();
      for (const info of selectedInfo) {
        if (!info.offerId) continue;
        byOffer.set(info.offerId, (byOffer.get(info.offerId) ?? 0) + 1);
      }
      return Array.from(byOffer.entries())
        .map(([offerId, quantity]) => `${offerId}:${quantity}`)
        .sort()
        .join('|');
    }
    if (focusedOffer && qty > 0) {
      return `${focusedOffer.id}:${qty}`;
    }
    return '';
  }, [buyMode, selectedInfo, focusedOffer, qty]);

  useEffect(() => {
    if (!canPurchase || !pricingKey) {
      setLivePricing(null);
      setPricingLoading(false);
      return;
    }
    const items = pricingKey.split('|').map((part) => {
      const [offerId, quantityRaw] = part.split(':');
      return { offerId, quantity: Number(quantityRaw) };
    });
    const controller = new AbortController();
    setPricingLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/pricing/calculate-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ eventId, items }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('pricing');
          return res.json() as Promise<CartPricing>;
        })
        .then((data) => {
          setLivePricing(data);
          setPricingLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setLivePricing(null);
          setPricingLoading(false);
        });
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [canPurchase, eventId, pricingKey]);

  function toggleSeat(seatId: string) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(seatId)) return prev.filter((id) => id !== seatId);
      if (prev.length >= ticketCap) return prev;
      return [...prev, seatId];
    });
  }

  function groupLines(
    infos: SelectedSeatInfo[],
    holdBySeat: Map<string, string>,
  ): CartOfferLine[] {
    const byOffer = new Map<string, CartOfferLine>();
    for (const info of infos) {
      const holdId = holdBySeat.get(info.seatId);
      if (!holdId || !info.offerId) continue;
      const existing = byOffer.get(info.offerId);
      const label = info.sectionName ? `${info.sectionName} · ${info.label}` : info.label;
      if (existing) {
        existing.holdIds.push(holdId);
        existing.seatLabels = [...(existing.seatLabels ?? []), label];
        existing.quantity += 1;
        existing.lineTotal = (existing.lineTotal ?? 0) + info.price;
      } else {
        const offer = mapOffers.find((o) => o.id === info.offerId);
        byOffer.set(info.offerId, {
          offerId: info.offerId,
          offerName: offer?.name || offer?.zone,
          holdIds: [holdId],
          seatLabels: [label],
          quantity: 1,
          lineTotal: info.price,
        });
      }
    }
    return Array.from(byOffer.values());
  }

  function goCheckout(lines: CartOfferLine[], expiresAt: string) {
    const seatCount = lines.reduce((s, l) => s + l.quantity, 0);
    addToCart({
      eventId,
      eventTitle: eventTitle ?? 'Evento',
      slug,
      startsAt,
      venueName,
      venueCity,
      expiresAt,
      seatCount,
      currency,
      lines,
    });
    const params = new URLSearchParams({
      eventId,
      holdIds: lines.flatMap((l) => l.holdIds).join(','),
      expiresAt,
    });
    if (lines.length === 1) params.set('offerId', lines[0].offerId);
    router.push(`/checkout?${params}`);
  }

  async function checkoutMap() {
    if (!canPurchase || !selected.length) return;
    setLoading(true);
    setError(null);
    try {
      const holdRes = await fetch(`${API_BASE}/inventory/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, seatIds: selected, sessionId: crypto.randomUUID() }),
      });
      const holdData = (await holdRes.json()) as HoldResponse & { message?: string };
      if (!holdRes.ok) {
        throw new Error(holdData.message || 'No se pudieron reservar los asientos');
      }
      const holds = holdData.holds ?? [];
      const holdBySeat = new Map<string, string>();
      for (const h of holds) {
        if (h.seatId) holdBySeat.set(h.seatId, h.id);
      }
      if (holdBySeat.size === 0 && holds.length === selected.length) {
        selected.forEach((seatId, i) => holdBySeat.set(seatId, holds[i].id));
      }
      const lines = groupLines(selectedInfo, holdBySeat);
      if (!lines.length) throw new Error('No se pudo asociar ofertas a los asientos');
      const expiresAt =
        holdData.expiresAt ?? new Date(Date.now() + holdMinutes * 60_000).toISOString();
      goCheckout(lines, expiresAt);
    } catch (e) {
      setError(errorMessage(e, 'No se pudieron reservar los asientos. Inténtalo de nuevo.'));
    } finally {
      setLoading(false);
    }
  }

  async function checkoutBestOrGa() {
    if (!canPurchase || !focusedOffer) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        buyMode === 'ga'
          ? `${API_BASE}/inventory/holds`
          : `${API_BASE}/inventory/holds/best-available`;
      const body =
        buyMode === 'ga'
          ? {
              eventId,
              offerId: focusedOffer.id,
              quantity: qty,
              sessionId: crypto.randomUUID(),
            }
          : {
              eventId,
              offerId: focusedOffer.id,
              quantity: qty,
              contiguous: true,
              sessionId: crypto.randomUUID(),
            };
      const holdRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const holdData = (await holdRes.json()) as HoldResponse & { message?: string };
      if (!holdRes.ok) {
        throw new Error(holdData.message || 'No se pudieron reservar boletos');
      }
      const holds = holdData.holds ?? [];
      const seatLabels: string[] =
        holdData.seats?.map(
          (s) =>
            s.label ||
            [s.section, s.row ? `Fila ${s.row}` : null, s.seatNumber]
              .filter(Boolean)
              .join(' · '),
        ) ??
        Array.from(
          { length: holds.length },
          (_, i) => `${offerLabel(focusedOffer)} · ${i + 1}`,
        );
      const lines: CartOfferLine[] = [
        {
          offerId: focusedOffer.id,
          offerName: focusedOffer.name || focusedOffer.zone,
          holdIds: holds.map((h) => h.id),
          seatLabels,
          quantity: holds.length,
          lineTotal: Number(focusedOffer.basePrice) * holds.length,
        },
      ];
      const expiresAt =
        holdData.expiresAt ?? new Date(Date.now() + holdMinutes * 60_000).toISOString();
      goCheckout(lines, expiresAt);
    } catch (e) {
      setError(errorMessage(e, 'No se pudieron reservar boletos. Inténtalo de nuevo.'));
    } finally {
      setLoading(false);
    }
  }

  const canPayMap = selected.length > 0 && buyMode === 'map';
  const canPayQty =
    (buyMode === 'best' || buyMode === 'ga') && qty > 0 && Boolean(focusedOffer);
  const buyDisabled =
    loading || !canPurchase || (buyMode === 'map' ? !canPayMap : !canPayQty);

  const stickySubtitle = (() => {
    if (!canPurchase) return saleMessage ?? 'La venta no está abierta';
    if (livePricing) {
      return `Estimado ${money(livePricing.total, currency)} (con cargos)`;
    }
    if (pricingLoading) return 'Calculando cargos…';
    if (buyMode === 'map') {
      return selected.length
        ? `Subtotal ${money(estimate, currency)} · cargos en checkout`
        : minPrice > 0
          ? `Desde ${money(minPrice, currency)}`
          : 'Elige asientos en el mapa';
    }
    return `Subtotal ${money(bestEstimate, currency)} · cargos en checkout`;
  })();

  return (
    <div className={styles.buyBox}>
      {!canPurchase && saleMessage && (
        <div className={styles.inlineError} role="status">
          {saleMessage}
        </div>
      )}

      <div className={styles.toggle} role="tablist" aria-label="Modo de compra">
        {!isGaOffer && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={buyMode === 'map'}
              onClick={() => {
                setBuyMode('map');
                setError(null);
              }}
              className={buyMode === 'map' ? styles.active : undefined}
              disabled={!canPurchase}
            >
              Elegir en mapa
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={buyMode === 'best'}
              onClick={() => {
                setBuyMode('best');
                setError(null);
              }}
              className={buyMode === 'best' ? styles.active : undefined}
              disabled={!canPurchase}
            >
              Mejor disponible
            </button>
          </>
        )}
        {(isGaOffer || buyMode === 'ga') && (
          <button
            type="button"
            role="tab"
            aria-selected={buyMode === 'ga'}
            onClick={() => {
              setBuyMode('ga');
              setError(null);
            }}
            className={buyMode === 'ga' ? styles.active : undefined}
            disabled={!canPurchase}
          >
            Entrada general
          </button>
        )}
        {buyMode === 'map' && !isGaOffer && (
          <>
            <button
              type="button"
              onClick={() => setView3d(false)}
              className={!view3d ? styles.active : undefined}
              aria-pressed={!view3d}
              disabled={!canPurchase}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setView3d(true)}
              className={view3d ? styles.active : undefined}
              aria-pressed={view3d}
              disabled={!seatsFor3d.length || Boolean(viewer3dError) || !canPurchase}
              title={viewer3dError ?? undefined}
            >
              3D
            </button>
          </>
        )}
      </div>

      {(buyMode === 'best' || buyMode === 'ga') && focusedOffer && (
        <div className={styles.qtyPanel}>
          <div>
            <p className={styles.qtyTitle}>
              {buyMode === 'ga' ? 'Entrada general' : 'Mejor disponible'}
            </p>
            <p className={styles.qtyMeta}>
              {offerLabel(focusedOffer)} · {money(focusedOffer.basePrice, currency)} c/u
            </p>
          </div>
          <label className={styles.qtyStepper}>
            <span>Cantidad</span>
            <div>
              <button
                type="button"
                onClick={() => {
                  setQty((q) => Math.max(1, q - 1));
                  setError(null);
                }}
                aria-label="Menos boletos"
                disabled={!canPurchase || qty <= 1}
              >
                −
              </button>
              <strong aria-live="polite">{qty}</strong>
              <button
                type="button"
                onClick={() => {
                  setQty((q) => Math.min(ticketCap, q + 1));
                  setError(null);
                }}
                aria-label="Más boletos"
                disabled={!canPurchase || qty >= ticketCap}
              >
                +
              </button>
            </div>
          </label>
        </div>
      )}

      {buyMode === 'map' && !isGaOffer && (
        seats2d.length === 0 ? (
          <p className={styles.qtyMeta}>
            Este evento aún no tiene mapa de asientos publicado. Usa «Mejor disponible» o
            vuelve más tarde.
          </p>
        ) : view3d ? (
          Venue3DViewer ? (
            <Venue3DViewer
              mode="orbit"
              height={520}
              currency={currency}
              seats={seatsFor3d}
              selectedIds={selected}
              onToggleSeat={toggleSeat}
              stage={normalized.venue?.stage}
              aisles={normalized.venue?.aisles}
              obstacles={normalized.venue?.obstacles}
              stairs={normalized.venue?.stairs}
              exits={normalized.venue?.exits}
              furniture={normalized.venue?.furniture}
              focusPoints={normalized.venue?.focusPoints}
              levels={normalized.venue?.levels}
              mapData={normalized}
            />
          ) : (
            <p className={styles.mapLoading} role="status">
              Cargando vista 3D del venue…
            </p>
          )
        ) : (
          <SeatMapViewer
            eventId={eventId}
            mapData={normalized}
            selected={selected}
            offers={mapOffers}
            currency={currency}
            focusZone={focusZone}
            onToggle={toggleSeat}
            onClear={() => {
              setSelected([]);
              setError(null);
            }}
          />
        )
      )}

      {error && (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <div className={styles.stickyBuy} aria-live="polite">
        <div className={styles.stickyCopy}>
          <p className={styles.stickyTitle}>
            {buyMode === 'map'
              ? selected.length
                ? `${plural(selected.length, 'asiento')} · listos`
                : 'Selecciona asientos en el mapa'
              : `${plural(qty, 'boleto')} · ${focusedOffer ? offerLabel(focusedOffer) : 'zona'}`}
          </p>
          <p className={styles.stickyMeta}>{stickySubtitle}</p>
        </div>
        <button
          type="button"
          className={styles.cta}
          disabled={buyDisabled}
          onClick={() => (buyMode === 'map' ? checkoutMap() : checkoutBestOrGa())}
        >
          {loading
            ? 'Reservando…'
            : !canPurchase
              ? 'No disponible'
              : 'Continuar al pago'}
        </button>
      </div>
      <div className={styles.buyBarSpacer} aria-hidden />
    </div>
  );
}
