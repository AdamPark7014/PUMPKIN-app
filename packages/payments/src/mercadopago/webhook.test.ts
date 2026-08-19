import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MercadoPagoProvider } from '../../dist/providers/mercadopago.provider.js';

/**
 * Prueba contra dist/ (el provider importa módulos internos; strip-types exige
 * extensiones). Corre `pnpm build` antes — el script `test` ya lo encadena.
 *
 * El webhook de Mercado Pago es la única entrada no autenticada que puede
 * marcar una orden como pagada. Estas pruebas fijan las tres garantías:
 *   1. la firma x-signature se verifica con el manifiesto exacto de MP;
 *   2. el estado viene de la API de MP (fetch), nunca del body del webhook;
 *   3. notificaciones que no son de pago se ignoran sin tocar nada.
 */

const SECRET = 'mp_whsec_test';
const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

function sign(dataId: string, requestId: string, ts = '1700000000'): string {
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

/** fetch falso: sólo responde al GET del pago; todo lo demás revienta. */
function mockPaymentLookup(payment: Record<string, unknown>, calls: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    assert.match(url, /\/v1\/payments\/\d+$/, 'sólo debe consultarse el pago por id');
    return new Response(JSON.stringify(payment), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('MercadoPagoProvider.handleWebhook', () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    process.env.MP_WEBHOOK_SECRET = SECRET;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = originalFetch;
  });

  it('acepta firma válida y toma el estado de la API de MP, no del body', async () => {
    const calls: string[] = [];
    mockPaymentLookup(
      { id: 123456, status: 'approved', external_reference: 'order_abc' },
      calls,
    );
    const provider = new MercadoPagoProvider();

    const result = await provider.handleWebhook({
      // El body miente: dice rejected. Debe ganar la API.
      body: { type: 'payment', data: { id: '123456' }, status: 'rejected' },
      query: { 'data.id': '123456', type: 'payment' },
      headers: { 'x-signature': sign('123456', 'req-1'), 'x-request-id': 'req-1' },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.orderId, 'order_abc');
    assert.equal(result.intentId, '123456');
    assert.equal(calls.length, 1, 'una sola consulta a MP');
  });

  it('rechaza firma inválida sin consultar a MP', async () => {
    const calls: string[] = [];
    mockPaymentLookup({ id: 1, status: 'approved' }, calls);
    const provider = new MercadoPagoProvider();

    await assert.rejects(
      provider.handleWebhook({
        body: {},
        query: { 'data.id': '123456', type: 'payment' },
        headers: { 'x-signature': 'ts=1700000000,v1=deadbeef', 'x-request-id': 'req-1' },
      }),
      /Firma de webhook/,
    );
    assert.equal(calls.length, 0, 'no debe tocar la API con firma inválida');
  });

  it('en producción, sin secreto configurado se rechaza todo', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    mockPaymentLookup({ id: 1, status: 'approved' });
    const provider = new MercadoPagoProvider();

    await assert.rejects(
      provider.handleWebhook({
        body: {},
        query: { 'data.id': '1', type: 'payment' },
        headers: { 'x-signature': 'ts=1,v1=aa', 'x-request-id': 'r' },
      }),
      /Firma de webhook/,
    );
  });

  it('mapea rejected→failed y pending→pending', async () => {
    const provider = new MercadoPagoProvider();

    mockPaymentLookup({ id: 7, status: 'rejected', external_reference: 'o1' });
    let r = await provider.handleWebhook({
      body: {},
      query: { 'data.id': '7', type: 'payment' },
      headers: { 'x-signature': sign('7', 'r7'), 'x-request-id': 'r7' },
    });
    assert.equal(r.status, 'failed');

    mockPaymentLookup({ id: 8, status: 'in_process', external_reference: 'o2' });
    r = await provider.handleWebhook({
      body: {},
      query: { 'data.id': '8', type: 'payment' },
      headers: { 'x-signature': sign('8', 'r8'), 'x-request-id': 'r8' },
    });
    assert.equal(r.status, 'pending');
  });

  it('ignora notificaciones que no son de pago (merchant_order) sin llamar a MP', async () => {
    const calls: string[] = [];
    mockPaymentLookup({ id: 1, status: 'approved' }, calls);
    const provider = new MercadoPagoProvider();

    const r = await provider.handleWebhook({
      body: { type: 'merchant_order', data: { id: '999' } },
      query: { 'data.id': '999', type: 'merchant_order' },
      headers: {},
    });
    assert.equal(r.status, 'pending');
    assert.equal(r.orderId, undefined);
    assert.equal(calls.length, 0);
  });

  it('acepta el formato IPN legado (topic + id en query)', async () => {
    mockPaymentLookup({ id: 55, status: 'approved', external_reference: 'legacy' });
    const provider = new MercadoPagoProvider();

    const r = await provider.handleWebhook({
      body: {},
      query: { topic: 'payment', id: '55' },
      headers: { 'x-signature': sign('55', 'rl'), 'x-request-id': 'rl' },
    });
    assert.equal(r.status, 'completed');
    assert.equal(r.orderId, 'legacy');
  });
});
