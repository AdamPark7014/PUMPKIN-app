'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  getEventHub,
  configureChannels,
  getChannelHealth,
  publishEvent,
  updateOffer,
  setEventPricing,
  getVenueLayout,
  type EventHub,
} from '@/lib/platform-api';
import { flatSeats, normalizeSeatMap, resolveOfferForSection } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../../_styles/platform.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type Tab = 'overview' | 'channels' | 'map3d' | 'pricing';
type ChannelPct = { web: number; taquilla: number; api: number };

function parseChannelAllocation(metadata: Record<string, unknown>): ChannelPct {
  const channels = metadata?.channels as Record<string, { allocation?: number }> | undefined;
  const alloc = metadata?.channelAllocation as Record<string, { allocation?: number }> | undefined;
  const src = channels ?? alloc;
  if (src && typeof src === 'object') {
    return {
      web: Number(src.web?.allocation ?? 50),
      taquilla: Number(src.taquilla?.allocation ?? 35),
      api: Number(src.api?.allocation ?? 15),
    };
  }
  return { web: 50, taquilla: 35, api: 15 };
}

export default function EventHubPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [hub, setHub] = useState<EventHub | null>(null);
  const [health, setHealth] = useState<Record<string, { orders?: number; revenue?: number; status?: string }> | null>(null);
  const [channels, setChannels] = useState<ChannelPct>({ web: 50, taquilla: 35, api: 15 });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [offerEdits, setOfferEdits] = useState<Record<string, string>>({});
  const [pricingSaving, setPricingSaving] = useState<string | null>(null);
  const [dynamicPricing, setDynamicPricing] = useState(false);
  const toast = useToast();

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !id) return;
    getEventHub(token, id).then((data) => {
      setHub(data);
      setChannels(parseChannelAllocation(data.metadata ?? {}));
      const edits: Record<string, string> = {};
      data.event.offers?.forEach((o) => {
        edits[o.id] = String(o.basePrice);
      });
      setOfferEdits(edits);
      setDynamicPricing(Boolean((data.event as { enableDynamic?: boolean }).enableDynamic));
    });
    getChannelHealth(token, id).then(setHealth).catch(() => {});
  }

  async function saveDynamicPricing() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !id || !hub) return;
    const base = Number(hub.event.offers?.[0]?.basePrice ?? 100);
    try {
      await setEventPricing(token, id, {
        basePrice: base,
        dynamicPricingEnabled: dynamicPricing,
      });
      toast.success('Pricing dinámico actualizado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar el pricing dinámico');
    }
  }

  useEffect(() => {
    reload();
  }, [id]);

  async function saveChannels() {
    const total = channels.web + channels.taquilla + channels.api;
    if (total !== 100) {
      toast.error(`La suma debe ser 100% (actual: ${total}%)`);
      return;
    }
    const token = localStorage.getItem('boletera_token');
    if (!token || !id) return;
    setSaving(true);
    try {
      await configureChannels(token, id, {
        web: { enabled: true, allocation: channels.web },
        taquilla: { enabled: true, allocation: channels.taquilla, locations: [] },
        api: { enabled: true, allocation: channels.api },
      });
      toast.success('Canales guardados');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function saveOfferPrice(offerId: string) {
    const token = localStorage.getItem('boletera_token');
    if (!token || !id) return;
    const price = Number(offerEdits[offerId]);
    if (!Number.isFinite(price) || price <= 0) return;
    setPricingSaving(offerId);
    try {
      await updateOffer(token, id, offerId, { basePrice: price });
      toast.success('Precio actualizado');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar el precio');
    } finally {
      setPricingSaving(null);
    }
  }

  const [seats3dStatus, setSeats3dStatus] = useState<Record<string, string>>({});
  const [venueMapData, setVenueMapData] = useState<SeatMapData | null>(null);

  useEffect(() => {
    if (tab !== 'map3d' || !id) return;
    fetch(`${API}/3d/events/${id}/interactive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { statusBySeat?: Record<string, string> } | null) => {
        if (data?.statusBySeat) setSeats3dStatus(data.statusBySeat);
      })
      .catch(() => {});
  }, [tab, id]);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    const vId = (hub?.event as { venue?: { id?: string } } | undefined)?.venue?.id;
    if (tab !== 'map3d' || !token || !vId) return;
    getVenueLayout(token, vId).then((data) => setVenueMapData(data.layout.mapData));
  }, [tab, hub]);

  const normalizedVenueMap = useMemo(
    () => (venueMapData ? normalizeSeatMap(venueMapData) : null),
    [venueMapData],
  );

  const seatsFor3d = useMemo(() => {
    const normalized = normalizedVenueMap;
    if (!normalized) return [];
    const offers = hub?.event.offers ?? [];
    return flatSeats(normalized).map((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(offers, sec?.slug ?? '', seat.sectionName);
      return {
        id: seat.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        z: seat.position?.y ?? seat.elevation ?? 0,
        rotation: seat.rotation,
        row: seat.row,
        elevation: seat.elevation,
        position: seat.position,
        rotation3d: seat.rotation3d,
        coord3d: seat.coord3d,
        visibility: seat.visibility,
        section: seat.sectionName,
        color: seat.sectionColor,
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status:
          seat.visibility?.blocked
            ? ('blocked' as const)
            : (seats3dStatus[seat.id] as 'available' | 'held' | 'sold' | 'blocked') || 'available',
      };
    });
  }, [normalizedVenueMap, hub, seats3dStatus]);

  if (!hub) {
    return <p>Cargando evento…</p>;
  }

  const { event, inventory } = hub;
  const venueId = (event as { venue?: { id?: string } }).venue?.id ?? '';
  const channelTotal = channels.web + channels.taquilla + channels.api;

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>{event.title}</h1>
          <p>
            {event.venue?.name} · {new Date(event.startsAt).toLocaleString('es-MX')} ·{' '}
            {inventory.occupancyPercent}% ocupación · {event.status}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={publishing}
            onClick={async () => {
              if (!confirm('¿Publicar el inventario de este evento? Esto genera los boletos vendibles a partir del mapa guardado.')) return;
              const token = localStorage.getItem('boletera_token');
              if (!token || !id) return;
              setPublishing(true);
              try {
                const r = await publishEvent(token, id);
                toast.success(`Publicado: ${r.totalSeats} boletos en ${r.sections} zonas`);
                reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Error al publicar');
              } finally {
                setPublishing(false);
              }
            }}
          >
            {publishing ? 'Publicando…' : 'Publicar inventario'}
          </button>
          {venueId && (
            <Link href={`/venues/${venueId}/map`} className={platform.ghostBtn}>
              Editor de mapa
            </Link>
          )}
          <Link href="/events" className={platform.ghostBtn}>
            ← Eventos
          </Link>
        </div>
      </header>

      <div className={platform.cardGrid}>
        <article className={platform.statCard}>
          <span>Vendidos</span>
          <strong>{inventory.sold}</strong>
          <small>de {inventory.total}</small>
        </article>
        <article className={platform.statCard}>
          <span>Disponibles</span>
          <strong>{inventory.available}</strong>
        </article>
        <article className={platform.statCard}>
          <span>En hold</span>
          <strong>{inventory.held}</strong>
        </article>
        <article className={platform.statCard}>
          <span>Órdenes</span>
          <strong>{event._count?.orders ?? 0}</strong>
        </article>
      </div>

      <nav className={platform.tabs}>
        {(['overview', 'channels', 'map3d', 'pricing'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? platform.active : ''} onClick={() => setTab(t)}>
            {t === 'overview' && 'Resumen'}
            {t === 'channels' && 'Canales'}
            {t === 'map3d' && 'Mapa 3D'}
            {t === 'pricing' && 'Precios'}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <section className={platform.panel}>
          <h2>Ventas por canal</h2>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Órdenes</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {hub.channels.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td>{c._count}</td>
                  <td>${Number(c._sum.totalAmount ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#737373' }}>
            Asignación: Web {channels.web}% · Taquilla {channels.taquilla}% · API {channels.api}%
          </p>
        </section>
      )}

      {tab === 'channels' && (
        <section className={platform.panel}>
          <h2>Asignación multi-canal (100%)</h2>
          <div>
            <label>
              Web %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.web}
                onChange={(e) => setChannels({ ...channels, web: Number(e.target.value) })}
              />
              <span>{channels.web}%</span>
            </label>
            <label>
              Taquilla %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.taquilla}
                onChange={(e) => setChannels({ ...channels, taquilla: Number(e.target.value) })}
              />
              <span>{channels.taquilla}%</span>
            </label>
            <label>
              API %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.api}
                onChange={(e) => setChannels({ ...channels, api: Number(e.target.value) })}
              />
              <span>{channels.api}%</span>
            </label>
          </div>
          <p style={{ fontSize: '0.8125rem', color: channelTotal === 100 ? '#404040' : '#b91c1c' }}>
            Total: {channelTotal}% {channelTotal !== 100 && '— ajusta hasta 100%'}
          </p>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={saving || channelTotal !== 100}
            onClick={saveChannels}
          >
            {saving ? 'Guardando…' : 'Guardar canales'}
          </button>
          {health && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>Salud en tiempo real</h3>
              <div className={platform.cardGrid}>
                {Object.entries(health).map(([key, val]) => (
                  <article key={key} className={platform.statCard}>
                    <span>{key}</span>
                    <strong>{val.status ?? '—'}</strong>
                    <small>
                      {val.orders ?? 0} órdenes · ${(val.revenue ?? 0).toLocaleString()}
                    </small>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'map3d' && (
        <section className={platform.panel}>
          <h2>Vista 3D + asientos en vivo</h2>
          {venueMapData && seatsFor3d.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: '#737373' }}>
              El venue todavía no tiene asientos en su layout.
            </p>
          ) : (
            <Venue3DViewer
              mode="orbit"
              seats={seatsFor3d}
              currency="MXN"
              stage={normalizedVenueMap?.venue?.stage}
              aisles={normalizedVenueMap?.venue?.aisles}
              obstacles={normalizedVenueMap?.venue?.obstacles}
              stairs={normalizedVenueMap?.venue?.stairs}
              exits={normalizedVenueMap?.venue?.exits}
              furniture={normalizedVenueMap?.venue?.furniture}
              focusPoints={normalizedVenueMap?.venue?.focusPoints}
              levels={normalizedVenueMap?.venue?.levels}
              mapData={normalizedVenueMap}
            />
          )}
          <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#737373' }}>
            Publica inventario antes de vender. Editor:{' '}
            <Link href={`/venues/${venueId}/map`}>mapa del venue</Link>
          </p>
        </section>
      )}

      {tab === 'pricing' && (
        <section className={platform.panel}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="checkbox"
              checked={dynamicPricing}
              onChange={(e) => setDynamicPricing(e.target.checked)}
            />
            Pricing dinámico (surge por ocupación)
          </label>
          <button type="button" className={platform.ghostBtn} onClick={saveDynamicPricing}>
            Guardar reglas dinámicas
          </button>
          <h2>Ofertas / zonas</h2>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Zona</th>
                <th>Nombre</th>
                <th>Precio (MXN)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {event.offers?.map((o) => (
                <tr key={o.id}>
                  <td>{o.zone}</td>
                  <td>{o.name}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={50}
                      value={offerEdits[o.id] ?? o.basePrice}
                      onChange={(e) => setOfferEdits({ ...offerEdits, [o.id]: e.target.value })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      disabled={pricingSaving === o.id}
                      onClick={() => saveOfferPrice(o.id)}
                    >
                      {pricingSaving === o.id ? '…' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}


