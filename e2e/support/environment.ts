export const environment = {
  apiUrl: process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1',
  webUrl: process.env.WEB_URL ?? 'http://127.0.0.1:3010',
  adminUrl: process.env.ADMIN_URL ?? 'http://127.0.0.1:3001',
  taquillaUrl: process.env.TAQUILLA_URL ?? 'http://127.0.0.1:3002',
  password: process.env.E2E_PASSWORD ?? 'Admin123!',
  performance: {
    documentLoadMs: Number(process.env.E2E_DOCUMENT_LOAD_BUDGET_MS ?? 3_000),
    largestContentfulPaintMs: Number(process.env.E2E_LCP_BUDGET_MS ?? 4_000),
  },
} as const;

export const seedUsers = {
  superAdmin: { email: 'admin@demo.boletera.com', role: 'SUPER_ADMIN' },
  ocesaAdmin: { email: 'admin@ocesa-demo.mx', role: 'ADMIN' },
  cieAdmin: { email: 'admin@cie-demo.mx', role: 'ADMIN' },
  cashier: { email: 'taquilla@demo.boletera.com', role: 'TAQUILLA' },
  scanner: { email: 'scanner@demo.boletera.com', role: 'SCANNER' },
  customer: { email: 'cliente@demo.boletera.com', role: 'CUSTOMER' },
} as const;

export type SeedUser = (typeof seedUsers)[keyof typeof seedUsers];

export function uniqueTestId(prefix: string, workerIndex: number): string {
  return `${prefix}-w${workerIndex}-${crypto.randomUUID()}`;
}
