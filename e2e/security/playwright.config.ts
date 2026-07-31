import { defineConfig, devices } from '@playwright/test';
import { environment } from '../support/environment';

/**
 * Security suite config — owned exclusively under e2e/security/**.
 * Reuses shared support; does not alter the root e2e Playwright config.
 *
 * Single worker: login endpoints are throttled (5/min) and parallel workers
 * produce non-deterministic 429s.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: environment.adminUrl,
    trace: 'on-first-retry',
  },
  expect: {
    // Navigation/auth hydration is event-driven; avoid fixed sleeps in specs.
    timeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Prefer reusing already-running local services. Starting `api dev` here also
  // runs prisma generate, which races with a locked query-engine DLL on Windows.
  webServer:
    process.env.CI || process.env.E2E_SECURITY_SKIP_WEBSERVER === '1'
      ? undefined
      : [
          {
            command: 'pnpm --filter @boletera/admin exec next dev --port 3001 --hostname 127.0.0.1',
            url: environment.adminUrl,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ...process.env,
              NEXT_PUBLIC_API_URL: environment.apiUrl,
              NEXT_PUBLIC_ADMIN_API_URL: environment.apiUrl,
            },
          },
        ],
});
