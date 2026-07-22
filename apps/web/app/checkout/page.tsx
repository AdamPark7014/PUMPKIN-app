'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { authHeaders, getStoredUser } from '@/lib/auth';
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

function CheckoutForm() {
  const params = useSearchParams();
  const router = useRouter();
  const eventId = params.get('eventId') ?? '';
  const offerId = params.get('offerId') ?? '';
  const storedUser = getStoredUser();
  const holdIds = (params.get('holdIds') ?? '').split(',').filter(Boolean);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [promo, setPromo] = useState('');
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [promoValid, setPromoValid] = useState(false);
  const [method, setMethod] = useState('CARD');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState('');
  const [gatewayInfo, setGatewayInfo] = useState<{ settlement: string; demo: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (storedUser) {
      setName(`${storedUser.firstName} ${storedUser.lastName}`.trim());
      setEmail(storedUser.email);
    }
  }, [storedUser]);

  useEffect(() => {
    fetch(`${API}/payments/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setGatewayInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!eventId || !offerId || !holdIds.length) return;
    fetch(`${API}/pricing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        offerId,
        quantity: holdIds.length,
        promotionCode: promoValid ? promo : undefined,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setPricing)
      .catch(() => {});
  }, [eventId, offerId, holdIds.length, promo, promoValid]);

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
          offerId: offerId || undefined,
          holdIds,
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
          `/orders/${order.publicId}/pago?method=${method}&ref=${action.reference ?? ''}`,
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

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <h1>Checkout</h1>
        <p className={styles.step}>Paso 2 de 3 — Pago Banorte · {holdIds.length} boleto(s)</p>

        {gatewayInfo && (
          <p className={styles.banorteNote}>
            Pago directo a cuenta Banorte del promotor
            {gatewayInfo.demo ? ' (modo demo)' : ''}. Sin Stripe.
          </p>
        )}

        {pricing && (
          <aside className={styles.summary}>
            <div>
              <span>Subtotal</span>
              <strong>${pricing.subtotal}</strong>
            </div>
            <div>
              <span>Cargos</span>
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
          </aside>
        )}

        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
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
            <button type="button" onClick={validatePromo} disabled={!promo.trim()}>
              Validar
            </button>
          </div>
          {promoMsg && <span className={promoValid ? styles.promoOk : styles.promoErr}>{promoMsg}</span>}
        </label>
        <fieldset>
          <legend>Método de pago (Banorte)</legend>
          {[
            { id: 'CARD', label: 'Tarjeta (Payworks 3-D Secure)' },
            { id: 'SPEI', label: 'Transferencia SPEI' },
            { id: 'OXXO', label: 'Referencia OXXO' },
          ].map((m) => (
            <label key={m.id} className={styles.radio}>
              <input
                type="radio"
                name="method"
                value={m.id}
                checked={method === m.id}
                onChange={() => setMethod(m.id)}
              />
              {m.label}
            </label>
          ))}
        </fieldset>
        {error && <p className={styles.error}>{error}</p>}
        <button
          type="button"
          className={styles.pay}
          disabled={loading || !name || !email || !holdIds.length}
          onClick={pay}
        >
          {loading ? 'Procesando…' : `Continuar al pago ${pricing ? `$${pricing.total}` : ''}`}
        </button>
      </main>
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutForm />
    </Suspense>
  );
}
