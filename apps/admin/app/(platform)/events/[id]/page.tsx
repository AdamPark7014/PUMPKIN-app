'use client';

import { useEffect, useState } from 'react';
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
  type EventHub,
} from '@/lib/platform-api';
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
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [offerEdits, setOfferEdits] = useState<Record<string, string>>({});
  const [pricingSaving, setPricingSaving] = useState<string | null>(null);
  const [dynamicPricing, setDynamicPricing] = useState(false);

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
    await setEventPricing(token, id, {
      basePrice: base,
      dynamicPricingEnabled: dynamicPricing,
    });
    setPricingSaving('Pricing dinámico actualizado');
    setTimeout(() => setPricingSaving(null), 2500);
  }

  useEffect(() => {
    reload();
  }, [id]);

  async function saveChannels() {
    const total = channels.web + channels.taquilla + channels.api;
    if (total !== 100) {
      setChannelError(`La suma debe ser 100% (actual: ${total}%)`);
      return;
    }
    setChannelError(null);
    const token = localStorage.getItem('boletera_token');
    if (!token || !id) return;
    setSaving(true);
    try {
      await configureChannels(token, id, {
        web: { enabled: true, allocation: channels.web },
        taquilla: { enabled: true, allocation: channels.taquilla, locations: [] },
        api: { enabled: true, allocation: channels.api },
      });
      reload();
    } catch (e) {
      setChannelError(e instanceof Error ? e.message : 'Error al guardar');
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
      reload();
    } finally {
      setPricingSaving(null);
    }
  }

  const [seatPreview, setSeatPreview] = useState<{ x: number; y: number; z: number } | undefined>();

  useEffect(() => {
    if (tab === 'map3d' && id) {
      fetch(`${API}/3d/events/${id}/interactive`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { venue?: { seats: { x: number; y: number; z: number; status: string }[] }[] } | null) => {
          const first = data?.venue?.[0]?.seats?.find((s) => s.status === 'available');
          if (first) setSeatPreview({ x: first.x / 50, y: first.z / 20, z: first.y / 50 });
        });
    }
  }, [tab, id]);

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
              const token = localStorage.getItem('boletera_token');
              if (!token || !id) return;
              setPublishing(true);
              setPublishMsg(null);
              try {
                const r = await publishEvent(token, id);
                setPublishMsg(`Publicado: ${r.totalSeats} boletos en ${r.sections} zonas`);
                reload();
              } catch (e) {
                setPublishMsg(e instanceof Error ? e.message : 'Error al publicar');
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
      {publishMsg && (
        <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#404040' }}>{publishMsg}</p>
      )}

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
          {channelError && <p style={{ color: '#b91c1c', fontSize: '0.875rem' }}>{channelError}</p>}
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
          <Venue3DViewer mode={seatPreview ? 'seat' : 'orbit'} selectedSeat={seatPreview} />
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


