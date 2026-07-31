'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState } from '@boletera/ui';
import { ActivityFeed } from '@boletera/ui/src/components/ActivityFeed';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import { Section } from '@boletera/ui/src/components/Section';
import { StatusDot } from '@boletera/ui/src/components/StatusDot';
import { Timeline } from '@boletera/ui/src/components/Timeline';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import { useAuditLog } from '@/lib/queries/audit';
import { useFraudFlags } from '@/lib/queries/fraud';
import {
  useCancelOrder,
  useOrder,
  useResendOrderEmail,
} from '@/lib/queries/orders';
import { useSession } from '@/lib/use-session';
import { ChannelBadge, OrderStatusBadge } from '../_components/OrderBadges';
import { OrdersPageSkeleton } from '../_components/OrdersPageSkeleton';
import { ConfirmActionModal } from '../_lib/ConfirmActionModal';
import {
  canCancel,
  canRequestRefund,
  canResendEmail,
  flattenTickets,
  formatDateTime,
  money,
} from '../_lib/format';
import { parseFraudFlagList, parseOrderDetail } from '../_lib/parse';
import {
  buildAuditFeed,
  buildOrderTimeline,
  describeSeat,
  fraudTone,
  orderFraudFlags,
} from '../_lib/timeline';
import styles from '../orders.module.scss';

type ConfirmIntent = 'cancel' | 'refund' | 'resend' | 'complete-refund' | null;

