/**
 * Genera docs/Manual-Mercado-Pago-Credenciales.pdf
 * Uso: node tools/generate-mp-credentials-manual-pdf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const PDFDocument = require('pdfkit');
const outPath = path.join(root, 'docs', 'Manual-Mercado-Pago-Credenciales.pdf');

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: 50, bottom: 50, left: 54, right: 54 },
  info: {
    Title: 'Manual Mercado Pago - Credenciales y Point (Pumpkin)',
    Author: 'boletera-platform',
    Subject: 'Como obtener Access Token, webhooks y preparar terminales Point',
    CreationDate: new Date(),
  },
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

const ink = '#1a1a1a';
const muted = '#555555';
const accent = '#009ee3';
const warn = '#8a5a00';
const bad = '#8b1e1e';

function ensureSpace(n = 64) {
  if (doc.y + n > doc.page.height - doc.page.margins.bottom) doc.addPage();
}
function h1(t) {
  ensureSpace(36);
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(16).text(t);
  doc.moveDown(0.35);
  doc.fillColor(ink);
}
function h2(t) {
  ensureSpace(28);
  doc.moveDown(0.25);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text(t);
  doc.moveDown(0.2);
}
function p(t, opts = {}) {
  ensureSpace(22);
  doc
    .fillColor(opts.color || ink)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 9.5)
    .text(t, { lineGap: 1.8 });
  doc.moveDown(0.15);
}
function bullet(t, color = ink) {
  ensureSpace(18);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.fillColor(color).font('Helvetica').fontSize(9.5);
  doc.text('-', x, y, { width: 10, lineBreak: false });
  doc.text(t, x + 12, y, {
    width: doc.page.width - doc.page.margins.right - x - 12,
    lineGap: 1.4,
  });
  doc.moveDown(0.08);
}
function step(n, title, body) {
  ensureSpace(40);
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10).text(`Paso ${n}. ${title}`);
  doc.fillColor(ink).font('Helvetica').fontSize(9.5).text(body, { lineGap: 1.6 });
  doc.moveDown(0.25);
}

doc.fillColor(accent).font('Helvetica-Bold').fontSize(18).text('Manual Mercado Pago');
doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('Credenciales (Access Token) + Webhooks + Point');
doc.moveDown(0.2);
p(
  'Pumpkin Zone / Boletera Platform · Mexico · Generado 20 ago 2026. Basado en documentacion oficial de Mercado Pago Developers (credentials, application-details, mp-point).',
  { size: 8.5, color: muted },
);
p(
  'IMPORTANTE: No hay una "API key" generica. Lo que necesitas en el backend es el Access Token de produccion (APP_USR-...). La Public Key es solo para frontend. El secret del webhook es OTRO valor distinto.',
  { bold: true, size: 9.5, color: warn },
);

h1('1. Antes de empezar');
bullet('Cuenta Mercado Pago de la EMPRESA (no personal del desarrollador si se puede evitar).');
bullet('RFC / Constancia de Situacion Fiscal listos para liquidar y ampliar limites.');
bullet('URL publica del sitio: https://pumpkin.experiencebt.com.mx');
bullet('Acceso SSH al VPS (/opt/pumpkin/.env) para pegar secrets.');
bullet('Panel: https://www.mercadopago.com.mx/developers/panel/app');

h1('2. Crear la aplicacion');
step(
  1,
  'Entrar a Tus integraciones',
  'En Mercado Pago Developers, Ingresar con la cuenta vendedor. Clic en "Tus integraciones" (esquina superior derecha).',
);
step(
  2,
  'Crear aplicacion',
  'Nombre sugerido: Pumpkin Zone Boletos. En productos, marca pagos ONLINE (Checkout Pro) y pagos PRESENCIALES (Point) si vas a comprar terminales. Asi un solo Access Token sirve para web y Point.',
);
step(
  3,
  'Editar datos de la app',
  'Industria: entretenimiento / eventos / tickets (la opcion mas cercana). Website produccion: https://pumpkin.experiencebt.com.mx',
);

h1('3. Obtener el Access Token (lo que la gente llama "API key")');
step(
  4,
  'Credenciales de prueba (opcional)',
  'Menu izquierdo > Pruebas > Credenciales de prueba. Access Token empieza con TEST-... Sirve para ensayos. Ojo: pagos TEST no disparan webhooks reales; usa el simulador del panel.',
);
step(
  5,
  'Activar credenciales de produccion',
  'Menu > Produccion > Credenciales de produccion. Completa Industria + Sitio web (obligatorio), acepta T&C y reCAPTCHA, clic Activar. Luego copia: Public Key (APP_USR-... public) y Access Token (APP_USR-... privado).',
);
step(
  6,
  'Client ID / Client Secret',
  'Aparecen en el mismo panel. Solo los necesitas si usas OAuth (integrar a nombre de terceros). Para Pumpkin propio: basta Access Token en el servidor.',
);
p('NUNCA subas el Access Token a git, al frontend, ni a chats publicos.', {
  color: bad,
  bold: true,
});

h1('4. Configurar Webhooks');
step(
  7,
  'URL de notificaciones',
  'En la misma app > Webhooks / Notificaciones. URL de produccion:\nhttps://pumpkin.experiencebt.com.mx/api/v1/payments/webhooks/mercadopago\nDebe ser HTTPS (Traefik ya lo resuelve).',
);
step(
  8,
  'Eventos / topics',
  'Activa al menos: Payments (pagos online Checkout Pro). Si usas Point: tambien Order (Mercado Pago) — order.processed, canceled, failed, etc. Copia la clave secreta (webhook secret).',
);
step(
  9,
  'Simular notificacion',
  'Usa "Simular notificacion" en el panel. Tu API debe responder HTTP 200/201 en menos de ~22s. Si no, MP reintenta cada ~15 min.',
);

h1('5. Pegar secrets en el servidor Pumpkin');
p('En /opt/pumpkin/.env (plantilla deploy/pumpkin.env.example):');
bullet('MP_ACCESS_TOKEN=APP_USR-...   (produccion) o TEST-... (prueba)');
bullet('MP_WEBHOOK_SECRET=...       (clave de webhooks)');
bullet('WEB_PUBLIC_URL=https://pumpkin.experiencebt.com.mx');
bullet('API_PUBLIC_URL=https://pumpkin.experiencebt.com.mx');
bullet('MP_STATEMENT=PUMPKIN ZONE   (max 16 chars en estado de cuenta)');
bullet('MP_PENDING_TTL_HOURS=24     (hold OXXO/SPEI)');
bullet('SMTP_*                      (correo con QR de boletos)');
p('Luego: cd /opt/pumpkin && docker compose -f pumpkin-compose.yml up -d api');
p('Verificar: curl -s https://pumpkin.experiencebt.com.mx/api/v1/payments/config');
p('Debe mostrar gateway MERCADOPAGO. Entonces /boletos habilita la compra.');

h1('6. Terminales Point (compra e integracion)');
bullet('Compra Point Smart 1 o Smart 2 en la tienda oficial de Mercado Pago.');
bullet('Instala app Mercado Pago en el celular; vincula la terminal con la cuenta PRODUCCION (QR).');
bullet('Pon la terminal en modo PDV (punto de venta integrado). En Standalone la API crea ordenes pero la maquina las IGNORA — causa #1 de fallos.');
bullet('Lista terminales: GET https://api.mercadopago.com/terminals/v1/list con Bearer Access Token.');
bullet('Cobro integrado: POST /v1/orders con type=point, amount string "50.00", config.point.terminal_id, header X-Idempotency-Key.');
bullet('Resultado solo por webhook topic Order (order.processed), no por polling.');
p(
  'Estado en Boletera hoy: Checkout Pro online listo. Webhook ya acepta type=order (Point). Taquilla aun cobra CARD con voucher manual (last4+auth); falta boton "Cobrar en Point" que cree la orden API.',
  { color: warn },
);

h1('7. Checklist "integracion perfecta"');
bullet('[ ] RFC + liquidacion bancaria');
bullet('[ ] App creada con Online + In-person');
bullet('[ ] Access Token prod en VPS (no TEST)');
bullet('[ ] Webhook Payments + Order + secret');
bullet('[ ] payments/config = MERCADOPAGO');
bullet('[ ] Compra real $50 + correo QR + reembolso');
bullet('[ ] SMTP operativo');
bullet('[ ] Point en PDV + prueba order.processed');
bullet('[ ] Medicion de calidad MP (Integration Quality) tras 1er pago prod');
bullet('[ ] No renovar tokens sin actualizar .env el mismo dia');

h1('8. Errores frecuentes');
bullet('Usar Public Key donde va Access Token (o al reves).');
bullet('Confundir Access Token con webhook secret.');
bullet('Webhook en localhost / http.');
bullet('Terminal Standalone esperando cobros por API.');
bullet('Completar boleto en back_url success sin esperar webhook approved/processed.');

h1('9. Enlaces oficiales');
bullet('Credenciales: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/credentials');
bullet('Detalles app: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/application-details');
bullet('Checkout Pro: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview');
bullet('Point: https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview');
bullet('Checklist repo: docs/INTEGRACION-MP-CHECKLIST.md');
bullet('Research Point: docs/research/MERCADO-PAGO-POINT.md');
bullet('Activar 15 min: docs/ACTIVAR-MERCADO-PAGO.md');

doc.moveDown(0.5);
p(
  'Documento interno Pumpkin Zone · boletera-platform · tools/generate-mp-credentials-manual-pdf.mjs',
  { size: 8, color: muted },
);

doc.end();
await new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});
console.log(`Wrote ${outPath}`);
