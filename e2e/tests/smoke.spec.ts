import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Taquilla web/i })).toBeVisible();
});

test('events catalog', async ({ page }) => {
  await page.goto('/events');
  await expect(page.locator('main')).toBeVisible();
});

test('login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /Iniciar sesión/i })).toBeVisible();
});
