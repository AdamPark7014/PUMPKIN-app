/**
 * Detección de conectividad para taquilla.
 *
 * `navigator.onLine` sólo es confiable en negativo: `false` garantiza que no hay red,
 * pero `true` únicamente indica que hay una interfaz activa (puede haber portal cautivo,
 * VPN caída o API apagada). Por eso combinamos el evento del navegador con un heartbeat
 * suave contra la API. Cualquier respuesta HTTP (incluso 401/404) cuenta como "alcanzable".
 */

import { getApiBase } from '@/lib/auth';

export type ConnectivitySource = 'initial' | 'navigator' | 'probe' | 'manual';

export interface ConnectivityStatus {
  /** Mejor estimación actual de conectividad con la API. */
  readonly online: boolean;
  /** Qué señal produjo el estado vigente. */
  readonly source: ConnectivitySource;
  /** ISO del último cambio de `online`. */
  readonly changedAt: string;
  /** ISO del último sondeo terminado, o `null` si nunca se sondeó. */
  readonly lastProbeAt: string | null;
  /** Resultado del último sondeo, o `null` si nunca se sondeó. */
  readonly lastProbeOk: boolean | null;
}

export interface ProbeOptions {
  /** Ruta relativa a la base de la API. Default `/health`. */
  path?: string;
  /** Corte del sondeo en milisegundos. Default 4000. */
  timeoutMs?: number;
  /** Señal externa para cancelar (p. ej. desmontaje de componente). */
  signal?: AbortSignal;
}

export interface HeartbeatOptions extends ProbeOptions {
  /** Periodo entre sondeos. Default 20000. */
  intervalMs?: number;
  /** No sondear si `navigator.onLine` ya es `false`. Default `true`. */
  skipWhenNavigatorOffline?: boolean;
  /** No sondear con la pestaña oculta. Default `true`. */
  skipWhenHidden?: boolean;
}

const DEFAULT_PROBE_PATH = '/health';
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_INTERVAL_MS = 20_000;

type Listener = (status: ConnectivityStatus) => void;

const listeners = new Set<Listener>();

/** Snapshot estable: sólo se reemplaza cuando algo cambia (requisito de useSyncExternalStore). */
let status: ConnectivityStatus = {
  online: true,
  source: 'initial',
  changedAt: new Date(0).toISOString(),
  lastProbeAt: null,
  lastProbeOk: null,
};

/** Snapshot congelado para SSR: idéntico entre llamadas para no romper la hidratación. */
const SERVER_STATUS: ConnectivityStatus = status;

let browserListenersAttached = false;

export function isNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // Algunos navegadores embebidos de terminales POS no implementan la propiedad.
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

export function getOnlineStatus(): ConnectivityStatus {
  return status;
}

export function getServerOnlineStatus(): ConnectivityStatus {
  return SERVER_STATUS;
}

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener(status);
    } catch {
      // Un suscriptor roto no debe tumbar la cadena de notificación del POS.
    }
  }
}

function applyStatus(
  next: { online: boolean; source: ConnectivitySource },
  probe?: { at: string; ok: boolean },
): void {
  const onlineChanged = next.online !== status.online;
  const probeChanged = probe !== undefined;
  if (!onlineChanged && !probeChanged) return;

  status = {
    online: next.online,
    source: onlineChanged || probeChanged ? next.source : status.source,
    changedAt: onlineChanged ? new Date().toISOString() : status.changedAt,
    lastProbeAt: probe ? probe.at : status.lastProbeAt,
    lastProbeOk: probe ? probe.ok : status.lastProbeOk,
  };
  emit();
}

/** Fuerza el estado (p. ej. tras un fallo de red al enviar una venta). */
export function setOnlineStatus(online: boolean, source: ConnectivitySource = 'manual'): void {
  applyStatus({ online, source });
}

function handleNavigatorOnline(): void {
  applyStatus({ online: true, source: 'navigator' });
  // `online` del navegador es optimista: confirmamos contra la API sin bloquear.
  void probeConnectivity().catch(() => undefined);
}

function handleNavigatorOffline(): void {
  applyStatus({ online: false, source: 'navigator' });
}

function attachBrowserListeners(): void {
  if (browserListenersAttached || typeof window === 'undefined') return;
  browserListenersAttached = true;
  window.addEventListener('online', handleNavigatorOnline);
  window.addEventListener('offline', handleNavigatorOffline);
  applyStatus({ online: isNavigatorOnline(), source: 'navigator' });
}

function detachBrowserListeners(): void {
  if (!browserListenersAttached || typeof window === 'undefined') return;
  browserListenersAttached = false;
  window.removeEventListener('online', handleNavigatorOnline);
  window.removeEventListener('offline', handleNavigatorOffline);
}

/**
 * Suscribe a cambios de conectividad. Devuelve la función de baja.
 * No invoca al listener de inmediato: usa `getOnlineStatus()` para el valor inicial.
 */
export function subscribeOnlineStatus(listener: Listener): () => void {
  listeners.add(listener);
  attachBrowserListeners();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && heartbeatRefCount === 0) detachBrowserListeners();
  };
}

/**
 * Sondeo suave contra la API. Cualquier respuesta HTTP cuenta como alcanzable;
 * sólo fallos de red o timeout marcan offline.
 */
export async function probeConnectivity(options: ProbeOptions = {}): Promise<boolean> {
  if (typeof fetch === 'undefined') return status.online;
  if (!isNavigatorOnline()) {
    applyStatus({ online: false, source: 'probe' }, { at: new Date().toISOString(), ok: false });
    return false;
  }

  const { path = DEFAULT_PROBE_PATH, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  let ok = false;
  try {
    const base = getApiBase();
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    ok = true;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  // Un aborto externo no es evidencia de falta de red: no movemos el estado.
  if (!ok && signal?.aborted) return status.online;

  applyStatus({ online: ok, source: 'probe' }, { at: new Date().toISOString(), ok });
  return ok;
}

let heartbeatRefCount = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatOptions: HeartbeatOptions = {};

function runHeartbeatTick(): void {
  const { skipWhenNavigatorOffline = true, skipWhenHidden = true } = heartbeatOptions;
  if (skipWhenNavigatorOffline && !isNavigatorOnline()) {
    applyStatus({ online: false, source: 'navigator' });
    return;
  }
  if (skipWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return;
  }
  void probeConnectivity(heartbeatOptions).catch(() => undefined);
}

/**
 * Arranca (o se engancha a) el heartbeat compartido. Devuelve la función de paro;
 * el timer real se detiene cuando el último interesado se da de baja.
 */
export function startConnectivityHeartbeat(options: HeartbeatOptions = {}): () => void {
  if (typeof window === 'undefined') return () => undefined;

  attachBrowserListeners();
  if (heartbeatRefCount === 0) {
    heartbeatOptions = options;
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    heartbeatTimer = setInterval(runHeartbeatTick, intervalMs);
    runHeartbeatTick();
  }
  heartbeatRefCount += 1;

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    heartbeatRefCount = Math.max(0, heartbeatRefCount - 1);
    if (heartbeatRefCount === 0) {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      heartbeatOptions = {};
      if (listeners.size === 0) detachBrowserListeners();
    }
  };
}
