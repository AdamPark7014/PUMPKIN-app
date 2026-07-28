'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { HoldCountdown } from '@/components/HoldCountdown';
import { authHeaders, getStoredUser } from '@/lib/auth';
import { useCartStore } from '@/lib/cart-store';
import styles from './checkout.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Pricing = {
  subtotal: string;
  fees: string;
  taxes: string;
  total: string;
  discount: string;
};

type PaymentAction = {
  gateway: string;
  intentId: string;
  redirectUrl?: string;
  reference?: string;
  metadata?: {
    type?: string;
    clabe?: string;
    concept?: string;
    demo?: boolean;
  };
  status: string;
};

type GatewayInfo = {
  settlement: string;
  demo: boolean;
  mode?: 'demo' | 'live';
  productionReady?: boolean;
  buyerNote?: string;
  accountClabeMasked?: string | null;
};

const METHODS = [
  {
    id: 'CARD',
    label: 'Tarjeta',
    detail: 'Visa / Mastercard · Payworks 3-D Secure',
  },
  {
    id: 'SPEI',
    label: 'SPEI',
    detail: 'Transferencia a CLABE Banorte del promotor',
  },
  {
    id: 'OXXO',
    label: 'OXXO',
    detail: 'Paga en tienda con referencia',
  },
] as const;

