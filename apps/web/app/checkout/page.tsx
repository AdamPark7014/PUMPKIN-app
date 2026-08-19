'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Button, Input } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { HoldCountdown } from '@/components/HoldCountdown';
import { PriceBreakdown } from '@/components/storefront/PriceBreakdown';
import { PurchaseSteps } from '@/components/storefront/PurchaseSteps';
import { TrustRow, TRUST_OFFICIAL, TRUST_QR, trustPayment } from '@/components/storefront/TrustRow';
import { API_BASE, ApiError, api } from '@/lib/api';
import { authHeaders, getStoredUser } from '@/lib/auth';
import { normalizeCartItem, useCartStore } from '@/lib/cart-store';
import {
  buildIdempotencySeed,
  hasCheckoutErrors,
  newIdempotencyKey,
  paymentErrorMessage,
  validateCheckoutForm,
  type CheckoutFormErrors,
} from '@/lib/checkout-guards';
import { dateTime, moneyExact } from '@/lib/format';
import type {
  CartPricing,
  GatewayConfig,
  PaymentAction,
  PaymentMethodId,
} from '@/lib/storefront-types';
import styles from './checkout.module.scss';

type OrderCreationResponse = {
  publicId: string;
  paymentAction?: PaymentAction | null;
};

type RequestState = 'idle' | 'loading' | 'ready' | 'error';

