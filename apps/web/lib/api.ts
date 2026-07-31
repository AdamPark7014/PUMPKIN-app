/**
 * Cliente HTTP del storefront.
 *
 * `api()` conserva su firma original (throw en error, sin caché) porque el
 * camino de compra depende de ella. Encima se añaden helpers para SSR
 * cacheado, lectura tolerante a fallos y errores tipados con mensaje legible.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000/api/v1';

type NestErrorBody = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

/** Error HTTP con estatus y mensaje ya legible para el comprador. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** 409/410/422: el estado del servidor cambió y reintentar igual no sirve. */
  get isConflict(): boolean {
    return this.status === 409 || this.status === 410 || this.status === 422;
  }

  /** 5xx y fallos de red: reintentar la misma petición es seguro. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const nest = body as NestErrorBody;
    if (Array.isArray(nest.message) && nest.message.length) return nest.message.join('. ');
    if (typeof nest.message === 'string' && nest.message.trim()) return nest.message.trim();
    if (typeof nest.error === 'string' && nest.error.trim()) return nest.error.trim();
  }
  return fallback;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    throw new ApiError(
      0,
      'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
      cause,
    );
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new ApiError(res.status, readErrorMessage(body, `Error ${res.status}`), body);
  }
  return body as T;
}

/**
 * Lectura/escritura sin caché contra la API. Lanza {@link ApiError}.
 * Es la única variante válida para inventario, holds, órdenes y pagos.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
}

/**
 * Lectura cacheada en el servidor para catálogo (cartelera, facetas, recintos).
 * Nunca usar para disponibilidad, precios finales ni órdenes.
 */
export async function apiCached<T>(
  path: string,
  revalidateSeconds: number,
  tags?: readonly string[],
): Promise<T> {
  return request<T>(path, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: revalidateSeconds, tags: tags ? [...tags] : undefined },
  });
}

/** Igual que {@link api} pero devuelve `null` en lugar de lanzar. */
export async function apiSafe<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    return await api<T>(path, init);
  } catch {
    return null;
  }
}

/** Igual que {@link apiCached} pero devuelve `null` en lugar de lanzar. */
export async function apiCachedSafe<T>(
  path: string,
  revalidateSeconds: number,
  tags?: readonly string[],
): Promise<T | null> {
  try {
    return await apiCached<T>(path, revalidateSeconds, tags);
  } catch {
    return null;
  }
}

/** Mensaje presentable para el comprador a partir de cualquier excepción. */
export function errorMessage(error: unknown, fallback = 'Algo salió mal. Inténtalo de nuevo.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

/** Ventanas de revalidación estándar del catálogo, en segundos. */
export const REVALIDATE = {
  /** Detalle de evento: precios base y metadatos. */
  event: 60,
  /** Listados de cartelera, categoría y ciudad. */
  listing: 120,
  /** Facetas y recintos: casi estáticos. */
  facets: 600,
} as const;
