import { expect, type Page } from '@playwright/test';
import { environment, seedUsers } from '../../support/environment';
import type { AppKey } from './targets';

type LoginUser = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly organizationId: string | null;
  readonly firstName?: string;
  readonly lastName?: string;
};

type LoginBody = {
  readonly accessToken: string;
  readonly user: LoginUser;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLoginBody(body: Record<string, unknown>, email: string): LoginBody {
  if (typeof body.accessToken !== 'string' || !isRecord(body.user)) {
    throw new Error(`Respuesta de login malformada para ${email}`);
  }
  const user = body.user;
  const organizationId =
    typeof user.organizationId === 'string'
      ? user.organizationId
      : typeof user.organization_id === 'string'
        ? user.organization_id
        : null;
  const firstName = typeof user.firstName === 'string' ? user.firstName : undefined;
  const lastName = typeof user.lastName === 'string' ? user.lastName : undefined;
  return {
    accessToken: body.accessToken,
    user: {
      id: typeof user.id === 'string' ? user.id : '',
      email: typeof user.email === 'string' ? user.email : email,
      role: typeof user.role === 'string' ? user.role : 'USER',
      organizationId,
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
    },
  };
}

/**
 * Login vía `page.request` para que las cookies de refresh queden en el mismo
 * contexto del browser. Reintenta con `expect.poll` ante 429 del throttler de
 * auth (5 req / 60s) — sin sleeps fijos.
 */
async function loginViaApi(page: Page, email: string): Promise<LoginBody> {
  let lastStatus = 0;
  let session: LoginBody | null = null;

  await expect
    .poll(
      async () => {
        const response = await page.request.post(`${environment.apiUrl}/auth/login`, {
          data: { email, password: environment.password },
        });
        lastStatus = response.status();
        if (lastStatus === 429) return null;
        if (lastStatus !== 200 && lastStatus !== 201) {
          throw new Error(
            `Login API falló para ${email}: ${lastStatus} ${await response.text()}`,
          );
        }
        const body: unknown = await response.json();
        if (!isRecord(body)) {
          throw new Error(`Respuesta de login malformada para ${email}`);
        }
        session = parseLoginBody(body, email);
        return session;
      },
      {
        message: `login(${email}) esperando salir del throttle/fallo (lastStatus=${lastStatus})`,
        timeout: 90_000,
        intervals: [250, 500, 1_000, 2_000, 3_000],
      },
    )
    .not.toBeNull();

  if (session === null) {
    throw new Error(`Login falló para ${email}`);
  }
  return session;
}

/**
 * Deja la aplicación autenticada *antes* de la primera navegación del test.
 * Admin: token en `boletera_token` (fallback de `cookieTokenStorage`) + org.
 * Taquilla: claves de `apps/taquilla/lib/auth.ts`.
 */
export async function ensureAuthenticated(page: Page, app: AppKey): Promise<void> {
  if (app === 'web') return;

  if (app === 'admin') {
    const session = await loginViaApi(page, seedUsers.superAdmin.email);
    await page.addInitScript(
      ({ token, organizationId }) => {
        window.localStorage.setItem('boletera_token', token);
        if (organizationId !== null) {
          window.localStorage.setItem('boletera_org', organizationId);
        }
      },
      {
        token: session.accessToken,
        organizationId: session.user.organizationId,
      },
    );
    return;
  }

  const session = await loginViaApi(page, seedUsers.cashier.email);
  const taquillaUser = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    organizationId: session.user.organizationId,
    ...(session.user.firstName !== undefined
      ? { firstName: session.user.firstName }
      : {}),
    ...(session.user.lastName !== undefined
      ? { lastName: session.user.lastName }
      : {}),
  };
  await page.addInitScript(
    ({ token, user }) => {
      window.localStorage.setItem('taquilla_token', token);
      window.localStorage.setItem('taquilla_user', JSON.stringify(user));
      window.localStorage.setItem('taquilla_cashier', user.id);
      window.localStorage.setItem('taquilla_terminal_label', 'E2E-TAQ');
      if (user.organizationId !== null) {
        window.localStorage.setItem('boletera_org', user.organizationId);
      }
    },
    { token: session.accessToken, user: taquillaUser },
  );
}
