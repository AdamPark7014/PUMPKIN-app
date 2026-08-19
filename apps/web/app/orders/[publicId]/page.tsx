import type { Metadata } from 'next';
import Link from 'next/link';
import { api, API_BASE } from '@/lib/api';
import {
  longDateTime,
  moneyExact,
  orderStatusLabel,
  paymentMethodLabel,
} from '@/lib/format';
import { SITE_NAME } from '@/lib/seo';
import type { OrderDetail, OrderTicket } from '@/lib/storefront-types';
import { SiteHeader } from '@/components/SiteHeader';
import { OrderQrCards } from '@/components/OrderQrCards';
import { SimulateDemoPaymentButton } from '@/components/SimulateDemoPaymentButton';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { PurchaseSteps } from '@/components/storefront/PurchaseSteps';
import {
  TrustRow,
  TRUST_OFFICIAL,
  TRUST_QR,
  trustPayment,
  trustTransfer,
} from '@/components/storefront/TrustRow';
import styles from './order.module.scss';

function seatLabel(ticket: OrderTicket): string | null {
  const parts = [
    ticket.section,
    ticket.row ? `Fila ${ticket.row}` : null,
    ticket.seatNumber ? `Asiento ${ticket.seatNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function googleCalendarUrl(order: OrderDetail): string | null {
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
    details: `Orden ${order.publicId} · Boletos ${SITE_NAME}`,
    location: [ev.venue?.name, ev.venue?.address, ev.venue?.city].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function isFailedStatus(status: string): boolean {
  return (
    status === 'FAILED' ||
    status === 'EXPIRED' ||
    status === 'CANCELLED' ||
    status === 'CANCELED' ||
    status === 'REFUNDED'
  );
}

function nextStepCopy(order: OrderDetail, completed: boolean, isDemoFlow: boolean): string {
  if (completed) {
    return 'Guarda tus QR o el PDF. Preséntalos en el acceso el día del evento.';
  }
  if (isFailedStatus(order.status)) {
    return 'Esta orden ya no se puede pagar. Elige asientos de nuevo en el evento.';
  }
  if (order.paymentMethod === 'SPEI') {
    return isDemoFlow
      ? 'Modo demo: simula el acreditamiento del pago para liberar tus boletos.'
      : 'Transfiere el monto exacto con la referencia indicada. Actualizamos el estado al acreditar.';
  }
  if (order.paymentMethod === 'OXXO') {
    return isDemoFlow
      ? 'Modo demo: simula el pago OXXO para liberar tus boletos.'
      : 'Paga en OXXO con la referencia exacta. Te avisamos cuando se confirme.';
  }
  return isDemoFlow
    ? 'Si el pago demo no se confirmó, reintenta desde la pantalla de pago.'
    : 'Si no completaste el pago, reinténtalo. No se cobra dos veces por la misma orden.';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  return {
    title: `Orden ${publicId}`,
    description: `Detalle privado de tu orden ${publicId} en ${SITE_NAME}.`,
    robots: { index: false, follow: false },
  };
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
        <SiteHeader theme="dark" />
        <main className={styles.page}>
          <PurchaseSteps current="tickets" />
          <div className={styles.empty}>
            <h1>Orden no encontrada</h1>
            <p>
              Revisa el enlace, espera unos segundos si acabas de pagar, o inicia sesión para ver
              tus boletos.
            </p>
            <div className={styles.actions}>
              <Link href="/cuenta" className={styles.link}>
                Ir a mi cuenta
              </Link>
              <Link href="/ayuda" className={styles.ghost}>
                Centro de ayuda
              </Link>
              <Link href="/events" className={styles.secondary}>
                Ver eventos
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const tickets = order.items.flatMap((item) => item.tickets);
  const cal = googleCalendarUrl(order);
  const pendingMeta = order.pendingPayment?.metadata;
  const completed = order.status === 'COMPLETED';
  const pending = order.status === 'PENDING';
  const failed = isFailedStatus(order.status);
  const isDemoFlow = gatewayDemo || pendingMeta?.demo === true;
  const recoverEventHref = order.event?.slug ? `/events/${order.event.slug}` : '/events';
  const paymentHref = `/orders/${publicId}/pago${
    order.paymentMethod ? `?method=${order.paymentMethod}` : ''
  }`;
  const pdfHref = `${API_BASE}/orders/${publicId}/tickets.pdf`;
  const speiReference =
    pendingMeta?.concept || pendingMeta?.reference || order.pendingPayment?.reference || publicId;
  const oxxoReference =
    pendingMeta?.reference || order.pendingPayment?.reference || publicId;

  const timeline = [
    { id: 'order', label: 'Orden creada', done: true, current: false },
    {
      id: 'pay',
      label: completed
        ? 'Pago confirmado'
        : pending
          ? 'Esperando pago'
          : orderStatusLabel(order.status),
      done: completed,
      current: pending,
    },
    {
      id: 'tickets',
      label: completed ? 'Boletos listos' : 'Entrega de QR',
      done: completed && tickets.length > 0,
      current: completed && tickets.length === 0,
    },
  ];

  const trustItems = [
    TRUST_OFFICIAL,
    TRUST_QR,
    trustPayment(isDemoFlow),
    trustTransfer(true),
  ];

  return (
    <div className={styles.shell}>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <PurchaseSteps current={completed ? 'tickets' : 'checkout'} />

        <Breadcrumbs
          trail={[
            { name: 'Inicio', path: '/' },
            { name: 'Mi cuenta', path: '/cuenta' },
            { name: `Orden ${order.publicId}` },
          ]}
        />

        <header className={styles.hero}>
          {completed ? (
            <p className={styles.ok}>Compra confirmada</p>
          ) : pending ? (
            <p className={styles.pending}>
              Pago pendiente
              {order.paymentMethod ? ` · ${paymentMethodLabel(order.paymentMethod)}` : ''}
            </p>
          ) : (
            <p className={styles.failed}>{orderStatusLabel(order.status)}</p>
          )}
          <h1>
            {completed
              ? 'Tus boletos están listos'
              : pending
                ? 'Completa tu pago'
                : 'Revisa el estado de tu orden'}
          </h1>
          <p className={styles.sub}>
            Orden <code>{order.publicId}</code>
            {order.buyerEmail ? ` · ${order.buyerEmail}` : ''}
          </p>
        </header>

        <section className={styles.timeline} aria-label="Estado de la compra">
          <ol>
            {timeline.map((step) => (
              <li
                key={step.id}
                className={
                  step.done ? styles.tlDone : step.current ? styles.tlCurrent : styles.tlTodo
                }
              >
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className={styles.nextStep} role="status">
            <strong>Siguiente paso:</strong> {nextStepCopy(order, completed, isDemoFlow)}
          </p>
        </section>

        {order.event && (
          <section className={styles.eventCard} aria-label="Evento">
            <div>
              <p className={styles.kicker}>Evento</p>
              <h2>{order.event.title}</h2>
              <p>{longDateTime(order.event.startsAt)}</p>
              {order.event.venue && (
                <p>
                  {order.event.venue.name}
                  {order.event.venue.city ? ` · ${order.event.venue.city}` : ''}
                </p>
              )}
            </div>
            <div className={styles.eventSide}>
              <strong>
                {moneyExact(order.totalAmount, order.currency)}
              </strong>
              {order.paymentMethod && (
                <span className={styles.methodChip}>
                  {paymentMethodLabel(order.paymentMethod)}
                </span>
              )}
              {order.event.slug && (
                <Link href={`/events/${order.event.slug}`} className={styles.textLink}>
                  Ver evento
                </Link>
              )}
            </div>
          </section>
        )}

        {pending && (order.paymentMethod === 'SPEI' || order.paymentMethod === 'OXXO') && (
          <section className={styles.section}>
            <h2>Instrucciones de pago</h2>
            {order.paymentMethod === 'SPEI' && (
              <div className={styles.instructions}>
                <p>
                  {isDemoFlow
                    ? 'Datos SPEI de prueba (no uses en banca real):'
                    : 'Transfiere por SPEI a la siguiente cuenta:'}
                </p>
                {pendingMeta?.clabe && (
                  <p>
                    <strong>CLABE:</strong> <code>{pendingMeta.clabe}</code>
                  </p>
                )}
                <p>
                  <strong>Referencia / concepto:</strong> <code>{speiReference}</code>
                </p>
                <p>
                  Monto exacto:{' '}
                  <strong>{moneyExact(order.totalAmount, order.currency)}</strong>
                </p>
              </div>
            )}
            {order.paymentMethod === 'OXXO' && (
              <div className={styles.instructions}>
                <p>
                  {isDemoFlow
                    ? 'Referencia OXXO de prueba:'
                    : 'Paga en cualquier OXXO con esta referencia:'}
                </p>
                <p>
                  <code>{oxxoReference}</code>
                </p>
                <p>
                  Monto exacto:{' '}
                  <strong>{moneyExact(order.totalAmount, order.currency)}</strong>
                </p>
              </div>
            )}
            {isDemoFlow && (
              <SimulateDemoPaymentButton orderId={order.id} publicId={order.publicId} />
            )}
            <Link href={paymentHref} className={styles.textLink}>
              Ver instrucciones completas →
            </Link>
          </section>
        )}

        {pending && order.paymentMethod === 'CARD' && (
          <section className={styles.section}>
            <h2>Recuperar pago con tarjeta</h2>
            <p className={styles.mutedBlock}>
              {isDemoFlow
                ? 'El pago demo no terminó de confirmarse. Puedes reintentar sin crear una orden nueva.'
                : 'Si cerraste Banorte o hubo un error de red, reintenta el pago. La orden ya existe y el banco evita cargos duplicados.'}
            </p>
            <Link href={paymentHref} className={styles.link}>
              Continuar pago
            </Link>
          </section>
        )}

        {pending && !order.paymentMethod && (
          <section className={styles.section}>
            <h2>Pago pendiente</h2>
            <p className={styles.mutedBlock}>
              Tu orden está a la espera de confirmación. Abre las instrucciones de pago para
              continuar.
            </p>
            <Link href={paymentHref} className={styles.link}>
              Ir a pago
            </Link>
          </section>
        )}

        {failed && (
          <section className={styles.section} aria-live="polite">
            <h2>No se pudo completar</h2>
            <p className={styles.mutedBlock}>
              Estado: {orderStatusLabel(order.status)}. No hay cargo activo. Elige asientos de
              nuevo para generar una nueva reserva.
            </p>
            <div className={styles.actions}>
              <Link href={recoverEventHref} className={styles.link}>
                Reelegir asientos
              </Link>
              <Link href="/cart" className={styles.ghost}>
                Ir al carrito
              </Link>
              <Link href="/ayuda" className={styles.ghost}>
                Ayuda
              </Link>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Tus boletos ({tickets.length})</h2>
            {completed && (
              <a className={styles.pdfLink} href={pdfHref}>
                Descargar PDF
              </a>
            )}
          </div>
          <ul className={styles.ticketList}>
            {tickets.map((ticket) => (
              <li key={ticket.id ?? ticket.code}>
                <code>{ticket.code}</code>
                <span>{seatLabel(ticket) || 'Entrada general'}</span>
              </li>
            ))}
            {!tickets.length && (
              <li className={styles.muted}>
                {pending
                  ? 'Los códigos QR aparecerán cuando el pago se confirme.'
                  : 'Aún no hay boletos asociados a esta orden.'}
              </li>
            )}
          </ul>
        </section>

        {completed && <OrderQrCards publicId={order.publicId} />}

        {completed && (
          <section className={styles.help} aria-label="Ayuda post-compra">
            <h2>¿Necesitas ayuda?</h2>
            <ul>
              <li>
                <strong>Reenviar boletos:</strong> descarga el PDF de esta página o revisa el
                correo de confirmación. Si no llegó, consulta{' '}
                <Link href="/ayuda">ayuda</Link>.
              </li>
              <li>
                <strong>Transferir boletos:</strong> cede un boleto desde{' '}
                <Link href="/cuenta?transfer=">Mi cuenta</Link>.
              </li>
              <li>
                <strong>Soporte:</strong> dudas de acceso, pago o entrega en{' '}
                <Link href="/ayuda">/ayuda</Link>.
              </li>
            </ul>
          </section>
        )}

        <div className={styles.actions}>
          {cal && completed && (
            <a className={styles.secondary} href={cal} target="_blank" rel="noreferrer">
              Agregar al calendario
            </a>
          )}
          {completed && (
            <a className={styles.link} href={pdfHref}>
              Descargar PDF
            </a>
          )}
          {pending && (
            <Link href={paymentHref} className={styles.link}>
              Ir a instrucciones de pago
            </Link>
          )}
          <Link href="/cuenta" className={styles.ghost}>
            Ir a Mis boletos
          </Link>
          {completed && (
            <Link href="/cuenta?transfer=" className={styles.ghost}>
              Transferir boleto
            </Link>
          )}
          <Link href="/events" className={styles.ghost}>
            Ver más eventos
          </Link>
        </div>

        <div className={styles.trustWrap}>
          <TrustRow items={trustItems} label="Garantías de tu compra" />
        </div>
      </main>
    </div>
  );
}
