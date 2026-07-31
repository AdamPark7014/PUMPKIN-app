import './_lib/env';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { environment } from '../support/environment';
import { inventoryApiPort, inventoryApiUrl } from './_lib/env';

/**
 * Inventory API suite — exclusive ownership under e2e/inventory/**.
 * Reuses e2e/support; does not alter the root Playwright config.
 *
 * Single worker: concurrent hold/sale races must not collide across tests
 * on shared seed inventory.
 */
const config: PlaywrightTestConfig = {
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: environment.apiUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
};

if (!process.env.E2E_NO_WEBSERVER) {
  config.webServer = [
    {
      // Skip `dev` (prisma generate) — OneDrive/Windows often EPERM-locks the query engine DLL.
      command: 'pnpm --filter @boletera/api exec nest start --watch',
      url: `${inventoryApiUrl}/health`,
      reuseExistingServer: true,
      timeout: 90_000,
      env: {
        ...process.env,
        API_PORT: inventoryApiPort,
        API_HOST: '127.0.0.1',
      },
    },
  ];
}

export default defineConfig(config);