type RefundResult = {
  refund: { status: string };
  message?: string;
};

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = String(params.id ?? '');
  const toast = useToast();
  const session = useSession();
  const client = useQueryClient();

  const orderQuery = useOrder(orderId);
  const order = useMemo(
    () => parseOrderDetail(orderQuery.data),
    [orderQuery.data],
  );

  const auditQuery = useAuditLog(session.organizationId, 120);
  const fraudQuery = useFraudFlags(100);

  const cancelMutation = useCancelOrder();
  const resendMutation = useResendOrderEmail();

  const refundMutation = useMutation({
    mutationFn: (id: string) =>
      http<RefundResult>(`/admin/orders/${id}/refund`, {
        method: 'POST',
        body: { reason: 'CUSTOMER_REQUEST' },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      void client.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });

  const completeRefundMutation = useMutation({
    mutationFn: ({
      refundId,
      banorteReference,
    }: {
      refundId: string;
      banorteReference?: string;
    }) =>
      http(`/payments/refunds/${refundId}/complete`, {
        method: 'POST',
        body: { banorteReference },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      void client.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });

  const [intent, setIntent] = useState<ConfirmIntent>(null);
  const [refundTargetId, setRefundTargetId] = useState<string | null>(null);
  const [banorteRef, setBanorteRef] = useState('');

  const timeline = useMemo(
    () => (order ? buildOrderTimeline(order) : []),
    [order],
  );

  const tickets = order ? flattenTickets(order) : [];
  const pendingRefunds = order?.refunds.filter((r) => r.status === 'PENDING') ?? [];

  const flags = useMemo(() => {
    if (!order) return [];
    const fromOrder = order.fraudFlags ?? [];
    if (fromOrder.length > 0) return fromOrder;
    return orderFraudFlags(parseFraudFlagList(fraudQuery.data), order.id);
  }, [fraudQuery.data, order]);

  const auditItems = useMemo(
    () =>
      order
        ? buildAuditFeed(auditQuery.data ?? [], order.id, order.publicId)
        : [],
    [auditQuery.data, order],
  );

  const busy =
    cancelMutation.isPending ||
    resendMutation.isPending ||
    refundMutation.isPending ||
    completeRefundMutation.isPending;

  async function runConfirmedAction() {
    if (!order || !intent) return;
    try {
      if (intent === 'cancel') {
        await cancelMutation.mutateAsync(order.id);
        toast.success('Orden cancelada');
      } else if (intent === 'resend') {
        await resendMutation.mutateAsync(order.id);
        toast.success(`Email reenviado a ${order.buyerEmail}`);
      } else if (intent === 'refund') {
        const res = await refundMutation.mutateAsync(order.id);
        if (res.refund?.status === 'PENDING') {
          toast.success(
            'Reembolso pendiente: completa el proceso en Banorte y márcalo como completado.',
          );
        } else {
          toast.success(res.message || `Reembolso: ${res.refund?.status}`);
        }
      } else if (intent === 'complete-refund' && refundTargetId) {
        await completeRefundMutation.mutateAsync({
          refundId: refundTargetId,
          banorteReference: banorteRef.trim() || undefined,
        });
        toast.success('Reembolso marcado como completado · inventario liberado');
      }
      setIntent(null);
      setRefundTargetId(null);
      setBanorteRef('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la acción');
    }
  }

  if (orderQuery.isPending) {
    return <OrdersPageSkeleton variant="detail" />;
  }

  if (orderQuery.error || !order) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="No se pudo cargar la orden"
          description={
            orderQuery.error instanceof Error
              ? orderQuery.error.message
              : 'La orden no existe o no tienes acceso.'
          }
          illustration="error"
          tone="danger"
          action={
            <Link href="/orders" className={styles.backLink}>
              Volver a órdenes
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Detalle operativo"
        title={`Orden ${order.publicId}`}
        description={`${order.event.title} · ${formatDateTime(order.createdAt)}`}
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Órdenes', href: '/orders' },
          { label: order.publicId },
        ]}
        actions={
          <div className={styles.detailActions}>
            {canResendEmail(order) && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setIntent('resend')}
              >
                Reenviar email
              </Button>
            )}
            {canRequestRefund(order) && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setIntent('refund')}
              >
                Solicitar reembolso
              </Button>
            )}
            {canCancel(order) && (
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => setIntent('cancel')}
              >
                Cancelar
              </Button>
            )}
            <Link href="/orders" className={styles.backLink}>
              Volver
            </Link>
          </div>
        }
      >
        <div className={styles.detailStatusRow}>
          <OrderStatusBadge status={order.status} />
          <ChannelBadge channel={order.channel} />
          {pendingRefunds.length > 0 && (
            <Badge tone="warning" variant="soft" size="sm" dot>
              {pendingRefunds.length} reembolso(s) pendiente(s)
            </Badge>
          )}
        </div>
      </PageHeader>

      {pendingRefunds.length > 0 && (
        <p className={styles.alertBanner} role="status">
          Hay reembolsos pendientes: procesa en el portal Banorte y márcalos como completados
          abajo para liberar inventario.
        </p>
      )}

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <Section title="Línea de tiempo" description="Ciclo de vida de la orden">
            <Timeline items={timeline} label="Cronología de la orden" density="md" />
          </Section>

          <Section title="Boletos" description={`${tickets.length} boleto(s)`}>
            {tickets.length === 0 ? (
              <EmptyState
                title="Sin boletos"
                description="Esta orden aún no tiene boletos emitidos."
                illustration="seats"
                size="sm"
              />
            ) : (
              <div className={styles.ticketTableWrap} role="region" aria-label="Boletos">
                <table className={styles.ticketTable}>
                  <thead>
                    <tr>
                      <th scope="col">Código</th>
                      <th scope="col">Asiento</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr key={ticket.id || ticket.code}>
                        <td>
                          <code className={styles.code}>{ticket.code}</code>
                        </td>
                        <td>{describeSeat(ticket)}</td>
                        <td>
                          <StatusDot
                            tone={
                              ticket.status === 'VALID' || ticket.status === 'SOLD'
                                ? 'success'
                                : ticket.status === 'USED'
                                  ? 'info'
                                  : ticket.status === 'CANCELLED' ||
                                      ticket.status === 'REFUNDED'
                                    ? 'danger'
                                    : 'neutral'
                            }
                            label={ticket.status}
                            size="sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Reembolsos">
            {order.refunds.length === 0 ? (
              <p className={styles.muted}>Sin reembolsos registrados.</p>
            ) : (
              <ul className={styles.refundList}>
                {order.refunds.map((refund) => (
                  <li key={refund.id} className={styles.refundRow}>
                    <div>
                      <p>
                        {money(refund.amount, order.currency)} ·{' '}
                        <Badge
                          tone={
                            refund.status === 'COMPLETED'
                              ? 'success'
                              : refund.status === 'PENDING'
                                ? 'warning'
                                : 'danger'
                          }
                          size="sm"
                          dot
                        >
                          {refund.status}
                        </Badge>
                      </p>
                      <small>
                        {formatDateTime(refund.requestedAt)}
                        {refund.notes ? ` — ${refund.notes}` : ''}
                      </small>
                    </div>
                    {refund.status === 'PENDING' && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setRefundTargetId(refund.id);
                          setBanorteRef('');
                          setIntent('complete-refund');
                        }}
                      >
                        Marcar completado
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Auditoría" description="Eventos del registro vinculados a esta orden">
            <ActivityFeed
              items={auditItems}
              loading={auditQuery.isPending}
              label="Auditoría de la orden"
              empty={
                <EmptyState
                  title="Sin entradas de auditoría"
                  description="Cuando haya acciones registradas aparecerán aquí."
                  illustration="inbox"
                  size="sm"
                />
              }
            />
          </Section>
        </div>

        <aside className={styles.detailSide} aria-label="Contexto de la orden">
          <Section title="Comprador" headingLevel="h2">
            <dl className={styles.metaList}>
              <div>
                <dt>Nombre</dt>
                <dd>{order.buyerName || '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${order.buyerEmail}`}>{order.buyerEmail}</a>
                </dd>
              </div>
              <div>
                <dt>Teléfono</dt>
                <dd>{order.buyerPhone || '—'}</dd>
              </div>
              <div>
                <dt>Facturación</dt>
                <dd>{order.billingAddress || '—'}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Pago" headingLevel="h2">
            <dl className={styles.metaList}>
              <div>
                <dt>Total</dt>
                <dd className={styles.amount}>{money(order.totalAmount, order.currency)}</dd>
              </div>
              <div>
                <dt>Subtotal</dt>
                <dd>{money(order.subtotal ?? order.totalAmount, order.currency)}</dd>
              </div>
              <div>
                <dt>Comisión / fees</dt>
                <dd>{money(order.fees ?? 0, order.currency)}</dd>
              </div>
              <div>
                <dt>Impuestos</dt>
                <dd>{money(order.taxAmount ?? 0, order.currency)}</dd>
              </div>
              <div>
                <dt>Descuento</dt>
                <dd>{money(order.discountAmount ?? 0, order.currency)}</dd>
              </div>
              <div>
                <dt>Método</dt>
                <dd>{order.paymentMethod || order.payment?.method || '—'}</dd>
              </div>
              <div>
                <dt>Pasarela</dt>
                <dd>
                  {order.payment
                    ? `${order.payment.gateway} · ${order.payment.status}`
                    : 'Sin pago'}
                </dd>
              </div>
              {order.payment?.externalId && (
                <div>
                  <dt>ID externo</dt>
                  <dd>
                    <code className={styles.code}>{order.payment.externalId}</code>
                  </dd>
                </div>
              )}
              {(order.payment?.brand || order.payment?.lastFourDigits) && (
                <div>
                  <dt>Tarjeta</dt>
                  <dd>
                    {order.payment.brand ?? 'Card'}
                    {order.payment.lastFourDigits
                      ? ` · •••• ${order.payment.lastFourDigits}`
                      : ''}
                  </dd>
                </div>
              )}
              {order.payment?.errorMessage && (
                <div>
                  <dt>Error</dt>
                  <dd className={styles.dangerText}>{order.payment.errorMessage}</dd>
                </div>
              )}
            </dl>
          </Section>

          <Section title="Canal" headingLevel="h2">
            <dl className={styles.metaList}>
              <div>
                <dt>Origen</dt>
                <dd>
                  <ChannelBadge channel={order.channel} />
                </dd>
              </div>
              <div>
                <dt>Cajero</dt>
                <dd>{order.cashierId || '—'}</dd>
              </div>
              <div>
                <dt>Evento</dt>
                <dd>
                  {order.event.id || order.event.slug ? (
                    <Link href={`/events/${order.event.id ?? order.event.slug}`}>
                      {order.event.title}
                    </Link>
                  ) : (
                    order.event.title
                  )}
                </dd>
              </div>
            </dl>
          </Section>

          <Section
            title="Fraude"
            description="Banderas asociadas a esta orden"
            headingLevel="h2"
          >
            {fraudQuery.isPending && !(order.fraudFlags?.length) ? (
              <p className={styles.muted} role="status">
                Cargando señales…
              </p>
            ) : flags.length === 0 ? (
              <p className={styles.muted}>Sin banderas de fraude.</p>
            ) : (
              <ul className={styles.fraudList}>
                {flags.map((flag) => (
                  <li key={flag.id} className={styles.fraudRow}>
                    <div className={styles.fraudHead}>
                      <Badge
                        tone={
                          fraudTone(flag.severity) === 'danger'
                            ? 'danger'
                            : fraudTone(flag.severity) === 'warning'
                              ? 'warning'
                              : 'info'
                        }
                        size="sm"
                        dot
                      >
                        {flag.severity}
                      </Badge>
                      <span className={styles.muted}>score {flag.score}</span>
                    </div>
                    <p>{flag.reason}</p>
                    <small className={styles.muted}>
                      {flag.type} · {flag.status}
                      {flag.createdAt ? ` · ${formatDateTime(flag.createdAt)}` : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>

      <ConfirmActionModal
        open={intent !== null}
        title={
          intent === 'cancel'
            ? 'Cancelar orden'
            : intent === 'refund'
              ? 'Solicitar reembolso Banorte'
              : intent === 'complete-refund'
                ? 'Marcar reembolso completado'
                : 'Reenviar email'
        }
        description={
          intent === 'cancel'
            ? `¿Cancelar la orden pendiente ${order.publicId}?`
            : intent === 'refund'
              ? `¿Solicitar reembolso de ${money(order.totalAmount, order.currency)} para ${order.publicId}?`
              : intent === 'complete-refund'
                ? 'Confirma que el reembolso ya se procesó en Banorte. Se liberará inventario.'
                : `Se reenviará la confirmación a ${order.buyerEmail}.`
        }
        confirmLabel={
          intent === 'cancel'
            ? 'Cancelar orden'
            : intent === 'refund'
              ? 'Solicitar reembolso'
              : intent === 'complete-refund'
                ? 'Marcar completado'
                : 'Reenviar'
        }
        tone={intent === 'cancel' || intent === 'refund' ? 'danger' : 'primary'}
        busy={busy}
        onClose={() => {
          setIntent(null);
          setRefundTargetId(null);
          setBanorteRef('');
        }}
        onConfirm={() => void runConfirmedAction()}
      >
        {intent === 'complete-refund' && (
          <label className={styles.field}>
            <span>Referencia Banorte (opcional)</span>
            <input
              type="text"
              value={banorteRef}
              onChange={(e) => setBanorteRef(e.target.value)}
              placeholder="REF-…"
              autoComplete="off"
            />
          </label>
        )}
      </ConfirmActionModal>
    </div>
  );
}
