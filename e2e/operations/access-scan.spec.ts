import { expect, test } from '../support/fixtures';
import { environment, seedUsers } from '../support/environment';
import { bearer, expectProblem, isJsonObject, jsonObject, login } from '../support/api';
import { request as playwrightRequest } from '@playwright/test';
import {
  OPENING_CASH,
  cashierIdFrom,
  checkoutCashSale,
  endSessionZReport,
  initTerminal,
  loadSeedEvent,
  pickAvailableSeat,
  receiptBarcodes,
  requireHealth,
  requiredNumber,
  scannerIdFrom,
  scanAccess,
  startSession,
  voidOrder,
} from './ops-helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Validación de accesos — scan', () => {
  test('acepta boleto válido, rechaza duplicado e inválido sobre seed determinista', async ({
    request,
    cashierSession,
    scannerSession,
    testId,
  }) => {
    await requireHealth(request);

    const event = await loadSeedEvent(request);
    const seat = await pickAvailableSeat(request, event.id);
    const cashierId = cashierIdFrom(cashierSession);
    const scannerId = scannerIdFrom(scannerSession);

    const terminalId = await initTerminal(
      request,
      cashierSession,
      event.organizationId,
      `${testId}-scan`,
    );
    const sessionId = await startSession(
      request,
      cashierSession,
      terminalId,
      cashierId,
      OPENING_CASH,
    );

    const sale = await checkoutCashSale(request, cashierSession, {
      terminalId,
      sessionId,
      cashierId,
      event,
      seat,
      testId: `${testId}-scan`,
    });
    const barcodes = await receiptBarcodes(request, cashierSession, sale.orderId, terminalId);
    const ticketCode = barcodes[0];
    if (!ticketCode) {
      throw new Error('Sale did not produce a ticket barcode');
    }

    const first = await scanAccess(request, scannerSession, ticketCode, scannerId);
    expect([200, 201], await first.response.text()).toContain(first.response.status());
    expect(first.body).toBeTruthy();
    if (!first.body) {
      throw new Error('Valid scan response body missing');
    }
    expect(first.body.success).toBe(true);
    expect(isJsonObject(first.body.ticket)).toBe(true);
    if (!isJsonObject(first.body.ticket)) {
      throw new Error('Valid scan ticket payload missing');
    }
    expect(first.body.ticket.code).toBe(ticketCode);

    const duplicate = await scanAccess(request, scannerSession, ticketCode, scannerId);
    const duplicateBody = await expectProblem(duplicate.response, 400);
    const duplicateMessage = Array.isArray(duplicateBody.message)
      ? duplicateBody.message.join(' ')
      : String(duplicateBody.message);
    expect(duplicateMessage.toLowerCase()).toMatch(/already|ya|usado|scanned|duplic/);

    const invalidCode = `INVALID-${testId}`.slice(0, 64);
    const invalid = await scanAccess(request, scannerSession, invalidCode, scannerId);
    const invalidBody = await expectProblem(invalid.response, [400, 404]);
    const invalidMessage = Array.isArray(invalidBody.message)
      ? invalidBody.message.join(' ')
      : String(invalidBody.message);
    expect(invalidMessage.toLowerCase()).toMatch(/not found|invalid|válid|no encontr/);

    await voidOrder(
      request,
      cashierSession,
      sale.orderId,
      cashierId,
      sessionId,
      `e2e access cleanup ${testId}`,
    );

    const summaryRes = await request.get(
      `${environment.apiUrl}/taquilla/session/summary?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: bearer(cashierSession) },
    );
    expect(summaryRes.status(), await summaryRes.text()).toBe(200);
    const summary = await jsonObject(summaryRes);
    const expectedCash = requiredNumber(summary, 'expectedCash');
    await endSessionZReport(request, cashierSession, sessionId, cashierId, expectedCash);
  });

  test('cliente no puede escanear accesos (rol)', async ({ testId }) => {
    const context = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      await requireHealth(context);
      const customer = await login(context, seedUsers.customer);
      const denied = await context.post(`${environment.apiUrl}/access/scan`, {
        headers: bearer(customer),
        data: {
          ticketCode: `ROLE-${testId}`.slice(0, 64),
          scannedBy: 'customer-station',
          channel: 'TAQUILLA',
        },
      });
      await expectProblem(denied, [401, 403]);
    } finally {
      await context.dispose();
    }
  });
});
