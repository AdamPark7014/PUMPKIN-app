/**
 * Suite operativa POS + accesos.
 * Puerto 4001 por defecto: en este host :4000 suele estar ocupado por otro producto
 * (p. ej. DarkKitchenOS), lo que rompe contratos /access y /taquilla.
 *
 * Arranca el dist compilado (tsc --noEmitOnError false) porque nest --watch
 * se detiene ante errores TS ajenos a operations.
 */
process.env.API_PORT ??= '4001';
process.env.API_URL ??= `http://127.0.0.1:${process.env.API_PORT}/api/v1`;

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const apiPort = process.env.API_PORT;
const apiUrl = process.env.API_URL;
const apiDir = path.resolve(__dirname, '../../apps/api');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: apiUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'operations', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsc -p tsconfig.build.json && node dist/main.js',
    cwd: apiDir,
    url: `${apiUrl}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      API_HOST: '127.0.0.1',
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
  },
});
