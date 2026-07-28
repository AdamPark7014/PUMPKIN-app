'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import {
  normalizeCartItem,
  secondsUntil,
  useCartStore,
  type CartItem,
} from '@/lib/cart-store';
import styles from './cart.module.scss';

function fmtMoney(n: number, currency = 'MXN') {
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTimer(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function seatSummary(item: CartItem) {
  const labels =
    item.lines?.flatMap((l) => l.seatLabels ?? []) ?? item.seatLabels ?? [];
  if (!labels.length) return null;
  const shown = labels.slice(0, 6).join(' · ');
  return labels.length > 6 ? `${shown}…` : shown;
}

function lineBreakdown(item: CartItem) {
  if (!item.lines?.length) return null;
  if (item.lines.length === 1 && !item.lines[0].offerName) return null;
  return item.lines
    .map((l) => `${l.offerName || 'Zona'} ×${l.quantity || l.holdIds.length}`)
    .join(' · ');
}

function itemTotal(item: CartItem) {
  const fromLines = item.lines?.reduce((s, l) => s + (l.lineTotal ?? 0), 0) ?? 0;
  if (fromLines > 0) return fromLines;
  return item.lineTotal ?? 0;
}

function goCheckout(router: ReturnType<typeof useRouter>, item: CartItem) {
  const normalized = normalizeCartItem(item);
  const lines = normalized.lines?.length
    ? normalized.lines
    : normalized.offerId && normalized.holdIds
      ? [{ offerId: normalized.offerId, holdIds: normalized.holdIds }]
      : [];
  const params = new URLSearchParams({
    eventId: normalized.eventId,
    holdIds: lines.flatMap((l) => l.holdIds).join(','),
    expiresAt: normalized.expiresAt,
  });
  if (lines.length === 1) params.set('offerId', lines[0].offerId);
  router.push(`/checkout?${params}`);
}

export default function CartPage() {
  const rawItems = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const clear = useCartStore((s) => s.clear);
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => rawItems.map(normalizeCartItem), [rawItems, tick]);

  const active = items.filter((i) => secondsUntil(i.expiresAt) > 0);
  const expired = items.filter((i) => secondsUntil(i.expiresAt) <= 0);
  const estimated = active.reduce((s, i) => s + itemTotal(i), 0);
  const seatCount = active.reduce((s, i) => s + i.seatCount, 0);
  const currency = active[0]?.currency || 'MXN';
  const soonest = active.reduce(
    (min, i) => Math.min(min, secondsUntil(i.expiresAt)),
    Number.POSITIVE_INFINITY,
  );

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Paso 1 de 3 · Reserva</p>
          <h1>Tu carrito</h1>
          <p className={styles.lead}>
            {items.length
              ? 'Tus asientos están en hold. Completa el pago antes de que expire el tiempo.'
              : 'Cuando elijas asientos, aparecerán aquí listos para pagar.'}
          </p>
        </header>

        {!items.length ? (
          <section className={styles.empty} aria-labelledby="cart-empty-title">
            <div className={styles.emptyArt} aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <EmptyState
              title="Carrito vacío"
              description="Explora la cartelera y asegura tus lugares con hold en vivo."
              action={
                <div className={styles.emptyActions}>
                  <Link href="/events" className={styles.primary}>
                    Ver eventos
                  </Link>
                  <Link href="/" className={styles.ghost}>
                    Ir al inicio
                  </Link>
                </div>
              }
            />
          </section>
        ) : (
          <div className={styles.grid}>
            <section className={styles.list} aria-label="Reservas en carrito">
              {active.map((item) => {
                const idx = rawItems.findIndex((r) => r.eventId === item.eventId);
                const sec = secondsUntil(item.expiresAt);
                const urgent = sec > 0 && sec < 120;
                const total = itemTotal(item);
                const seats = seatSummary(item);
                const zones = lineBreakdown(item);
                const when = fmtDate(item.startsAt);

                return (
                  <article key={item.eventId} className={styles.card}>
                    <div className={styles.cardTop}>
                      <div>
                        <p className={styles.kicker}>Hold activo</p>
                        <h2>
                          {item.slug ? (
                            <Link href={`/events/${item.slug}`}>{item.eventTitle}</Link>
                          ) : (
                            item.eventTitle
                          )}
                        </h2>
                        <p className={styles.meta}>
                          {[item.venueName, item.venueCity, when].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div
                        className={`${styles.timer} ${urgent ? styles.timerUrgent : ''}`}
                        aria-live="polite"
                      >
                        <span>Tiempo</span>
                        <strong>{fmtTimer(sec)}</strong>
                      </div>
                    </div>

                    <dl className={styles.facts}>
                      <div>
                        <dt>Boletos</dt>
                        <dd>
                          {item.seatCount} asiento{item.seatCount === 1 ? '' : 's'}
                        </dd>
                      </div>
                      {zones && (
                        <div>
                          <dt>Zonas</dt>
                          <dd>{zones}</dd>
                        </div>
                      )}
                      {seats && (
                        <div>
                          <dt>Asientos</dt>
                          <dd>{seats}</dd>
                        </div>
                      )}
                      {total > 0 && (
                        <div>
                          <dt>Subtotal</dt>
                          <dd>{fmtMoney(total, item.currency || currency)}</dd>
                        </div>
                      )}
                    </dl>

                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => goCheckout(router, item)}
                      >
                        Ir a pagar
                      </button>
                      {item.slug && (
                        <Link href={`/events/${item.slug}`} className={styles.ghost}>
                          Ver evento
                        </Link>
                      )}
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => idx >= 0 && removeAt(idx)}
                      >
                        Quitar
                      </button>
                    </div>
                  </article>
                );
              })}

              {expired.length > 0 && (
                <div className={styles.expiredBlock}>
                  <h3>Reservas expiradas</h3>
                  <p>El hold se liberó. Vuelve al mapa para elegir de nuevo.</p>
                  <ul>
                    {expired.map((item) => {
                      const idx = rawItems.findIndex((r) => r.eventId === item.eventId);
                      return (
                        <li key={`exp-${item.eventId}`}>
                          <span>{item.eventTitle}</span>
                          <div>
                            {item.slug && (
                              <Link href={`/events/${item.slug}`}>Reelegir</Link>
                            )}
                            <button type="button" onClick={() => idx >= 0 && removeAt(idx)}>
                              Limpiar
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <aside className={styles.summary} aria-label="Resumen">
              <h2>Resumen</h2>
              <ul className={styles.summaryRows}>
                <li>
                  <span>Eventos activos</span>
                  <strong>{active.length}</strong>
                </li>
                <li>
                  <span>Asientos</span>
                  <strong>{seatCount}</strong>
                </li>
                {Number.isFinite(soonest) && soonest < Number.POSITIVE_INFINITY && (
                  <li>
                    <span>Expira en</span>
                    <strong className={soonest < 120 ? styles.warn : undefined}>
                      {fmtTimer(soonest)}
                    </strong>
                  </li>
                )}
                {estimated > 0 && (
                  <li className={styles.totalRow}>
                    <span>Estimado</span>
                    <strong>{fmtMoney(estimated, currency)}</strong>
                  </li>
                )}
              </ul>

              <p className={styles.hint}>
                El total final (cargos e impuestos) se confirma en el checkout.
              </p>

              {active.length === 1 ? (
                <button
                  type="button"
                  className={styles.primaryWide}
                  onClick={() => goCheckout(router, active[0])}
                >
                  Continuar al pago
                </button>
              ) : active.length > 1 ? (
                <p className={styles.multiNote}>
                  Paga cada evento por separado para mantener el hold correcto.
                </p>
              ) : null}

              <div className={styles.trust}>
                <span>Boletos oficiales</span>
                <span>Hold en vivo</span>
                <span>Pago Banorte</span>
              </div>
              <p className={styles.hint}>
                Sin credenciales Banorte el checkout opera en modo demo (sin cargo real).
              </p>

              <div className={styles.summaryFooter}>
                <Link href="/events">Seguir explorando</Link>
                <button type="button" onClick={() => clear()}>
                  Vaciar carrito
                </button>
              </div>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
