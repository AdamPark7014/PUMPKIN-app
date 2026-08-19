'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { useCartStore, type CartOfferLine } from '@/lib/cart-store';
import { formatPrice } from '@/lib/event-config';
import styles from './TicketPicker.module.scss';

export type PickerTier = {
  id: string;
  name: string;
  blurb: string;
  perks: string[];
  featured: boolean;
  offerId: string;
  price: number;
  remaining: number;
  maxPerOrder: number;
};

type Props = {
  eventId: string;
  canPurchase: boolean;
  tiers: PickerTier[];
};

type HoldResponse = {
  holds?: { id: string }[];
  message?: string;
};

export function TicketPicker({ eventId, canPurchase, tiers }: Props) {
  const router = useRouter();
  const addToCart = useCartStore((s) => s.addItem);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => tiers.filter((t) => (qty[t.id] ?? 0) > 0),
    [tiers, qty],
  );
  const totalTickets = selected.reduce((n, t) => n + (qty[t.id] ?? 0), 0);
  const subtotal = selected.reduce((n, t) => n + t.price * (qty[t.id] ?? 0), 0);

  function setQuantity(tier: PickerTier, next: number) {
    const cap = Math.min(tier.maxPerOrder, tier.remaining);
    const clamped = Math.max(0, Math.min(next, cap));
    setQty((prev) => ({ ...prev, [tier.id]: clamped }));
    setError(null);
  }

  async function reserve() {
    if (!selected.length || loading) return;
    setLoading(true);
    setError(null);

    try {
      // Un hold por acceso elegido. Si alguno falla, se aborta completo: es
      // preferible no reservar nada a mandar al checkout media compra.
      const lines: CartOfferLine[] = [];

      for (const tier of selected) {
        const quantity = qty[tier.id] ?? 0;
        const res = await fetch(`${API_BASE}/inventory/holds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId,
            offerId: tier.offerId,
            quantity,
            sessionId: crypto.randomUUID(),
          }),
        });
        const data = (await res.json()) as HoldResponse;
        if (!res.ok) {
          throw new Error(data.message || `No se pudo reservar ${tier.name}`);
        }
        const holds = data.holds ?? [];
        if (holds.length < quantity) {
          throw new Error(
            `Sólo quedan ${holds.length} de ${tier.name}. Ajusta la cantidad.`,
          );
        }
        lines.push({
          offerId: tier.offerId,
          offerName: tier.name,
          holdIds: holds.map((h) => h.id),
          seatLabels: Array.from({ length: holds.length }, () => tier.name),
          quantity: holds.length,
          lineTotal: tier.price * holds.length,
        });
      }

      addToCart({
        eventId,
        eventTitle: 'Pumpkin Zone',
        lines,
        seatCount: lines.reduce((n, l) => n + l.quantity, 0),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });

      const holdIds = lines.flatMap((l) => l.holdIds).join(',');
      router.push(
        `/checkout?eventId=${eventId}&offerId=${lines[0]!.offerId}&holdIds=${holdIds}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron reservar los boletos');
      setLoading(false);
    }
  }

  return (
    <div className={styles.layout}>
      <ul className={styles.tiers}>
        {tiers.map((tier) => {
          const n = qty[tier.id] ?? 0;
          const cap = Math.min(tier.maxPerOrder, tier.remaining);
          const soldOut = tier.remaining <= 0;

          return (
            <li
              key={tier.id}
              className={`${styles.tier} ${tier.featured ? styles.featured : ''} ${
                soldOut ? styles.soldOut : ''
              }`}
            >
              {tier.featured && !soldOut && <span className={styles.flag}>El más elegido</span>}

              <div className={styles.tierMain}>
                <h2 className={styles.tierName}>{tier.name}</h2>
                <p className={styles.tierBlurb}>{tier.blurb}</p>
                <ul className={styles.perks}>
                  {tier.perks.map((perk) => (
                    <li key={perk}>
                      <Check />
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.tierBuy}>
                <p className={styles.price}>
                  {formatPrice(tier.price)}
                  <span>por persona</span>
                </p>

                {soldOut ? (
                  <p className={styles.soldOutTag}>Agotado</p>
                ) : (
                  <>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        onClick={() => setQuantity(tier, n - 1)}
                        disabled={n === 0 || loading}
                        aria-label={`Quitar un ${tier.name}`}
                      >
                        −
                      </button>
                      <span aria-live="polite" aria-label={`${n} boletos de ${tier.name}`}>
                        {n}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(tier, n + 1)}
                        disabled={n >= cap || loading}
                        aria-label={`Agregar un ${tier.name}`}
                      >
                        +
                      </button>
                    </div>
                    {tier.remaining <= 50 && (
                      <p className={styles.scarce}>Quedan {tier.remaining}</p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Resumen pegajoso: el total siempre visible mientras se eligen accesos. */}
      <aside className={styles.summary} aria-label="Resumen de compra">
        <h2>Tu compra</h2>

        {selected.length === 0 ? (
          <p className={styles.summaryEmpty}>
            Elige cuántos boletos quieres de cada acceso.
          </p>
        ) : (
          <ul className={styles.summaryLines}>
            {selected.map((tier) => (
              <li key={tier.id}>
                <span>
                  {qty[tier.id]} × {tier.name}
                </span>
                <strong>{formatPrice(tier.price * (qty[tier.id] ?? 0))}</strong>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.total}>
          <span>Total</span>
          <strong>{formatPrice(subtotal)}</strong>
        </div>
        <p className={styles.totalNote}>Impuestos incluidos · Sin cargos ocultos</p>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className={styles.cta}
          onClick={() => void reserve()}
          disabled={!canPurchase || totalTickets === 0 || loading}
        >
          {loading
            ? 'Reservando…'
            : totalTickets === 0
              ? 'Elige tus boletos'
              : `Continuar · ${totalTickets} ${totalTickets === 1 ? 'boleto' : 'boletos'}`}
        </button>

        {!canPurchase && (
          <p className={styles.closed} role="status">
            La venta en línea no está abierta en este momento.
          </p>
        )}

        <p className={styles.reassure}>
          Tus boletos se apartan 10 minutos mientras completas el pago.
        </p>
      </aside>
    </div>
  );
}

function Check() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
