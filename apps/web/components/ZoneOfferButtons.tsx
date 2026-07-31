'use client';

import { usePathname, useRouter } from 'next/navigation';
import { AvailabilityBadge } from '@/components/storefront/AvailabilityBadge';
import { money } from '@/lib/format';
import type { OfferSummary } from '@/lib/storefront-types';
import styles from './ZoneOfferButtons.module.scss';

export function ZoneOfferButtons({
  offers,
  currency,
  activeZone,
  disabled = false,
}: {
  offers: OfferSummary[];
  currency: string;
  activeZone?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function pick(zone: string) {
    if (disabled) return;
    const params = new URLSearchParams();
    params.set('zone', zone);
    router.replace(`${pathname}?${params}`, { scroll: false });
    requestAnimationFrame(() => {
      document.getElementById('compra')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <ul className={styles.list} role="list">
      {offers.map((o) => {
        const active = activeZone === o.zone;
        const label = o.name?.trim() || `Zona ${o.zone.toUpperCase()}`;
        const remaining =
          typeof o.remainingQuantity === 'number' ? o.remainingQuantity : null;
        const soldOut = remaining === 0 || o.isAvailable === false;

        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => pick(o.zone)}
              className={active ? styles.active : styles.row}
              aria-pressed={active}
              aria-disabled={disabled || soldOut}
              disabled={disabled || soldOut}
            >
              <div className={styles.copy}>
                <strong>{label}</strong>
                <span className={styles.meta}>
                  <AvailabilityBadge remaining={remaining} threshold={20} />
                  {!soldOut && (
                    <span className={styles.hint}>
                      {remaining == null ? 'Ver en mapa' : 'Elegir zona'}
                    </span>
                  )}
                </span>
              </div>
              <em className={styles.price}>{money(o.basePrice, currency)}</em>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
