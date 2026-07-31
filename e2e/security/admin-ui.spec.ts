import { expect, test } from '@playwright/test';
import { environment } from './helpers';

/**
 * Admin UI route stability via URL + ARIA / accessible names.
 * Avoids assertions on mutable marketing copy (stats, clocks, year).
 */
test.describe('admin UI auth routes', () => {
  test('unauthenticated /dashboard redirects to /login without authenticated chrome', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    // Contract: protected platform routes must leave /dashboard for /login.
    // Failure mode seen when /auth/me hangs (no fetch timeout) and layout has
    // no server middleware — URL stays /dashboard with aria-busy forever.
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
  });

  test('login page exposes stable accessible controls', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const email = page.locator('#admin-email');
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByLabel('Email corporativo', { exact: true })).toBeVisible();

    const password = page.locator('#admin-password');
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute('autocomplete', 'current-password');

    await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Entrar al panel/i })).toBeVisible();

    await expect(page.getByRole('link', { name: /Olvidaste tu contraseña/i })).toHaveAttribute(
      'href',
      '/login/forgot',
    );
  });

  test('login form rejects empty submit via native constraint validation', async ({ page }) => {
    await page.goto('/login');
    const email = page.locator('#admin-email');
    const password = page.locator('#admin-password');

    await expect(email).toHaveJSProperty('validity.valueMissing', true);
    await page.getByRole('button', { name: /Entrar al panel/i }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(password).toHaveJSProperty('validity.valueMissing', true);
  });

  test('forgot-password route stays under /login', async ({ page }) => {
    await page.goto('/login/forgot');
    await expect(page).toHaveURL(/\/login\/forgot(?:\?|$)/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('admin base URL serves accessible entry without mutable brand stats', async ({ page }) => {
    await page.goto(environment.adminUrl);
    await expect(page).toHaveURL(
      new RegExp(`(?:${escapeRegExp(environment.adminUrl)}/?$)|(?:/login)|(?:/dashboard)`),
    );
    // Prefer stable control ids / ARIA over marketing copy.
    const email = page.locator('#admin-email');
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    if (await email.count()) {
      await expect(email).toBeVisible();
      await expect(page.locator('#admin-password')).toBeVisible();
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
