import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // Auth login is throttled (5/min). Keep concurrency modest so suites stay deterministic.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['line'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]]
    : 'list',
  outputDir: '../test-results/playwright',
  use: {
    // Prefer 127.0.0.1 — on some Windows setups localhost:4000 hits another API via IPv6.
    baseURL: process.env.WEB_URL || 'http://127.0.0.1:3010',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Set E2E_NO_WEBSERVER=1 when API/frontends are already running (avoids coupling to CI retries).
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          command: 'pnpm --filter @boletera/api dev',
          url: 'http://127.0.0.1:4000/api/v1/health',
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @boletera/web exec next dev --port 3010 --hostname 127.0.0.1',
          url: 'http://127.0.0.1:3010',
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api/v1',
          },
        },
        {
          command: 'pnpm --filter @boletera/admin exec next dev --port 3001 --hostname 127.0.0.1',
          url: 'http://127.0.0.1:3001/login',
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api/v1',
            NEXT_PUBLIC_ADMIN_API_URL: 'http://127.0.0.1:4000/api/v1',
          },
        },
        {
          command:
            'pnpm --filter @boletera/taquilla exec next dev --port 3002 --hostname 127.0.0.1',
          url: 'http://127.0.0.1:3002',
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api/v1',
          },
        },
      ],
});
