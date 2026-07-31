import Link from 'next/link';
import styles from './PurchaseSteps.module.scss';

export type PurchaseStepId = 'cart' | 'checkout' | 'tickets';

const STEPS: readonly { id: PurchaseStepId; label: string; href: string }[] = [
  { id: 'cart', label: 'Carrito', href: '/cart' },
  { id: 'checkout', label: 'Pago', href: '/checkout' },
  { id: 'tickets', label: 'Boletos', href: '/cuenta' },
];

/**
 * Indicador de progreso del embudo. Los pasos ya completados son enlaces
 * (permiten volver sin perder el hold); el actual y los pendientes, no.
 */
export function PurchaseSteps({
  current,
  cartHref = '/cart',
}: {
  current: PurchaseStepId;
  /** Permite volver al carrito conservando parámetros de la reserva. */
  cartHref?: string;
}) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav className={styles.steps} aria-label="Progreso de compra">
      <ol>
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const href = step.id === 'cart' ? cartHref : step.href;
          const content = (
            <>
              <span className={styles.index} aria-hidden="true">
                {done ? '✓' : i + 1}
              </span>
              <span className={styles.label}>{step.label}</span>
            </>
          );
          return (
            <li
              key={step.id}
              className={done ? styles.done : active ? styles.active : styles.todo}
            >
              {done ? (
                <Link href={href}>{content}</Link>
              ) : (
                <span aria-current={active ? 'step' : undefined}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
