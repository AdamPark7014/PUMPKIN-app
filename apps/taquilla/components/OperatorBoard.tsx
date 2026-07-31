'use client';

import Link from 'next/link';
import { formatMxn } from '@/lib/pos/money';
import type { SessionSummary } from '@/lib/pos';
import styles from './OperatorBoard.module.scss';

export type EventOffer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
};

export type EventRow = {
  id: string;
  title: string;
  startsAt: string;
  venue: { name: string };
  offers?: EventOffer[];
};

export type LoadStatus = 'loading' | 'ready' | 'error';
export type SummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type OperatorBoardProps = {
  events: EventRow[];
  eventsStatus: LoadStatus;
  onRetryEvents: () => void;
  summary: SessionSummary | null;
  summaryStatus: SummaryStatus;
  onRefreshSummary: () => void;
  sellHref: (event: EventRow) => string;
};

function formatEventDate(startsAt: string): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return 'Fecha por confirmar';
  return parsed.toLocaleString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSaleTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function isToday(startsAt: string): boolean {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  );
}

function paymentLabel(method: string): string {
  const normalized = method.toUpperCase();
  if (normalized === 'CASH') return 'Efectivo';
  if (normalized === 'CARD') return 'Tarjeta';
  if (normalized === 'COMP') return 'Cortesía';
  return method;
}

export function OperatorBoard({
  events,
  eventsStatus,
  onRetryEvents,
  summary,
  summaryStatus,
  onRefreshSummary,
  sellHref,
}: OperatorBoardProps) {
  const stale = summaryStatus === 'error';
  const countValue = (value: number | undefined): string => {
    if (stale) return 'No disponible';
    if (!summary) return summaryStatus === 'loading' ? 'Actualizando…' : '—';
    return String(value ?? 0);
  };
  const moneyValue = (value: number | undefined): string => {
    if (stale) return 'No disponible';
    if (!summary) return summaryStatus === 'loading' ? 'Actualizando…' : '—';
    return formatMxn(value ?? 0);
  };
  const recentSales = summary?.recentSales ?? [];

  return (
    <>
      <section className={styles.kpiRow} aria-label="Ventas del turno">
        <div className={styles.kpi}>
          <span>Ventas turno</span>
          <strong className={styles.kpiMoney}>{moneyValue(summary?.totalRevenue)}</strong>
        </div>
        <div className={styles.kpi}>
          <span>Transacciones</span>
          <strong>{countValue(summary?.totalTransactions)}</strong>
        </div>
        <div className={styles.kpi}>
          <span>Efectivo</span>
          <strong>{moneyValue(summary?.cashSales)}</strong>
        </div>
        <div className={styles.kpi}>
          <span>Tarjeta</span>
          <strong>{moneyValue(summary?.cardSales)}</strong>
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-label="Eventos disponibles para venta">
          <header className={styles.panelHead}>
            <h2>Eventos de hoy y próximos</h2>
            <Link href="/eventos" className={styles.panelLink}>
              Ver todos
            </Link>
          </header>

          {eventsStatus === 'loading' ? (
            <p className={styles.empty}>Cargando eventos disponibles…</p>
          ) : eventsStatus === 'error' ? (
            <div className={styles.emptyBlock}>
              <p>No se pudieron consultar los eventos. Revisa la conexión con el servidor.</p>
              <button type="button" className={styles.retryBtn} onClick={onRetryEvents}>
                Reintentar
              </button>
            </div>
          ) : events.length === 0 ? (
            <p className={styles.empty}>No hay eventos en la ventana de venta.</p>
          ) : (
            <ul className={styles.eventList}>
              {events.map((event) => {
                const offer = event.offers?.[0];
                const price = offer ? Number(offer.basePrice) : 0;
                const remaining = offer?.remainingQuantity;
                const soldOut = typeof remaining === 'number' && remaining <= 0;
                return (
                  <li key={event.id} className={styles.eventItem}>
                    <div className={styles.eventInfo}>
                      <strong>
                        {event.title}
                        {isToday(event.startsAt) && <span className={styles.todayTag}>Hoy</span>}
                      </strong>
                      <span>
                        {event.venue?.name ?? 'Sede por confirmar'} · {formatEventDate(event.startsAt)}
                      </span>
                      <span className={styles.eventPrice}>
                        {Number.isFinite(price) && price > 0 ? `Desde ${formatMxn(price)}` : 'Precio por definir'}
                        {typeof remaining === 'number' && ` · ${remaining} disponibles`}
                      </span>
                    </div>
                    {soldOut ? (
                      <span className={styles.sellDisabled}>Agotado</span>
                    ) : (
                      <Link
                        href={sellHref(event)}
                        className={styles.sellBtn}
                        aria-label={`Vender boletos para ${event.title}`}
                      >
                        Vender
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.panel} aria-label="Ventas recientes del turno">
          <header className={styles.panelHead}>
            <h2>Ventas recientes</h2>
            <button type="button" className={styles.panelLink} onClick={onRefreshSummary}>
              {summaryStatus === 'loading' ? 'Actualizando…' : 'Actualizar'}
            </button>
          </header>

          {stale ? (
            <p className={styles.empty}>
              No se pudo actualizar el turno. Los importes se ocultan para no mostrar datos obsoletos.
            </p>
          ) : recentSales.length === 0 ? (
            <p className={styles.empty}>
              {summaryStatus === 'loading' ? 'Actualizando actividad…' : 'Aún no hay ventas en este turno.'}
            </p>
          ) : (
            <ul className={styles.salesList}>
              {recentSales.map((sale) => {
                const saleTime = formatSaleTime(sale.createdAt);
                return (
                  <li key={sale.orderId}>
                    <div className={styles.saleInfo}>
                      <strong>{sale.eventTitle}</strong>
                      <span>
                        {sale.publicId} · {paymentLabel(sale.paymentMethod)} · ×{sale.quantity}
                        {saleTime ? ` · ${saleTime}` : ''}
                      </span>
                    </div>
                    <strong className={sale.isComp ? styles.saleComp : styles.saleTotal}>
                      {sale.isComp ? 'Cortesía' : formatMxn(sale.total)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
