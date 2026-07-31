'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { PurchaseSteps } from '@/components/storefront/PurchaseSteps';
import { TrustRow, TRUST_OFFICIAL, TRUST_QR, trustPayment } from '@/components/storefront/TrustRow';
import {
  normalizeCartItem,
  secondsUntil,
  useCartStore,
  type CartItem,
} from '@/lib/cart-store';
import { countdown, countdownSpoken, dateTime, money } from '@/lib/format';
import styles from './cart.module.scss';

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

function useHoldSeconds(expiresAt: string | undefined) {
  const [sec, setSec] = useState(() => (expiresAt ? secondsUntil(expiresAt) : 0));

  useEffect(() => {
    if (!expiresAt) {
      setSec(0);
      return;
    }
    const tick = () => setSec(secondsUntil(expiresAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return sec;
}

function HoldTimer({ seconds }: { seconds: number }) {
  const urgent = seconds > 0 && seconds < 60;
  const expired = seconds <= 0;

  return (
    <div
      className={`${styles.timer} ${urgent || expired ? styles.timerUrgent : ''}`}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={
        expired ? 'Reserva expirada' : `Tiempo restante ${countdownSpoken(seconds)}`
      }
    >
      <span>{expired ? 'Expiró' : 'Tiempo'}</span>
      <strong>{countdown(seconds)}</strong>
    </div>
  );
}

function CartCard({
  item,
  onCheckout,
  onRemove,
}: {
  item: CartItem;
  onCheckout: () => void;
  onRemove: () => void;
}) {
  const total = itemTotal(item);
  const seats = seatSummary(item);
  const zones = lineBreakdown(item);
  const when = item.startsAt ? dateTime(item.startsAt) : null;
  const remaining = useHoldSeconds(item.expiresAt);
  const expired = remaining <= 0;
  const currency = item.currency || 'MXN';

  return (
    <article className={`${styles.card} ${expired ? styles.cardExpired : ''}`}>
      <div className={styles.cardTop}>
        <div>
          <p className={expired ? styles.kickerExpired : styles.kicker}>
            {expired ? 'Hold liberado' : 'Hold activo'}
          </p>
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
        <HoldTimer seconds={remaining} />
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
            <dt>Subtotal est.</dt>
            <dd>{money(total, currency)}</dd>
          </div>
        )}
      </dl>

      <div className={styles.actions}>
        {!expired ? (
          <button type="button" className={styles.primary} onClick={onCheckout}>
            Ir a pagar
          </button>
        ) : item.slug ? (
          <Link href={`/events/${item.slug}`} className={styles.primary}>
            Reelegir asientos
          </Link>
        ) : (
          <Link href="/events" className={styles.primary}>
            Ver eventos
          </Link>
        )}
        {item.slug && !expired && (
          <Link href={`/events/${item.slug}`} className={styles.ghost}>
            Ver evento
          </Link>
        )}
        <button type="button" className={styles.danger} onClick={onRemove}>
          Quitar
        </button>
      </div>
    </article>
  );
}

function SummarySoonest({ expiresAt }: { expiresAt: string }) {
  const soonest = useHoldSeconds(expiresAt);
  const urgent = soonest > 0 && soonest < 60;
  return (
    <li>
      <span>Expira en</span>
      <strong
        className={urgent || soonest <= 0 ? styles.warn : undefined}
        aria-live="polite"
        aria-atomic="true"
        aria-label={
          soonest <= 0
            ? 'Reserva expirada'
            : `La reserva más cercana expira en ${countdownSpoken(soonest)}`
        }
      >
        {countdown(soonest)}
      </strong>
    </li>
  );
}

export default function CartPage() {
  const rawItems = useCartStore((s) => s.items);
  const removeAt = useCartStore((s) => s.removeAt);
  const clear = useCartStore((s) => s.clear);
  const router = useRouter();
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => rawItems.map(normalizeCartItem), [rawItems]);
  const active = useMemo(
    () => items.filter((i) => secondsUntil(i.expiresAt) > 0),
    // nowTick refreshes partition without remounting every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, nowTick],
  );
  const expired = useMemo(
    () => items.filter((i) => secondsUntil(i.expiresAt) <= 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, nowTick],
  );
  const estimated = active.reduce((s, i) => s + itemTotal(i), 0);
  const seatCount = active.reduce((s, i) => s + i.seatCount, 0);
  const currency = active[0]?.currency || 'MXN';
  const soonestExpiresAt = active.reduce<string | null>((minIso, item) => {
    if (!minIso) return item.expiresAt;
    return new Date(item.expiresAt).getTime() < new Date(minIso).getTime()
      ? item.expiresAt
      : minIso;
  }, null);

  let emptyArt: ReactNode = null;
  if (!items.length) {
    emptyArt = (
      <div className={styles.emptyArt} aria-hidden>
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <PurchaseSteps current="cart" />

        <header className={styles.hero}>
          <p className={styles.eyebrow}>Reserva temporal</p>
          <h1>Tu carrito</h1>
          <p className={styles.lead}>
            {items.length
              ? 'Tus asientos están en hold. Completa el pago antes de que expire el tiempo.'
              : 'Cuando elijas asientos, aparecerán aquí listos para pagar.'}
          </p>
        </header>

        {!items.length ? (
          <section className={styles.empty} aria-label="Carrito vacío">
            {emptyArt}
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
                return (
                  <CartCard
                    key={item.eventId}
                    item={item}
                    onCheckout={() => goCheckout(router, item)}
                    onRemove={() => idx >= 0 && removeAt(idx)}
                  />
                );
              })}

              {expired.length > 0 && (
                <div className={styles.expiredBlock} role="region" aria-label="Reservas expiradas">
                  <h3>Reservas expiradas</h3>
                  <p>
                    El hold se liberó. Vuelve al mapa para elegir de nuevo; no se generó ningún
                    cargo.
                  </p>
                  <ul>
                    {expired.map((item) => {
                      const idx = rawItems.findIndex((r) => r.eventId === item.eventId);
                      return (
                        <li key={`exp-${item.eventId}`}>
                          <span>{item.eventTitle}</span>
                          <div>
                            {item.slug ? (
                              <Link href={`/events/${item.slug}`}>Reelegir asientos</Link>
                            ) : (
                              <Link href="/events">Ver eventos</Link>
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
                {soonestExpiresAt && <SummarySoonest expiresAt={soonestExpiresAt} />}
                {estimated > 0 && (
                  <li className={styles.totalRow}>
                    <span>Subtotal estimado</span>
                    <strong>{money(estimated, currency)}</strong>
                  </li>
                )}
              </ul>

              <p className={styles.hint}>
                Estimado sin cargos de servicio ni impuestos. El total final se confirma en el
                checkout antes de pagar.
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
                  Paga cada evento por separado para mantener el hold correcto y evitar cargos
                  cruzados.
                </p>
              ) : (
                <p className={styles.multiNote} role="status">
                  No hay holds activos. Reelige asientos para continuar.
                </p>
              )}

              <div className={styles.trustWrap}>
                <TrustRow
                  items={[TRUST_OFFICIAL, TRUST_QR, trustPayment(true)]}
                  tone="light"
                />
              </div>

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
    </div>
  );
}
