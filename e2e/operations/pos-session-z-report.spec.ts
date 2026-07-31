import { expect, test } from '../support/fixtures';
import { environment } from '../support/environment';
import { bearer, isJsonObject, jsonObject } from '../support/api';
import {
  OPENING_CASH,
  cashierIdFrom,
  checkoutCashSale,
  endSessionZReport,
  findZReport,
  initTerminal,
  loadSeedEvent,
  pickAvailableSeat,
  receiptBarcodes,
  requireHealth,
  requiredNumber,
  requiredString,
  voidOrder,
  startSession,
} from './ops-helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Taquilla POS — sesión, venta y corte Z', () => {
  test('abre sesión, vende en efectivo, cierra con Z-report y limpia inventario', async ({
    request,
    cashierSession,
    testId,
  }) => {
    await requireHealth(request);

    const event = await loadSeedEvent(request);
    const seat = await pickAvailableSeat(request, event.id);
    const cashierId = cashierIdFrom(cashierSession);
    const organizationId = event.organizationId;

    const terminalId = await initTerminal(request, cashierSession, organizationId, testId);
    const sessionId = await startSession(request, cashierSession, terminalId, cashierId, OPENING_CASH);

    const sale = await checkoutCashSale(request, cashierSession, {
      terminalId,
      sessionId,
      cashierId,
      event,
      seat,
      testId,
    });
    expect(sale.publicId.length).toBeGreaterThan(0);

    const barcodes = await receiptBarcodes(request, cashierSession, sale.orderId, terminalId);
    expect(barcodes[0]?.length ?? 0).toBeGreaterThan(0);

    const summaryRes = await request.get(
      `${environment.apiUrl}/taquilla/session/summary?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: bearer(cashierSession) },
    );
    expect(summaryRes.status(), await summaryRes.text()).toBe(200);
    const summary = await jsonObject(summaryRes);
    expect(requiredNumber(summary, 'totalTransactions')).toBeGreaterThanOrEqual(1);
    expect(requiredNumber(summary, 'cashSales')).toBeGreaterThan(0);
    expect(requiredNumber(summary, 'openingCash')).toBe(OPENING_CASH);
    const expectedCash = requiredNumber(summary, 'expectedCash');
    expect(expectedCash).toBe(OPENING_CASH + requiredNumber(summary, 'cashSales'));

    const zReport = await endSessionZReport(
      request,
      cashierSession,
      sessionId,
      cashierId,
      expectedCash,
    );
    expect(requiredNumber(zReport, 'variance')).toBe(0);
    expect(requiredNumber(zReport, 'totalTransactions')).toBeGreaterThanOrEqual(1);
    expect(zReport.zReport).toBe(true);

    const archived = await findZReport(request, cashierSession, organizationId, sessionId);
    expect(archived.sessionId).toBe(sessionId);
    expect(isJsonObject(archived.report)).toBe(true);
    if (!isJsonObject(archived.report)) {
      throw new Error('Archived Z-report payload missing');
    }
    expect(archived.report.zReport).toBe(true);
    expect(requiredString(archived.report, 'sessionId')).toBe(sessionId);

    await voidOrder(
      request,
      cashierSession,
      sale.orderId,
      cashierId,
      undefined,
      `e2e cleanup ${testId}`,
    );

    const availRes = await request.get(`${environment.apiUrl}/inventory/${event.id}/availability`);
    expect(availRes.status(), await availRes.text()).toBe(200);
    const avail = await jsonObject(availRes);
    const tickets = Array.isArray(avail.tickets) ? avail.tickets : [];
    const restored = tickets.filter(isJsonObject).find((ticket) => ticket.seatId === seat.seatId);
    expect(restored, `Seat ${seat.seatId} should be restored after void`).toBeTruthy();
    expect(restored && restored.status).toBe('AVAILABLE');
  });
});
