import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://127.0.0.1:4000/api/v1';

test.describe('API Banorte', () => {
  test('health check', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.service).toBe('boletera-api');
  });

  test('payment config is Banorte', async ({ request }) => {
    const res = await request.get(`${API}/payments/config`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.gateway).toBe('BANORTE');
    expect(body.methods).toContain('SPEI');
  });

  test('validate banorte config endpoint requires auth', async ({ request }) => {
    const res = await request.get(`${API}/payments/config/validate`);
    expect(res.status()).toBe(401);
  });

  test('public payment config exposes demo flag and IPN', async ({ request }) => {
    const res = await request.get(`${API}/payments/config`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('demo');
    expect(body).toHaveProperty('methods');
    expect(body.ipn?.webhookUrl).toMatch(/\/payments\/webhooks\/banorte$/);
    expect(body.ipn).toHaveProperty('webhookSecretConfigured');
  });
});
