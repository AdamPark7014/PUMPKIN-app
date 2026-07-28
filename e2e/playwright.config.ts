import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  use: {
    // Prefer 127.0.0.1 — on some Windows setups localhost:4000 hits another API via IPv6.
    baseURL: process.env.WEB_URL || 'http://127.0.0.1:3010',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.CI
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
      ],
});
