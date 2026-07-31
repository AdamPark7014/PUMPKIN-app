'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker de shell offline (`/sw.js`).
 * Fallos silenciosos: en POS la venta no debe depender del SW.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (cancelled) return;
        // Pedir update en cada carga de turno: shell fresco tras deploy.
        void reg.update().catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
