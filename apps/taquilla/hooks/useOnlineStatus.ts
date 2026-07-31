'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getOnlineStatus,
  getServerOnlineStatus,
  probeConnectivity,
  startConnectivityHeartbeat,
  subscribeOnlineStatus,
  type ConnectivityStatus,
} from '@/lib/connectivity';

export interface UseOnlineStatusOptions {
  /** Activa el sondeo periódico contra la API. Default `true`. */
  heartbeat?: boolean;
  /** Periodo del heartbeat en ms. Default 20000. */
  intervalMs?: number;
  /** Ruta del sondeo relativa a la base de la API. Default `/health`. */
  probePath?: string;
  /** Corte del sondeo en ms. Default 4000. */
  timeoutMs?: number;
}

export interface OnlineStatus extends ConnectivityStatus {
  /** Fuerza un sondeo inmediato y resuelve con el resultado. */
  refresh: () => Promise<boolean>;
}

/**
 * Estado de conectividad reactivo y compartido entre todos los componentes montados.
 * Seguro en SSR: durante el render de servidor reporta `online: true` para no
 * pintar el banner offline antes de hidratar.
 */
export function useOnlineStatus(options: UseOnlineStatusOptions = {}): OnlineStatus {
  const { heartbeat = true, intervalMs, probePath, timeoutMs } = options;

  const status = useSyncExternalStore(subscribeOnlineStatus, getOnlineStatus, getServerOnlineStatus);

  useEffect(() => {
    if (!heartbeat) return;
    return startConnectivityHeartbeat({ intervalMs, path: probePath, timeoutMs });
  }, [heartbeat, intervalMs, probePath, timeoutMs]);

  const refresh = useCallback(
    () => probeConnectivity({ path: probePath, timeoutMs }),
    [probePath, timeoutMs],
  );

  return { ...status, refresh };
}
