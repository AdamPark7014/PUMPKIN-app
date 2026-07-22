import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://localhost:4000/api/v1';

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

  test('validate banorte config endpoint', async ({ request }) => {
    const res = await request.get(`${API}/payments/config/validate`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('demo');
    expect(body).toHaveProperty('missing');
  });
});