const METHODS: readonly {
  id: PaymentMethodId;
  label: string;
  detail: string;
}[] = [
  {
    id: 'CARD',
    label: 'Tarjeta',
    detail: 'Visa / Mastercard · Pago seguro',
  },
  {
    id: 'SPEI',
    label: 'SPEI',
    detail: 'Transferencia bancaria (CLABE)',
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
  const urlHoldIdsValue = params.get('holdIds') ?? '';
  const urlHoldIds = useMemo(
    () => urlHoldIdsValue.split(',').filter(Boolean),
    [urlHoldIdsValue],
  );
  const [storedUser] = useState(() => getStoredUser());
  const rawCart = useCartStore((s) => s.items.find((i) => i.eventId === eventId));
  const cartItem = useMemo(
    () => (rawCart ? normalizeCartItem(rawCart) : null),
    [rawCart],
  );
  const orderLines = useMemo(
    () =>
      cartItem?.lines?.length
        ? cartItem.lines
        : offerId && urlHoldIds.length
          ? [{ offerId, holdIds: urlHoldIds, quantity: urlHoldIds.length }]
          : [],
    [cartItem, offerId, urlHoldIds],
  );
  const holdIds = useMemo(() => orderLines.flatMap((line) => line.holdIds), [orderLines]);
  const cartExpires = cartItem?.expiresAt;
  const expiresAt = params.get('expiresAt') || cartExpires || null;
  const [holdExpired, setHoldExpired] = useState(false);
  const [name, setName] = useState(
    () => `${storedUser?.firstName ?? ''} ${storedUser?.lastName ?? ''}`.trim(),
  );
  const [email, setEmail] = useState(() => storedUser?.email ?? '');
  const [fieldErrors, setFieldErrors] = useState<CheckoutFormErrors>({});
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoValid, setPromoValid] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const [method, setMethod] = useState<PaymentMethodId>('CARD');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<CartPricing | null>(null);
  const [pricingState, setPricingState] = useState<RequestState>('idle');
  const [error, setError] = useState('');
  const [gatewayInfo, setGatewayInfo] = useState<GatewayConfig | null>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{ seed: string; key: string } | null>(null);
  const handleHoldExpire = useCallback(() => setHoldExpired(true), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/payments/config`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((r) => (r.ok ? (r.json() as Promise<GatewayConfig>) : null))
      .then((data) => {
        if (data) setGatewayInfo(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const linesKey = useMemo(
    () => orderLines.map((line) => `${line.offerId}:${line.holdIds.join(',')}`).join('|'),
    [orderLines],
  );

  useEffect(() => {
    if (!eventId || !orderLines.length) {
      setPricing(null);
      setPricingState('idle');
      return;
    }
    const controller = new AbortController();
    const items = orderLines.map((l) => ({
      offerId: l.offerId,
      quantity: l.holdIds.length || l.quantity || 1,
    }));
    setPricingState('loading');
    fetch(`${API_BASE}/pricing/calculate-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify({
        eventId,
        items,
        promotionCode: promoValid ? promo.trim() : undefined,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('pricing');
        return response.json() as Promise<CartPricing>;
      })
      .then((nextPricing) => {
        setPricing(nextPricing);
        setPricingState('ready');
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setPricing(null);
        setPricingState('error');
      });
    return () => controller.abort();
  }, [eventId, linesKey, orderLines, promo, promoValid]);

  async function validatePromo() {
    const normalizedPromo = promo.trim();
    if (!normalizedPromo || !eventId || promoLoading) return;
    setPromoLoading(true);
    setPromoMsg(null);
    try {
      const res = await fetch(`${API_BASE}/campaigns/validate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          code: normalizedPromo,
          eventId,
          userId: email.trim() || 'guest',
        }),
      });
      if (!res.ok) {
        setPromoValid(false);
        setPromoMsg('El código no es válido o ya expiró. Revisa e intenta de nuevo.');
        return;
      }
      const body = (await res.json()) as { valid?: boolean; reason?: string };
      if (body.valid === false) {
        setPromoValid(false);
        setPromoMsg(body.reason || 'El código no es válido o ya expiró.');
        return;
      }
      setPromo(normalizedPromo);
      setPromoValid(true);
      setPromoMsg('Código aplicado correctamente.');
    } catch {
      setPromoValid(false);
      setPromoMsg('No pudimos validar el código. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setPromoLoading(false);
    }
  }

  function ensureIdempotencyKey(): string {
    const seed = buildIdempotencySeed({
      eventId,
      holdIds,
      email,
    });
    if (idempotencyRef.current?.seed !== seed) {
      idempotencyRef.current = { seed, key: newIdempotencyKey() };
    }
    return idempotencyRef.current.key;
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || loading) return;

    const errors = validateCheckoutForm({
      name,
      email,
      holdIds,
      holdExpired,
    });
    setFieldErrors(errors);
    if (hasCheckoutErrors(errors)) {
      setError(errors.holds ?? 'Revisa los datos marcados e inténtalo de nuevo.');
      return;
    }
    if (!eventId || !orderLines.length) {
      setError('No hay asientos reservados. Vuelve al mapa para continuar.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError('');

    try {
      const idempotencyKey = ensureIdempotencyKey();
      const order = await api<OrderCreationResponse>('/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
          ...authHeaders(),
        },
        body: JSON.stringify({
          eventId,
          items: orderLines.map((l) => ({ offerId: l.offerId, holdIds: l.holdIds })),
          holdIds,
          buyerName: name.trim(),
          buyerEmail: email.trim().toLowerCase(),
          paymentMethod: method,
          promotionCode: promoValid ? promo.trim() : undefined,
        }),
      });

      if (order.paymentAction) {
        const action = order.paymentAction;
        if (action.redirectUrl) {
          window.location.href = action.redirectUrl;
          return;
        }
        router.push(`/orders/${order.publicId}/pago?method=${method}`);
        return;
      }

      router.push(`/orders/${order.publicId}`);
    } catch (e) {
      const detail = paymentErrorMessage(e);
      setError(detail);
      if (
        e instanceof ApiError &&
        (e.isConflict ||
          detail.toLowerCase().includes('expir') ||
          detail.toLowerCase().includes('disponible'))
      ) {
        // Rotate key on conflict / inventory change so a corrected retry is a new attempt.
        idempotencyRef.current = null;
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  const seatLabels = useMemo(
    () => cartItem?.lines?.flatMap((l) => l.seatLabels ?? []) ?? cartItem?.seatLabels ?? [],
    [cartItem],
  );
  const currency = cartItem?.currency || 'MXN';
  const demo = gatewayInfo?.demo === true;
  const canSubmit =
    !loading && !holdExpired && holdIds.length > 0 && Boolean(eventId) && orderLines.length > 0;
  const methodHint =
    method === 'SPEI'
      ? 'Te mostraremos CLABE y concepto exactos para transferir.'
      : method === 'OXXO'
        ? 'Recibirás una referencia para pagar en tienda.'
        : demo
          ? 'Simulación local sin cargo real ni datos de tarjeta.'
          : 'Serás redirigido a nuestra plataforma de pago seguro.';
  const recoverHref = cartItem?.slug ? `/events/${cartItem.slug}` : '/events';
  const payLabel = demo
    ? `Simular pago${pricing ? ` ${moneyExact(pricing.total, currency)}` : ''}`
    : `Pagar${pricing ? ` ${moneyExact(pricing.total, currency)}` : ''}`;

  return (
    <div className={styles.shell}>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <PurchaseSteps current="checkout" />

        <header className={styles.hero}>
          <h1>Checkout</h1>
          <p>
            {demo
              ? `Modo demo · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'} · sin cargo real`
              : `Pago Banorte · ${holdIds.length} boleto${holdIds.length === 1 ? '' : 's'}`}
            {!storedUser ? ' · Compra como invitado' : ''}
          </p>
        </header>

        <HoldCountdown expiresAt={expiresAt} onExpire={handleHoldExpire} />
        {holdExpired && (
          <p className={styles.error} role="alert">
            Tu reserva expiró y los asientos se liberaron.{' '}
            <Link href={recoverHref}>Volver a elegir asientos</Link>
          </p>
        )}
        {!holdIds.length && !holdExpired && (
          <p className={styles.error} role="alert">
            No encontramos holds activos para este checkout.{' '}
            <Link href="/cart">Regresar al carrito</Link> o{' '}
            <Link href={recoverHref}>elegir asientos de nuevo</Link>.
          </p>
        )}
        {fieldErrors.holds && !holdExpired && holdIds.length > 0 && (
          <p className={styles.error} role="alert">
            {fieldErrors.holds}
          </p>
        )}

        <div className={styles.layout}>
          <form className={styles.formCol} aria-label="Datos de pago" onSubmit={pay} noValidate>
            <TrustRow
              items={[TRUST_OFFICIAL, TRUST_QR, trustPayment(demo)]}
              tone="light"
            />

            {gatewayInfo && (
              <p
                className={`${styles.banorteNote} ${demo ? styles.banorteDemo : ''}`}
                role={demo ? 'status' : undefined}
              >
                {gatewayInfo.buyerNote ?? gatewayInfo.settlement}
                {gatewayInfo.accountClabeMasked
                  ? ` · CLABE ${gatewayInfo.accountClabeMasked}`
                  : ''}
              </p>
            )}

            <div className={styles.fieldGrid}>
              <Input
                id="checkout-name"
                label="Nombre completo"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) {
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }
                }}
                autoComplete="name"
                name="name"
                required
                requiredMark
                error={fieldErrors.name}
                disabled={loading || holdExpired}
              />
              <Input
                id="checkout-email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) {
                    setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
                autoComplete="email"
                name="email"
                inputMode="email"
                required
                requiredMark
                error={fieldErrors.email}
                hint="Aquí enviamos tus boletos y el comprobante. No necesitas cuenta."
                disabled={loading || holdExpired}
              />
            </div>

            <div className={styles.promoLabel}>
              <label htmlFor="checkout-promo">Código promocional</label>
              <div className={styles.promoRow}>
                <input
                  id="checkout-promo"
                  value={promo}
                  onChange={(e) => {
                    setPromo(e.target.value);
                    setPromoValid(false);
                    setPromoMsg(null);
                  }}
                  placeholder="Opcional"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={loading || holdExpired}
                  aria-describedby={promoMsg ? 'checkout-promo-msg' : undefined}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={validatePromo}
                  disabled={!promo.trim() || promoLoading || loading || holdExpired}
                  aria-busy={promoLoading}
                >
                  {promoLoading ? 'Validando…' : 'Validar'}
                </Button>
              </div>
              {promoMsg && (
                <span
                  id="checkout-promo-msg"
                  className={promoValid ? styles.promoOk : styles.promoErr}
                  role="status"
                >
                  {promoMsg}
                </span>
              )}
            </div>

            <fieldset className={styles.methods} disabled={loading || holdExpired}>
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
                      {demo && m.id === 'CARD'
                        ? 'Simulación local · sin cargo real'
                        : m.detail}
                    </span>
                  </button>
                ))}
              </div>
              <p className={styles.methodHint} id="checkout-method-hint">
                {methodHint}
              </p>
            </fieldset>

            {error && (
              <div className={styles.errorBox} role="alert" aria-live="assertive">
                <p>{error}</p>
                <div className={styles.errorActions}>
                  {!holdExpired && holdIds.length > 0 ? (
                    <button type="submit" disabled={!canSubmit || loading}>
                      Reintentar pago
                    </button>
                  ) : null}
                  <Link href={recoverHref}>Volver a los asientos</Link>
                  <Link href="/cart">Volver al carrito</Link>
                </div>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className={styles.pay}
              disabled={!canSubmit}
              loading={loading}
              loadingLabel="Creando orden…"
            >
              {payLabel}
            </Button>

            <p className={styles.fine}>
              Al continuar aceptas los <Link href="/terminos">términos</Link> y el{' '}
              <Link href="/privacidad">aviso de privacidad</Link>. No almacenamos datos de tarjeta
              en TicketOS.
              {!storedUser
                ? ' Puedes pagar como invitado; el email es suficiente para recibir tus boletos.'
                : ''}
            </p>
          </form>

          <aside className={styles.summaryCol} aria-label="Resumen del pedido">
            {cartItem ? (
              <div className={styles.lineItems}>
                <p className={styles.summaryKicker}>Tu pedido</p>
                <h2>{cartItem.eventTitle}</h2>
                {(cartItem.venueName || cartItem.startsAt) && (
                  <p className={styles.lineMeta}>
                    {cartItem.venueName}
                    {cartItem.venueCity ? ` · ${cartItem.venueCity}` : ''}
                    {cartItem.startsAt ? ` · ${dateTime(cartItem.startsAt)}` : ''}
                  </p>
                )}
                {orderLines.length > 0 && (
                  <ul className={styles.zoneList}>
                    {orderLines.map((line) => (
                      <li key={line.offerId}>
                        <span>{('offerName' in line && line.offerName) || 'Zona'}</span>
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
                <h2>
                  {holdIds.length} boleto{holdIds.length === 1 ? '' : 's'}
                </h2>
                <p className={styles.lineMeta}>Reserva desde hold activo</p>
              </div>
            )}

            <div className={styles.summary} aria-live="polite">
              {pricingState === 'error' && (
                <p className={styles.summaryStatus}>
                  No pudimos cargar el desglose. El total final se confirma al crear la orden.
                </p>
              )}
              {pricingState === 'idle' && !pricing && (
                <p className={styles.summaryStatus}>El desglose aparecerá al cargar el carrito.</p>
              )}
              <PriceBreakdown
                pricing={pricing}
                currency={currency}
                loading={pricingState === 'loading'}
              />
            </div>

            <ol className={styles.nextSteps}>
              <li>Revisa total y método</li>
              <li>{demo ? 'Simula el pago (sin cargo)' : 'Confirma tu pago'}</li>
              <li>Recibe QR de acceso</li>
            </ol>

            <Link href="/cart" className={styles.backCart}>
              ← Volver al carrito
            </Link>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.shell}>
          <SiteHeader theme="dark" />
          <main className={styles.page}>
            <p role="status">Cargando checkout…</p>
          </main>
        </div>
      }
    >
      <CheckoutForm />
    </Suspense>
  );
}
