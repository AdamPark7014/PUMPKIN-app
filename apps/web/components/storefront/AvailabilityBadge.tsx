import { count, plural } from '@/lib/format';
import styles from './AvailabilityBadge.module.scss';

/**
 * Urgencia honesta basada en inventario real.
 *
 * - No se inventa escasez.
 * - Sólo se muestra "pocos" cuando `remaining` llega de la API y es ≤ umbral.
 * - `null`/`undefined` → no se renderiza nada (mejor silencio que mentira).
 */
export function AvailabilityBadge({
  remaining,
  label = 'disponibles',
  threshold = 20,
}: {
  remaining: number | null | undefined;
  label?: string;
  /** Umbral bajo el cual se usa el tono de urgencia. */
  threshold?: number;
}) {
  if (remaining == null || !Number.isFinite(remaining) || remaining < 0) {
    return null;
  }

  if (remaining === 0) {
    return (
      <span className={`${styles.badge} ${styles.sold}`} role="status">
        Agotado
      </span>
    );
  }

  const low = remaining <= threshold;
  return (
    <span
      className={`${styles.badge} ${low ? styles.low : styles.ok}`}
      role="status"
    >
      {low
        ? `Quedan ${plural(remaining, 'boleto')}`
        : `${count(remaining)} ${label}`}
    </span>
  );
}
