/**
 * API contract suite (Playwright).
 *
 * Exclusive ownership: e2e/contracts/**
 *
 * Preferred runner (no frontend webServer, serial workers):
 *   pnpm exec playwright test -c e2e/contracts/playwright.config.ts --list
 *   pnpm exec playwright test -c e2e/contracts/playwright.config.ts
 *
 * Or via root config (set E2E_NO_WEBSERVER=1 if apps already run):
 *   pnpm exec playwright test -c e2e/playwright.config.ts e2e/contracts --list
 *
 * Requires API at API_URL (default http://127.0.0.1:4000/api/v1) + seeded DB.
 * Failures are real contract bugs — tests never silent-skip.
 */
