/**
 * Configuración de Mercado Pago (Checkout Pro).
 *
 * Se activa con MP_ACCESS_TOKEN. Sin el token, `isConfigured` es false y la
 * API sigue usando la ruta Banorte (demo en desarrollo). Así el despliegue
 * no depende de tener credenciales: el día que lleguen, se ponen en el .env
 * y se reinicia la API.
 *
 * Variables:
 *   MP_ACCESS_TOKEN     Access token del vendedor (APP_USR-… en producción,
 *                       TEST-… para pruebas). Obligatorio para activar.
 *   MP_WEBHOOK_SECRET   Clave secreta del webhook (panel MP → Webhooks).
 *                       Si está, se valida x-signature; en producción es
 *                       obligatoria.
 *   WEB_PUBLIC_URL      Base pública del storefront para las back_urls.
 *                       Cae a BANORTE_RETURN_URL por compatibilidad.
 *   API_PUBLIC_URL      Base pública de la API para notification_url.
 *   MP_STATEMENT        Texto en el estado de cuenta (máx. 16 chars).
 */
export type MercadoPagoConfig = {
  accessToken: string;
  webhookSecret: string;
  webUrl: string;
  apiUrl: string;
  statementDescriptor: string;
  isConfigured: boolean;
  isTest: boolean;
};

export function getMercadoPagoConfig(): MercadoPagoConfig {
  const accessToken = (process.env.MP_ACCESS_TOKEN ?? '').trim();
  const webUrl = (
    process.env.WEB_PUBLIC_URL ||
    process.env.BANORTE_RETURN_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const apiUrl = (
    process.env.API_PUBLIC_URL ||
    process.env.API_URL ||
    'http://localhost:4000'
  ).replace(/\/$/, '');

  return {
    accessToken,
    webhookSecret: (process.env.MP_WEBHOOK_SECRET ?? '').trim(),
    webUrl,
    apiUrl,
    statementDescriptor: (process.env.MP_STATEMENT ?? 'PUMPKIN ZONE').slice(0, 16),
    isConfigured: accessToken.length > 0,
    isTest: accessToken.startsWith('TEST-'),
  };
}

export function isMercadoPagoConfigured(): boolean {
  return getMercadoPagoConfig().isConfigured;
}

export function validateMercadoPagoProductionConfig(): {
  ready: boolean;
  missing: string[];
  warnings: string[];
} {
  const cfg = getMercadoPagoConfig();
  const isProd = process.env.NODE_ENV === 'production';
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!cfg.accessToken) missing.push('MP_ACCESS_TOKEN');
  if (!cfg.webhookSecret) {
    if (isProd) missing.push('MP_WEBHOOK_SECRET');
    else warnings.push('MP_WEBHOOK_SECRET (obligatorio en producción)');
  }
  if (cfg.isTest && isProd) warnings.push('MP_ACCESS_TOKEN es de prueba (TEST-) en producción');
  if (/localhost|127\.0\.0\.1/.test(cfg.webUrl)) warnings.push('WEB_PUBLIC_URL apunta a localhost');
  if (/localhost|127\.0\.0\.1/.test(cfg.apiUrl)) warnings.push('API_PUBLIC_URL apunta a localhost (el webhook no llegará)');

  return { ready: missing.length === 0, missing, warnings };
}
