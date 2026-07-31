import { expect, type Locator, type Page } from '@playwright/test';
import type { Screen } from './targets';

/**
 * Señales de que la pantalla principal ya se ha montado. Se esperan con
 * `expect(...).toBeVisible()` (condition wait de Playwright); nunca con
 * `page.waitForTimeout`.
 */
async function firstVisible(candidates: readonly Locator[]): Promise<Locator> {
  // `Promise.any` se resuelve con el primer locator visible; si todos fallan,
  // el error compuesto se reescribe con un mensaje que lista los selectores.
  try {
    return await Promise.any(
      candidates.map(async (locator) => {
        await expect(locator.first()).toBeVisible({ timeout: 20_000 });
        return locator.first();
      }),
    );
  } catch (error) {
    throw new Error(
      `Ninguna señal de listo se hizo visible.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function waitForScreenReady(page: Page, screen: Screen): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  switch (screen.id) {
    case 'web:home':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('banner'),
        page.getByRole('searchbox'),
        page.getByRole('link', { name: /boletera/i }),
      ]);
      break;
    case 'web:login':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('heading', { level: 1 }),
        page.getByLabel(/email/i),
        page.getByRole('button', { name: /entrar|iniciar|crear/i }),
      ]);
      break;
    case 'web:venues':
    case 'web:ciudades':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('heading'),
        page.getByRole('banner'),
      ]);
      break;
    case 'admin:login':
      await firstVisible([
        page.getByRole('main'),
        page.getByLabel(/email/i),
        page.getByRole('button', { name: /entrar|iniciar|acceder/i }),
        page.getByRole('heading'),
      ]);
      break;
    case 'admin:dashboard':
    case 'admin:events':
    case 'admin:orders':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('navigation'),
        page.getByRole('banner'),
        page.getByText(/cargando sesión/i),
      ]);
      // Si aún se muestra el spinner de sesión, espera a que el shell real aparezca.
      await page
        .getByRole('navigation')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(async () => {
          await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 });
        });
      break;
    case 'taquilla:login':
      await firstVisible([
        page.getByRole('main'),
        page.getByLabel(/email/i),
        page.getByRole('button', { name: /abrir turno|entrar/i }),
        page.getByRole('heading'),
      ]);
      break;
    case 'taquilla:home':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('heading', { name: /turno|taquilla|venta/i }),
        page.getByRole('link', { name: /nueva venta|eventos|buscar/i }),
        page.getByLabel(/email/i), // si redirige a login, también es un estado listo
      ]);
      break;
    case 'taquilla:eventos':
    case 'taquilla:buscar':
      await firstVisible([
        page.getByRole('main'),
        page.getByRole('heading'),
        page.getByRole('searchbox'),
        page.getByLabel(/buscar|código|orden|email/i),
        page.getByRole('link', { name: /venta|eventos/i }),
      ]);
      break;
    default: {
      const unhandled: never = screen.id;
      throw new Error(`Pantalla sin estrategia de listo: ${unhandled}`);
    }
  }
}
