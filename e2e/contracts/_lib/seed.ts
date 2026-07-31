/**
 * Deterministic seed references (mirrors packages/database SeedRng.id).
 * IDs are stable for a given namespace+key — no dependency on listing order.
 */

export function seedId(ns: string, key: string | number): string {
  const keyPart = String(key)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 48);
  let h = 2166136261;
  const raw = `${ns}:${key}`;
  for (let i = 0; i < raw.length; i++) {
    h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  }
  const suffix = (h >>> 0).toString(36);
  return `${ns}_${keyPart}_${suffix}`.slice(0, 64);
}

export const seedOrgs = {
  platform: {
    slug: 'boletera-plataforma',
    id: seedId('org', 'boletera-plataforma'),
  },
  ocesa: {
    slug: 'ocesa-live',
    id: seedId('org', 'ocesa-live'),
  },
  cie: {
    slug: 'cie-espectaculos',
    id: seedId('org', 'cie-espectaculos'),
  },
  teatro: {
    slug: 'teatro-nacional-mx',
    id: seedId('org', 'teatro-nacional-mx'),
  },
} as const;

/** Public on-sale event owned by platform org — used for inventory/order flows. */
export const seedEvents = {
  conciertoDemo: {
    slug: 'concierto-demo-2026',
    id: seedId('evt', 'concierto-demo-2026'),
    orgId: seedOrgs.platform.id,
  },
  nocheIndie: {
    slug: 'noche-indie-cdmx-live',
    id: seedId('evt', 'noche-indie-cdmx-live'),
    orgId: seedOrgs.ocesa.id,
  },
  comediaAbierta: {
    slug: 'comedia-abierta-cdmx',
    id: seedId('evt', 'comedia-abierta-cdmx'),
    orgId: seedOrgs.platform.id,
  },
} as const;

/** Wide range covering seeded sales (SEED_NOW ≈ 2026-07-30). */
export const metricsRange = {
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-12-31T00:00:00.000Z',
} as const;

export const METRICS_PATHS = [
  'executive',
  'events/sales-pace',
  'inventory',
  'orders',
  'access',
  'resale',
  'waitlist',
  'campaigns',
  'fraud',
  'settlements',
  'timeseries',
  'alerts',
] as const;

export type MetricsPath = (typeof METRICS_PATHS)[number];
