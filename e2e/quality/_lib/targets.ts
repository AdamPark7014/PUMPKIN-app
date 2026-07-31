import { request as playwrightRequest } from '@playwright/test';
import { environment } from '../../support/environment';

export type AppKey = 'web' | 'admin' | 'taquilla';

export type ScreenId =
  | 'web:home'
  | 'web:login'
  | 'web:venues'
  | 'web:ciudades'
  | 'admin:login'
  | 'admin:dashboard'
  | 'admin:events'
  | 'admin:orders'
  | 'taquilla:login'
  | 'taquilla:home'
  | 'taquilla:eventos'
  | 'taquilla:buscar';

export type Screen = {
  /** Aplicación que sirve la pantalla. */
  readonly app: AppKey;
  /** Identificador estable usado en los títulos de test y en los adjuntos. */
  readonly id: ScreenId;
  /** Ruta relativa al origen de la aplicación. */
  readonly path: string;
  /** `true` cuando la pantalla exige sesión iniciada. */
  readonly auth: boolean;
};

export const appOrigins: Readonly<Record<AppKey, string>> = {
  web: environment.webUrl,
  admin: environment.adminUrl,
  taquilla: environment.taquillaUrl,
};

/**
 * Pantallas principales de cada aplicación. Se eligieron las rutas por las que
 * pasa todo el tráfico real: entrada pública, autenticación y los tableros de
 * trabajo diarios.
 */
export const screens: readonly Screen[] = [
  { app: 'web', id: 'web:home', path: '/', auth: false },
  { app: 'web', id: 'web:login', path: '/login', auth: false },
  { app: 'web', id: 'web:venues', path: '/venues', auth: false },
  { app: 'web', id: 'web:ciudades', path: '/ciudades', auth: false },
  { app: 'admin', id: 'admin:login', path: '/login', auth: false },
  { app: 'admin', id: 'admin:dashboard', path: '/dashboard', auth: true },
  { app: 'admin', id: 'admin:events', path: '/events', auth: true },
  { app: 'admin', id: 'admin:orders', path: '/orders', auth: true },
  { app: 'taquilla', id: 'taquilla:login', path: '/login', auth: false },
  { app: 'taquilla', id: 'taquilla:home', path: '/', auth: true },
  { app: 'taquilla', id: 'taquilla:eventos', path: '/eventos', auth: true },
  { app: 'taquilla', id: 'taquilla:buscar', path: '/buscar', auth: true },
];

export function screensOf(app: AppKey): readonly Screen[] {
  return screens.filter((screen) => screen.app === app);
}

export function screenUrl(screen: Screen): string {
  return new URL(screen.path, appOrigins[screen.app]).toString();
}

const probes = new Map<AppKey, Promise<boolean>>();

/**
 * Sondeo HTTP de una sola vez por worker. Cualquier respuesta (incluido 3xx o
 * 4xx) prueba que hay un servidor escuchando; sólo un fallo de transporte marca
 * la aplicación como caída.
 */
export function appIsUp(app: AppKey): Promise<boolean> {
  const cached = probes.get(app);
  if (cached) return cached;

  const probe = (async (): Promise<boolean> => {
    const context = await playwrightRequest.newContext({
      // Seguir redirects (admin `/` → `/login`); un 3xx con maxRedirects:0
      // lanza en algunos builds de Playwright y marcaba la app como caída.
      maxRedirects: 5,
    });
    try {
      const response = await context.get(appOrigins[app], {
        timeout: 10_000,
        failOnStatusCode: false,
      });
      return response.status() >= 200 && response.status() < 500;
    } catch {
      return false;
    } finally {
      await context.dispose();
    }
  })();

  probes.set(app, probe);
  return probe;
}

export function appDownMessage(app: AppKey): string {
  return `${app} no responde en ${appOrigins[app]} (exporta WEB_URL / ADMIN_URL / TAQUILLA_URL si usas otros puertos)`;
}
