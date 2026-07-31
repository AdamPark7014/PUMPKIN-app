/**
 * Bootstrap API URL for this suite before support/environment is evaluated.
 * Default 4010 avoids colliding with unrelated services that often bind :4000
 * on local Windows (Playwright reuseExistingServer only checks HTTP 200).
 */
const port = process.env.E2E_INVENTORY_API_PORT ?? process.env.API_PORT ?? '4010';

if (!process.env.API_URL) {
  process.env.API_URL = `http://127.0.0.1:${port}/api/v1`;
}

if (!process.env.API_PORT) {
  process.env.API_PORT = port;
}

export const inventoryApiUrl = process.env.API_URL;
export const inventoryApiPort = process.env.API_PORT;
