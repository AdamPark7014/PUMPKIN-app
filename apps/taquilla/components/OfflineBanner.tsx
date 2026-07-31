'use client';

import { useMemo } from 'react';
import styles from './OfflineBanner.module.scss';

export interface OfflineBannerProps {
  /** `false` = sin red / API inalcanzable. */
  online: boolean;
  /** Ventas pendientes en la cola IndexedDB. */
  pendingCount: number;
  /** Reintentar sync (típicamente `flushQueue`). */
  onRetry?: () => void;
  /** Deshabilita el botón mientras corre un flush. */
  retrying?: boolean;
  /** Texto opcional del botón principal. */
  retryLabel?: string;
  /** Acción secundaria (p. ej. ver detalle de cola). */
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  /** Mensaje adicional (edad de la venta más vieja, último error, etc.). */
  detail?: string;
  /** Clase CSS extra en el contenedor. */
  className?: string;
  /**
   * Si es `true`, el banner se oculta cuando hay red y no hay pendientes.
   * Default `true`.
   */
  hideWhenClear?: boolean;
}

function pluralVentas(n: number): string {
  return n === 1 ? '1 venta pendiente' : `${n} ventas pendientes`;
}

/**
 * Banner de alto contraste para estado offline / cola pendiente.
 * Usa `aria-live="polite"` para anunciar cambios a lectores de pantalla.
 */
export function OfflineBanner({
  online,
  pendingCount,
  onRetry,
  retrying = false,
  retryLabel,
  onSecondaryAction,
  secondaryLabel = 'Ver cola',
  detail,
  className,
  hideWhenClear = true,
}: OfflineBannerProps) {
  const pending = Math.max(0, Math.floor(pendingCount));
  const clear = online && pending === 0;

  const toneClass = useMemo(() => {
    if (!online) return styles.bannerOffline;
    if (pending > 0) return styles.bannerPending;
    return styles.bannerDegraded;
  }, [online, pending]);

  const title = useMemo(() => {
    if (!online && pending > 0) return 'Sin conexión — ventas en cola';
    if (!online) return 'Sin conexión';
    if (pending > 0) return 'Hay ventas por sincronizar';
    return 'Conexión inestable';
  }, [online, pending]);

  const body = useMemo(() => {
    const parts: string[] = [];
    if (!online) {
      parts.push('La terminal seguirá vendiendo; las ventas se enviarán al recuperar la red.');
    } else if (pending > 0) {
      parts.push('La red está disponible. Reintenta para enviar las ventas pendientes.');
    }
    if (pending > 0) parts.push(pluralVentas(pending));
    if (detail?.trim()) parts.push(detail.trim());
    return parts.join(' ');
  }, [online, pending, detail]);

  const liveMessage = useMemo(() => {
    if (clear) return 'Conexión restablecida. No hay ventas pendientes.';
    return `${title}. ${body}`;
  }, [clear, title, body]);

  if (hideWhenClear && clear) return null;

  const resolvedRetryLabel =
    retryLabel ?? (retrying ? 'Sincronizando…' : pending > 0 ? 'Reintentar ahora' : 'Comprobar red');

  return (
    <div
      className={[styles.banner, toneClass, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-online={online ? 'true' : 'false'}
      data-pending={String(pending)}
    >
      <div className={styles.main}>
        <span className={styles.icon} aria-hidden="true">
          {!online ? '⚠' : pending > 0 ? '⬆' : '⟳'}
        </span>
        <div className={styles.copy}>
          <p className={styles.title}>{title}</p>
          <p className={styles.detail}>{body}</p>
        </div>
      </div>

      {(onRetry || onSecondaryAction) && (
        <div className={styles.actions}>
          {onSecondaryAction && (
            <button
              type="button"
              className={styles.secondary}
              onClick={onSecondaryAction}
              disabled={retrying}
            >
              {secondaryLabel}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              className={styles.retry}
              onClick={onRetry}
              disabled={retrying}
              aria-busy={retrying || undefined}
            >
              {resolvedRetryLabel}
            </button>
          )}
        </div>
      )}

      <span className={styles.srOnly}>{liveMessage}</span>
    </div>
  );
}
