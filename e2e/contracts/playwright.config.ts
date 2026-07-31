import { defineConfig, devices } from '@playwright/test';

/**
 * Local config for API contract suite — does not start frontends.
 * Assumes API already running at API_URL (default http://127.0.0.1:4000/api/v1).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '../../test-results/playwright-contracts',
  use: {
    baseURL: process.env.API_URL || 'http://127.0.0.1:4000/api/v1',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
