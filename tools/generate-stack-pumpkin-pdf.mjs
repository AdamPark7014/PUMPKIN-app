/**
 * Genera docs/Stack-Pumpkin.pdf - stack + gaps del evento Pumpkin Zone.
 * Uso: node tools/generate-stack-pumpkin-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const PDFDocument = require('pdfkit');
const outPath = path.join(root, 'docs', 'Stack-Pumpkin.pdf');

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: 48, bottom: 48, left: 54, right: 54 },
  info: {
    Title: 'Stack Pumpkin Zone - BOLETERA',
    Author: 'boletera-platform',
    Subject: 'Stack técnico y gaps del evento Pumpkin Zone 2026',
    CreationDate: new Date(),
  },
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const ink = '#1a1a1a';
const muted = '#555555';
const accent = '#c45c26';
const ok = '#1b6b3a';
const warn = '#8a5a00';
const bad = '#8b1e1e';

function ensureSpace(needed = 72) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function h1(text) {
  ensureSpace(40);
  doc.moveDown(0.3);
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(18).text(text);
  doc.moveDown(0.35);
  doc.fillColor(ink);
}

function h2(text) {
  ensureSpace(32);
  doc.moveDown(0.4);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text(text);
  doc.moveDown(0.25);
}

function p(text, opts = {}) {
  ensureSpace(28);
  doc
    .fillColor(opts.color || ink)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 10)
    .text(text, { align: opts.align || 'left', lineGap: 2 });
  doc.moveDown(0.2);
}

function bullet(text, color = ink) {
  ensureSpace(22);
  const x = doc.page.margins.left;
  const bulletX = x;
  const textX = x + 12;
  const maxW = doc.page.width - doc.page.margins.right - textX;
  doc.fillColor(color).font('Helvetica').fontSize(10);
  const y = doc.y;
  doc.text('•', bulletX, y, { width: 10, lineBreak: false });
  doc.text(text, textX, y, { width: maxW, lineGap: 1.5 });
  doc.moveDown(0.12);
}

function kv(key, value) {
  ensureSpace(18);
  const x = doc.page.margins.left;
  const keyW = 150;
  const valX = x + keyW;
  const maxW = doc.page.width - doc.page.margins.right - valX;
  const y = doc.y;
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text(key, x, y, {
    width: keyW - 8,
    lineBreak: false,
  });
  doc.fillColor(ink).font('Helvetica').fontSize(9).text(value, valX, y, {
    width: maxW,
    lineGap: 1,
  });
  doc.moveDown(0.08);
}

function hr() {
  ensureSpace(16);
  const y = doc.y + 4;
  doc
    .strokeColor('#dddddd')
    .lineWidth(1)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.moveDown(0.6);
}

function gapRow(id, title, impact) {
  ensureSpace(36);
  doc.fillColor(bad).font('Helvetica-Bold').fontSize(10).text(`${id} - ${title}`);
  doc.fillColor(muted).font('Helvetica').fontSize(9).text(impact, { lineGap: 1.5 });
  doc.moveDown(0.25);
}

// ── Cover ──────────────────────────────────────────────────────────────────
doc.fillColor(accent).font('Helvetica-Bold').fontSize(22).text('Stack Pumpkin Zone');
doc.moveDown(0.2);
doc
  .fillColor(ink)
  .font('Helvetica-Bold')
  .fontSize(12)
  .text('Evento único sobre Boletera Platform (BOLETERA-app)');
doc.moveDown(0.35);
p(
  'Documento generado el 20 ago 2026 a partir del monorepo en C:\\dev\\apps\\BOLETERA-app. ' +
    'Cruza código verificado (package.json, deploy, payments, seed, storefront) con la ' +
    'documentación canónica en docs/ y marca lo que falta para operar el evento.',
  { size: 9.5, color: muted },
);
hr();

h2('Qué es este proyecto');
p(
  'Pumpkin Zone 2026 no es un repo aparte: es el despliegue de evento único de Boletera ' +
    '(tenant slug pumpkin-zone) con storefront temático, seed dedicado y compose de ' +
    'producción detrás de Traefik en experiencebt.com.mx.',
);
kv('Repo / producto base', 'boletera-platform  |  C:\\dev\\apps\\BOLETERA-app');
kv('Tenant', 'pumpkin-zone (DEMO_TENANT_SLUG)');
kv('Evento', 'pumpkin-zone-2026  |  Downtown Lomas de Angelópolis, Puebla');
kv('Storefront prod', 'https://pumpkin.experiencebt.com.mx');
kv('Admin prod', 'https://app.experiencebt.com.mx');
kv('API prod', 'https://pumpkin.experiencebt.com.mx/api (PathPrefix /api)');
kv('Compose prod', 'deploy/pumpkin-compose.yml');
kv('Seed', 'packages/database/scripts/seed-pumpkin.ts');

hr();
h1('1. Stack completo (verificado)');

h2('Runtime y monorepo');
bullet('Node >= 22  |  pnpm 10.30.3  |  Turborepo ^2.9');
bullet('Workspaces: apps/* + packages/*');
bullet('TypeScript estricto en apps y packages');

h2('Apps');
bullet('apps/api - NestJS 11  |  puerto 4000  |  prefijo /api/v1  |  Swagger /api/docs  |  ~32 módulos');
bullet('apps/web - Next.js 16 + React 19  |  storefront comprador  |  :3000 (Pumpkin UI)');
bullet('apps/admin - Next.js 16 + React 19 + TanStack Query v5  |  panel ops  |  :3001');
bullet('apps/taquilla - Next.js 16  |  POS físico  |  :3002');
bullet('apps/worker - Node/tsx + Bull  |  expira holds, reconcilia pagos / schedule');

h2('Packages (@boletera/*)');
bullet('database - Prisma 6 + PostgreSQL schema + seed / seed-pumpkin');
bullet('shared - tipos, dinero MXN, locale es-MX, contratos');
bullet('ui - design system React + Sass (+ PumpkinMark)');
bullet('venue-engine - mapas de asientos WebGL2 / Canvas2D');
bullet('venue-3d - visor Three.js / React Three Fiber');
bullet('payments - Banorte + Cash + Mercado Pago (Checkout Pro)');
bullet('crypto - QR firmado HMAC de boletos');
bullet('validators - Zod (package presente; sin consumidores workspace hoy)');

h2('Datos e infra local');
bullet('PostgreSQL 16 (Compose host :5434 -> 5432)');
bullet('Redis 7 - holds de inventario + colas Bull');
bullet('Docker Compose raíz: postgres, redis, api, web, admin');
bullet('Observabilidad opcional: OTel + Prometheus + Grafana + Loki + Tempo (infra/observability)');
bullet('CI: GitHub Actions (typecheck, lint, test, build)  |  E2E Playwright');

h2('Auth, realtime, pagos, fiscal');
bullet('Auth: Passport JWT + bcrypt  |  cookies httpOnly (ADR-0003)');
bullet('Realtime inventario/reporting: SSE (ADR-0008), no WebSockets');
bullet('Pagos online Pumpkin: Mercado Pago si hay MP_ACCESS_TOKEN; si no, Banorte/demo');
bullet('Taquilla: Cash provider');
bullet('CFDI 4.0: sandbox (plataforma); no es el bloqueador actual de Pumpkin');
bullet('Rate limit API: Throttler 120 req / 60 s (vars RATE_LIMIT_* en .env sin efecto)');

h2('Producción Pumpkin (compose)');
bullet('Contenedores: pumpkin-db, pumpkin-redis, pumpkin-api, pumpkin-web, pumpkin-admin');
bullet('Worker: profile with-worker (misma image pumpkin-api, comando dist/worker/main.js)');
bullet('Traefik v2.11 red externa proxy  |  TLS letsencrypt');
bullet('Imágenes: pumpkin-api / pumpkin-web / pumpkin-admin :latest');

hr();
h1('2. Flujo que ya funciona (spine)');
p(
  'Inventario -> hold -> orden -> pago -> boleto con QR -> escaneo en puerta. ' +
    'Documentado en README y docs/dominio/ciclo-de-vida.md; verificado en código.',
);
bullet('Seed Pumpkin: org, venue, evento GA LIVE, oferta General $50 / aforo 8000, admin + taquilla');
bullet('Storefront /boletos lee discovery + payments/config; solo vende si gateway=MERCADOPAGO');
bullet('Webhook MP: POST /api/v1/payments/webhooks/mercadopago');
bullet('Guía operativa: docs/ACTIVAR-MERCADO-PAGO.md');

hr();
h1('3. Qué le falta (prioridad evento)');

h2('Bloqueadores para vender mañana');
gapRow(
  'P-MP',
  'Credenciales Mercado Pago en producción',
  'Sin MP_ACCESS_TOKEN + MP_WEBHOOK_SECRET en /opt/pumpkin/.env, /boletos muestra ' +
    '"La venta en línea abre muy pronto". Código listo; falta cuenta empresa + webhook.',
);
gapRow(
  'P-DATA',
  'Fechas y precio 2026 sin confirmar',
  'event-config.ts y seed-pumpkin.ts marcan TODO(confirmar): fechas 29 oct-2 nov y $50 ' +
    'son patrón 2025. Publicar sin confirmar anuncia datos falsos.',
);
gapRow(
  'P-SEED-SEC',
  'Credenciales seed por defecto',
  'Password inicial PumpkinZone.2026 y PIN gerente 4826 - cambiar el primer día de ops.',
);

h2('Gaps de plataforma (afectan Pumpkin en escala / ops)');
gapRow(
  'P-01',
  'Sin manifiestos Kubernetes / HPA / PDB',
  'Deploy = Compose manual en VPS; no hay kubectl apply reproducible.',
);
gapRow(
  'P-02/03',
  'Sin PgBouncer ni connection_limit Prisma',
  'Escalar API horizontalmente arriesga agotar max_connections de Postgres.',
);
gapRow(
  'P-04',
  'Sin waiting room / cola de admisión',
  'On-sale masivo solo tiene rate limit + capacidad; no admisión justa en edge.',
);
gapRow(
  'P-05',
  'Sin kill-switch HTTP "pause sales"',
  'Mitigación vía scale-down / flags externos; no endpoint dedicado verificado.',
);
gapRow(
  'P-06',
  'Observabilidad no cableada al deploy Pumpkin',
  'Stack OTel/Grafana existe en repo pero el compose de Pumpkin no lo incluye.',
);
gapRow(
  'P-WORKER',
  'Worker opcional en prod (profile)',
  'pumpkin-compose.yml pone worker bajo profiles: [with-worker]. Confirmar si corre en el VPS.',
);
gapRow(
  'P-TAQ',
  'Taquilla no en compose Pumpkin',
  'App taquilla existe en monorepo (:3002) pero no está publicada en deploy/pumpkin-compose.yml.',
);

h2('Deuda técnica documentada (docs/arquitectura.md sec 9-10)');
bullet('Docs viejas (ROADMAP, ACTION_PLAN, CONTINUATION_PATHS) aún hablan de Stripe - código real: Banorte + MP');
bullet('@boletera/validators huérfano  |  @nestjs/typeorm sin uso  |  enums PaymentGateway aspiracionales');
bullet('Cart / Wishlist / Review: schema+seed, sin API');
bullet('Fraud "ML": heurísticas; KYC/AML stub');
bullet('React Query divergente: web v3 vs admin v5');
bullet('Aislamiento multi-tenant por disciplina de código (sin RLS Postgres)');
bullet('.env.example DATABASE_URL :5432 vs Compose host :5434');
bullet('DIRECT_DATABASE_URL documentado, no cableado en schema Prisma');

hr();
h1('4. Documentación: qué usar / qué ignorar');

h2('Canónica (verificar contra código)');
bullet('README.md  |  docs/README.md  |  docs/arquitectura.md');
bullet('docs/dominio/*  |  docs/adr/*  |  docs/guias/*  |  docs/api/*');
bullet('docs/ACTIVAR-MERCADO-PAGO.md  |  docs/ENV-SECRETS.md');
bullet('infra/runbooks/00-hallazgos-y-pendientes.md (P-01...P-10)');
bullet('deploy/pumpkin-compose.yml  |  packages/database/scripts/seed-pumpkin.ts');
bullet('apps/web/lib/event-config.ts (única fuente del home Pumpkin)');

h2('Obsoleta o aspiracional (no guiarse para Pumpkin)');
bullet('ROADMAP.md / ACTION_PLAN_IMMEDIATE.md / CONTINUATION_PATHS.md - Stripe, % inventados, frontend "por hacer"');
bullet('ENTERPRISE_SPECIFICATION.md / COMPETITIVE_ARCHITECTURE.md - visión, no estado real');
bullet('docs/ARCHITECTURE.md - reemplazado por docs/arquitectura.md');
bullet('Menciones Stripe en docs antiguas - ignorar en operación');

hr();
h1('5. Arranque local (dev)');
p('Requisitos: Node >= 22, pnpm >= 10.30.3, Docker Desktop.', { size: 9.5, color: muted });
bullet('pnpm install');
bullet('docker compose up -d postgres redis');
bullet('Copy-Item .env.example .env  -> DATABASE_URL puerto 5434  |  JWT_SECRET  |  DEMO_TENANT_SLUG=pumpkin-zone');
bullet('pnpm db:generate && pnpm db:migrate:dev');
bullet('pnpm --filter @boletera/database exec tsx scripts/seed-pumpkin.ts');
bullet('pnpm dev   (o dev:api / dev:web / dev:admin / ...)');
bullet('Web http://localhost:3000  |  Admin :3001  |  API http://localhost:4000/api/v1  |  Swagger /api/docs');
bullet('Para probar compra online local: MP_ACCESS_TOKEN=TEST-... + MP_WEBHOOK_SECRET');

hr();
h1('6. Checklist operativo Pumpkin');
bullet('[ ] Confirmar fechas, horario, precio y aforo 2026 (event-config + seed)');
bullet('[ ] Crear app Mercado Pago "Pumpkin Zone Boletos" (Checkout Pro)');
bullet('[ ] Registrar webhook payments -> .../api/v1/payments/webhooks/mercadopago');
bullet('[ ] Poner MP_ACCESS_TOKEN + MP_WEBHOOK_SECRET en VPS /opt/pumpkin/.env');
bullet('[ ] docker compose up -d api  |  curl payments/config -> gateway MERCADOPAGO');
bullet('[ ] Compra de prueba $50  |  correo con QR  |  reembolso de prueba');
bullet('[ ] Rotar password seed y PIN de gerente');
bullet('[ ] Confirmar si worker profile with-worker está activo');
bullet('[ ] Decidir si taquilla se publica (imagen + Traefik) o solo admin');
bullet('[ ] Fotos reales en public/pumpkin/ si se dejan de usar SVG de escena');

hr();
h1('7. Versión corta (para pegar)');
p(
  'Pumpkin Zone = Boletera Platform en modo evento único (tenant pumpkin-zone). ' +
    'Monorepo pnpm + Turborepo: NestJS 11 API + Prisma 6/Postgres 16 + Redis/Bull + ' +
    'Next.js 16/React 19 (web, admin, taquilla) + venue WebGL2/Three.js. ' +
    'Prod: Docker Compose + Traefik en pumpkin.experiencebt.com.mx / app.experiencebt.com.mx. ' +
    'Pagos online: Mercado Pago Checkout Pro (bloqueado hasta credenciales). ' +
    'Falta confirmar datos 2026, activar MP, rotar secretos seed, y decidir worker/taquilla en prod. ' +
    'Ignorar docs antiguas de Stripe.',
  { size: 9.5 },
);

hr();
doc
  .fillColor(muted)
  .font('Helvetica')
  .fontSize(8)
  .text(
    'Generado desde boletera-platform  |  tools/generate-stack-pumpkin-pdf.mjs  |  ' +
      'stack y gaps verificados contra código y docs canónicas (20 ago 2026). ' +
      'PDF hermano genérico: docs/Stack-BOLETERA.pdf',
  );

doc.end();

await new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});

console.log(`Wrote ${outPath}`);
