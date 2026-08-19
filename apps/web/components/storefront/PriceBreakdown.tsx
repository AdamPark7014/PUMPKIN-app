import { moneyExact } from '@/lib/format';
import type { CartPricing } from '@/lib/storefront-types';
import styles from './PriceBreakdown.module.scss';

/**
 * Desglose transparente de cargos. Los montos llegan de `/pricing/calculate-cart`
 * o de la orden confirmada; nunca se inventan en el cliente.
 */
export function PriceBreakdown({
  pricing,
  currency = 'MXN',
  loading = false,
}: {
  pricing: CartPricing | null;
  currency?: string;
  loading?: boolean;
}) {
  if (loading && !pricing) {
    return (
      <div className={styles.box} aria-busy="true" aria-live="polite">
        <p className={styles.loading}>Calculando cargos…</p>
      </div>
    );
  }

  if (!pricing) return null;

  const discount = Number(pricing.discount);
  const fees = Number(pricing.fees);
  const taxes = Number(pricing.taxes);
  const rows: { label: string; value: string; tone?: 'muted' | 'discount' | 'total' }[] = [
    { label: 'Subtotal', value: moneyExact(pricing.subtotal, currency) },
  ];
  // Sólo se listan cargos que existen. Con precio final (IVA incluido, sin
  // cargo por servicio) una fila "$0.00" confunde más de lo que informa.
  if (fees > 0) {
    rows.push({ label: 'Cargos de servicio', value: moneyExact(pricing.fees, currency), tone: 'muted' });
  }
  if (taxes > 0) {
    rows.push({ label: 'Impuestos', value: moneyExact(pricing.taxes, currency), tone: 'muted' });
  } else {
    rows.push({ label: 'IVA', value: 'incluido en el precio', tone: 'muted' });
  }
  if (Number.isFinite(discount) && discount > 0) {
    rows.push({
      label: 'Descuento',
      value: `−${moneyExact(pricing.discount, currency)}`,
      tone: 'discount',
    });
  }
  rows.push({
    label: 'Total',
    value: moneyExact(pricing.total, currency),
    tone: 'total',
  });

  return (
    <div className={styles.box} aria-label="Desglose de cargos">
      <ul>
        {rows.map((row) => (
          <li
            key={row.label}
            className={
              row.tone === 'total'
                ? styles.total
                : row.tone === 'discount'
                  ? styles.discount
                  : row.tone === 'muted'
                    ? styles.muted
                    : undefined
            }
          >
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Los cargos de servicio e impuestos se confirman antes de pagar. Sin sorpresas al cobro.
      </p>
    </div>
  );
}