function CheckoutForm() {
  const params = useSearchParams();
  const router = useRouter();
  const eventId = params.get('eventId') ?? '';
  const offerId = params.get('offerId') ?? '';
  const storedUser = getStoredUser();
  const urlHoldIds = (params.get('holdIds') ?? '').split(',').filter(Boolean);
  const rawCart = useCartStore((s) => s.items.find((i) => i.eventId === eventId));
  const cartItem = rawCart
    ? {
        ...rawCart,
        lines:
          rawCart.lines?.length
            ? rawCart.lines
            : rawCart.offerId && rawCart.holdIds
              ? [
                  {
                    offerId: rawCart.offerId,
                    holdIds: rawCart.holdIds,
                    seatLabels: rawCart.seatLabels,
                    quantity: rawCart.holdIds.length,
                    lineTotal: rawCart.lineTotal,
                  },
                ]
              : [],
      }
    : null;
  const orderLines =
    cartItem?.lines?.length
      ? cartItem.lines
      : offerId && urlHoldIds.length
        ? [{ offerId, holdIds: urlHoldIds, quantity: urlHoldIds.length }]
        : [];
  const holdIds = orderLines.flatMap((l) => l.holdIds);
  const cartExpires = cartItem?.expiresAt;
  const expiresAt = params.get('expiresAt') || cartExpires || null;
  const [holdExpired, setHoldExpired] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoValid, setPromoValid] = useState(false);
  const [method, setMethod] = useState('CARD');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState('');
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);

  useEffect(() => {
    if (storedUser) {
      setName(`${storedUser.firstName} ${storedUser.lastName}`.trim());
      setEmail(storedUser.email);
    }
  }, [storedUser]);

  useEffect(() => {
    fetch(`${API}/payments/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GatewayInfo | null) => setGatewayInfo(data))
      .catch(() => {});
  }, []);

  const linesKey = orderLines.map((l) => `${l.offerId}:${l.holdIds.length}`).join('|');

  useEffect(() => {
    if (!eventId || !orderLines.length) return;
    const items = orderLines.map((l) => ({
      offerId: l.offerId,
      quantity: l.holdIds.length || l.quantity || 1,
    }));
    fetch(`${API}/pricing/calculate-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        items,
        promotionCode: promoValid ? promo : undefined,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPricing)
      .catch(() => {});
  }, [eventId, linesKey, promo, promoValid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function validatePromo() {
    if (!promo.trim() || !eventId) return;
    setPromoMsg(null);
    const res = await fetch(`${API}/campaigns/validate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: promo, eventId, userId: email || 'guest' }),
    });
    if (res.ok) {
      setPromoValid(true);
      setPromoMsg('Código aplicado');
    } else {
      setPromoValid(false);
      setPromoMsg('Código inválido o expirado');
    }
  }

  function paymentMethodForApi() {
    if (method === 'OXXO' || method === 'SPEI') return method;
    return 'CARD';
  }

  async function pay() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          ...authHeaders(),
        },
        body: JSON.stringify({
          eventId,
          items: orderLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
          holdIds,
          offerId: orderLines.length === 1 ? orderLines[0].offerId : offerId || undefined,
          buyerName: name || `${storedUser?.firstName ?? ''} ${storedUser?.lastName ?? ''}`.trim(),
          buyerEmail: email || storedUser?.email,
          paymentMethod: paymentMethodForApi(),
          promotionCode: promoValid ? promo : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'No se pudo crear la orden');
      }
      const order = await res.json();

      if (order.paymentAction) {
        const action = order.paymentAction as PaymentAction;
        if (action.redirectUrl) {
          window.location.href = action.redirectUrl;
          return;
        }
        router.push(
          `/orders/${order.publicId}/pago?method=${method}&ref=${encodeURIComponent(action.reference ?? '')}&clabe=${encodeURIComponent(String(action.metadata?.clabe ?? ''))}&concept=${encodeURIComponent(String(action.metadata?.concept ?? ''))}`,
        );
        return;
      }

      router.push(`/orders/${order.publicId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de pago');
    } finally {
      setLoading(false);
    }
  }

  const seatLabels =
    cartItem?.lines?.flatMap((l) => l.seatLabels ?? []) ?? cartItem?.seatLabels ?? [];

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.steps} aria-label="Progreso de compra">
          <Link href="/cart" className={styles.stepDone}>
            1 Carrito
          </Link>
          <span className={styles.stepActive}>2 Pago</span>
          <span className={styles.stepTodo}>3 Boletos</span>
        </div>

        <header className={styles.hero}>
          <h1>Checkout</h1>
          <p>
            {gatewayInfo?.demo
              ? `Modo demo · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'}`
              : `Pago Banorte · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'}`}
          </p>
        </header>

        <HoldCountdown expiresAt={expiresAt} onExpire={() => setHoldExpired(true)} />
        {holdExpired && (
          <p className={styles.error} role="alert">
            Tu reserva expiró.{' '}
            <Link href={cartItem?.slug ? `/events/${cartItem.slug}` : '/events'}>
              Volver a elegir asientos
            </Link>
          </p>
        )}

        <div className={styles.layout}>
          <section className={styles.formCol} aria-label="Datos de pago">
            <div className={styles.trust}>
              <span>Boletos oficiales</span>
              <span>{gatewayInfo?.demo ? 'Demo' : 'Banorte'}</span>
              <span>QR de acceso</span>
            </div>

            {gatewayInfo && (
              <p
                className={`${styles.banorteNote} ${gatewayInfo.demo ? styles.banorteDemo : ''}`}
                role={gatewayInfo.demo ? 'status' : undefined}
              >
                {gatewayInfo.buyerNote ?? gatewayInfo.settlement}
                {gatewayInfo.accountClabeMasked
                  ? ` · CLABE ${gatewayInfo.accountClabeMasked}`
                  : ''}
              </p>
            )}

            <div className={styles.fieldGrid}>
              <Input
                label="Nombre completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <label className={styles.promoLabel}>
              Código promocional
              <div className={styles.promoRow}>
                <input
                  value={promo}
                  onChange={(e) => {
                    setPromo(e.target.value);
                    setPromoValid(false);
                    setPromoMsg(null);
                  }}
                  placeholder="Opcional"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={validatePromo}
                  disabled={!promo.trim()}
                >
                  Validar
                </Button>
              </div>
              {promoMsg && (
                <span className={promoValid ? styles.promoOk : styles.promoErr}>{promoMsg}</span>
              )}
            </label>

            <fieldset className={styles.methods}>
              <legend>Método de pago</legend>
              <div className={styles.methodGrid} role="radiogroup" aria-label="Método de pago">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    className={`${styles.methodCard} ${method === m.id ? styles.methodOn : ''}`}
                    onClick={() => setMethod(m.id)}
                  >
                    <strong>{m.label}</strong>
                    <span>
                      {gatewayInfo?.demo && m.id === 'CARD'
                        ? 'Simulación local · sin cargo real'
                        : m.detail}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className={styles.pay}
              disabled={loading || !name || !email || !holdIds.length || holdExpired}
              onClick={pay}
            >
              {loading
                ? 'Procesando…'
                : gatewayInfo?.demo
                  ? `Simular pago${pricing ? ` $${pricing.total}` : ''}`
                  : `Pagar${pricing ? ` $${pricing.total}` : ''} con Banorte`}
            </Button>

            <p className={styles.fine}>
              Al continuar aceptas los{' '}
              <Link href="/terminos">términos</Link> y el{' '}
              <Link href="/privacidad">aviso de privacidad</Link>.
            </p>
          </section>

          <aside className={styles.summaryCol} aria-label="Resumen del pedido">
            {cartItem ? (
              <div className={styles.lineItems}>
                <p className={styles.summaryKicker}>Tu pedido</p>
                <h2>{cartItem.eventTitle}</h2>
                {(cartItem.venueName || cartItem.startsAt) && (
                  <p className={styles.lineMeta}>
                    {cartItem.venueName}
                    {cartItem.venueCity ? ` · ${cartItem.venueCity}` : ''}
                    {cartItem.startsAt
                      ? ` · ${new Date(cartItem.startsAt).toLocaleString('es-MX', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''}
                  </p>
                )}
                {orderLines.length > 0 && (
                  <ul className={styles.zoneList}>
                    {orderLines.map((line) => (
                      <li key={line.offerId}>
                        <span>{line.offerName || 'Zona'}</span>
                        <em>×{line.holdIds.length || line.quantity || 1}</em>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className={styles.seatList}>
                  {(seatLabels.length
                    ? seatLabels
                    : Array.from({ length: holdIds.length }, (_, i) => `Boleto ${i + 1}`)
                  ).map((label, i) => (
                    <li key={`${label}-${i}`}>{label}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className={styles.lineItems}>
                <p className={styles.summaryKicker}>Tu pedido</p>
                <h2>{holdIds.length} boleto(s)</h2>
                <p className={styles.lineMeta}>Reserva desde hold activo</p>
              </div>
            )}

            {pricing && (
              <div className={styles.summary}>
                <div>
                  <span>Subtotal</span>
                  <strong>${pricing.subtotal}</strong>
                </div>
                <div>
                  <span>Cargos de servicio</span>
                  <strong>${pricing.fees}</strong>
                </div>
                <div>
                  <span>Impuestos</span>
                  <strong>${pricing.taxes}</strong>
                </div>
                {Number(pricing.discount) > 0 && (
                  <div>
                    <span>Descuento</span>
                    <strong>−${pricing.discount}</strong>
                  </div>
                )}
                <div className={styles.total}>
                  <span>Total</span>
                  <strong>${pricing.total}</strong>
                </div>
              </div>
            )}

            <Link href="/cart" className={styles.backCart}>
              ← Volver al carrito
            </Link>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutForm />
    </Suspense>
  );
}
