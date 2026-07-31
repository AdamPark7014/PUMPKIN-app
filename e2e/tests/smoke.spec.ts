import { expect, test } from '../support/fixtures';
import { environment } from '../support/environment';

test.describe('storefront smoke (route + ARIA contracts)', () => {
  test('homepage exposes a main landmark', async ({ page }) => {
    const response = await page.goto(environment.webUrl);
    expect(response?.ok() ?? false).toBe(true);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('events catalog route exposes main landmark', async ({ page }) => {
    await page.goto(`${environment.webUrl}/events`);
    await expect(page).toHaveURL(/\/events/);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('login route exposes a form with email and password fields', async ({ page }) => {
    await page.goto(`${environment.webUrl}/login`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('main').or(page.locator('form')).first()).toBeVisible();
    await expect(
      page.getByLabel(/email|correo/i).or(page.locator('input[type="email"]')).first(),
    ).toBeVisible();
    await expect(
      page.getByLabel(/password|contrase/i).or(page.locator('input[type="password"]')).first(),
    ).toBeVisible();
  });
});
