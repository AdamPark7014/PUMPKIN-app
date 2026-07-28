import Link from 'next/link';
import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { OrderQrCards } from '@/components/OrderQrCards';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import styles from './order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type OrderTicket = {
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

type OrderDetail = {
  id: string;
  publicId: string;
  status: string;
  totalAmount: string;
  currency: string;
  buyerName?: string;
  buyerEmail?: string;
  paymentMethod?: string | null;
  event?: {
    title: string;
    slug: string;
    startsAt: string;
    endsAt?: string | null;
    venue?: { name: string; city: string; address?: string | null } | null;
  } | null;
  items: {
    quantity?: number;
    unitPrice?: string;
    offer?: { name?: string | null; zone?: string } | null;
    tickets: OrderTicket[];
  }[];
  pendingPayment?: {
    reference?: string | null;
    metadata?: {
      clabe?: string;
      concept?: string;
      type?: string;
      reference?: string;
      demo?: boolean;
    } | null;
  } | null;
};

function seatLabel(t: OrderTicket) {
  const parts = [t.section, t.row ? `Fila ${t.row}` : null, t.seatNumber ? `Asiento ${t.seatNumber}` : null].filter(
    Boolean,
  );
  return parts.length ? parts.join(' · ') : null;
}

function googleCalendarUrl(order: OrderDetail) {
  const ev = order.event;
  if (!ev?.startsAt) return null;
  const start = new Date(ev.startsAt);
  const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Orden ${order.publicId} · Boletos BOLETERA`,
    location: [ev.venue?.name, ev.venue?.address, ev.venue?.city].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default async function OrderPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  let order: OrderDetail | null = null;
  let gatewayDemo = false;
  try {
    order = await api<OrderDetail>(`/orders/${publicId}`);
  } catch {
    order = null;
  }
  try {
    const cfg = await api<{ demo?: boolean }>('/payments/config');
    gatewayDemo = Boolean(cfg?.demo);
  } catch {
    gatewayDemo = false;
  }

  if (!order) {
    return (
      <div className={styles.shell}>
        <SiteHeader />
        <main className={styles.page}>
          <div className={styles.empty}>
            <h1>Orden no encontrada</h1>
            <p>Revisa el enlace o inicia sesión para ver tus boletos.</p>
            <div className={styles.actions}>
              <Link href="/cuenta" className={styles.link}>
                Ir a mi cuenta
              </Link>
              <Link href="/events" className={styles.secondary}>
                Ver eventos
              </Link>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const tickets = order.items.flatMap((i) => i.tickets);
  const when = order.event?.startsAt ? new Date(order.event.startsAt) : null;
  const cal = googleCalendarUrl(order);
  const pendingMeta = order.pendingPayment?.metadata;
  const completed = order.status === 'COMPLETED';
  const isDemoFlow = gatewayDemo || pendingMeta?.demo === true;

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.steps} aria-label="Progreso">
          <span className={styles.stepDone}>1 Carrito</span>
          <span className={styles.stepDone}>2 Pago</span>
          <span className={styles.stepActive}>3 Boletos</span>
        </div>

        <header className={styles.hero}>
          {completed ? (
            <p className={styles.ok}>Compra confirmada</p>
          ) : (
            <p className={styles.pending}>Pago pendiente — Banorte</p>
          )}
          <h1>{completed ? 'Tus boletos están listos' : 'Completa tu pago'}</h1>
          <p className={styles.sub}>
            Orden <code>{order.publicId}</code>
            {order.buyerEmail ? ` · ${order.buyerEmail}` : ''}
          </p>
        </header>

        {order.event && (
          <section className={styles.eventCard} aria-label="Evento">
            <div>
              <p className={styles.kicker}>Evento</p>
              <h2>{order.event.title}</h2>
              {when && (
                <p>
                  {when.toLocaleDateString('es-MX', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  · {when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {order.event.venue && (
                <p>
                  {order.event.venue.name}
                  {order.event.venue.city ? ` · ${order.event.venue.city}` : ''}
                </p>
              )}
            </div>
            <div className={styles.eventSide}>
              <strong>
                ${order.totalAmount} <span>{order.currency}</span>
              </strong>
              {order.event.slug && (
                <Link href={`/events/${order.event.slug}`} className={styles.textLink}>
                  Ver evento
                </Link>
              )}
            </div>
          </section>
        )}

        {order.status === 'PENDING' && (order.paymentMethod === 'SPEI' || order.paymentMethod === 'OXXO') && (
          <section className={styles.section}>
            <h2>Instrucciones de pago</h2>
            {order.paymentMethod === 'SPEI' && (
              <div className={styles.instructions}>
                <p>Transfiere por SPEI a la CLABE Banorte del promotor:</p>
                {pendingMeta?.clabe && (
                  <p>
                    <strong>CLABE:</strong> <code>{pendingMeta.clabe}</code>
                  </p>
                )}
                <p>
                  <strong>Referencia / concepto:</strong>{' '}
                  <code>
                    {pendingMeta?.concept ||
                      pendingMeta?.reference ||
                      order.pendingPayment?.reference ||
                      publicId}
                  </code>
                </p>
              </div>
            )}
            {order.paymentMethod === 'OXXO' && (
              <div className={styles.instructions}>
                <p>Paga en cualquier OXXO con esta referencia:</p>
                <p>
                  <code>{pendingMeta?.reference || order.pendingPayment?.reference || publicId}</code>
                </p>
              </div>
            )}
            {isDemoFlow && (
              <>
                <p className={styles.pending} role="status">
                  Modo demo — no transfieras dinero real.
                </p>
                <SimulateDemoPaymentButton orderId={order.id} publicId={order.publicId} />
              </>
            )}
            <Link href={`/orders/${publicId}/pago?method=${order.paymentMethod}`} className={styles.textLink}>
              Ver instrucciones completas →
            </Link>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Tus boletos ({tickets.length})</h2>
            {completed && (
              <a className={styles.pdfLink} href={`${API}/orders/${publicId}/tickets.pdf`}>
                Descargar PDF
              </a>
            )}
          </div>
          <ul className={styles.ticketList}>
            {tickets.map((t) => (
              <li key={t.code}>
                <code>{t.code}</code>
                <span>{seatLabel(t) || 'Entrada general'}</span>
              </li>
            ))}
            {!tickets.length && (
              <li className={styles.muted}>
                Los códigos QR aparecerán cuando el pago se confirme.
              </li>
            )}
          </ul>
        </section>

        {completed && <OrderQrCards publicId={order.publicId} />}

        <div className={styles.actions}>
          {cal && completed && (
            <a className={styles.secondary} href={cal} target="_blank" rel="noreferrer">
              Agregar al calendario
            </a>
          )}
          <Link href="/cuenta" className={styles.link}>
            Ir a Mis boletos
          </Link>
          <Link href="/events" className={styles.ghost}>
            Ver más eventos
          </Link>
        </div>

        <ul className={styles.trust}>
          <li>Boletos oficiales BOLETERA</li>
          <li>Entrada con QR</li>
          <li>Pago Banorte</li>
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
