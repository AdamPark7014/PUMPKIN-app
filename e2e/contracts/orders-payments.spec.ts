import { expect, test } from '../support/fixtures';
import { expectProblem, jsonObject } from '../support/api';
import {
  assertAvailability,
  assertOrderContract,
  assertOrdersPaymentsMetrics,
  assertPaymentsConfig,
  isNumber,
  isString,
  requireObject,
  requireString,
} from './_lib/guards';
import {
  apiUrl,
  authHeaders,
  createSeatHold,
  expectForbidden,
  expectUnauthorized,
  fetchEventBySlug,
  metricsUrl,
  pickAvailableSeat,
  releaseHoldSafe,
  requireApiHealthy,
  seedEvents,
} from './_lib/helpers';
import { seedOrgs } from './_lib/seed';
import { seedUsers } from '../support/environment';

test.describe('API contracts — orders + payments/refund', () => {
  test.beforeEach(async ({ request }) => {
    await requireApiHealthy(request);
  });

  test('GET /payments/config is public and Banorte-shaped', async ({ request }) => {
    const response = await request.get(apiUrl('/payments/config'));
    expect(response.status(), await response.text()).toBe(200);
    assertPaymentsConfig(await jsonObject(response));
  });

  test('GET /payments/config/validate requires auth (401 anonymous)', async ({ request }) => {
    const response = await request.get(apiUrl('/payments/config/validate'));
    await expectUnauthorized(response, [401]);
  });

  test('GET /payments/config/validate rejects CUSTOMER (403)', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.customer);
    const response = await request.get(apiUrl('/payments/config/validate'), { headers });
    await expectForbidden(response, [403]);
  });

  test('POST /payments/:orderId/refunds requires auth', async ({ request }) => {
    const response = await request.post(apiUrl('/payments/ord_missing/refunds'), {
      data: { reason: 'contracts' },
    });
    await expectUnauthorized(response, [401]);
  });

  test('POST /payments/:orderId/refunds rejects CUSTOMER (403)', async ({ request }) => {
    const headers = await authHeaders(request, seedUsers.customer);
    const response = await request.post(apiUrl('/payments/ord_missing/refunds'), {
      headers,
      data: { reason: 'contracts' },
    });
    await expectForbidden(response, [403]);
  });

  test('GET /orders/mine requires auth', async ({ request }) => {
    const response = await request.get(apiUrl('/orders/mine'));
    await expectUnauthorized(response, [401]);
  });

  test('POST /orders without holds returns 400', async ({ request }) => {
    const response = await request.post(apiUrl('/orders'), {
      data: {
        eventId: seedEvents.conciertoDemo.id,
        buyerName: 'Contracts',
        buyerEmail: 'contracts-invalid@boletera.test',
        holdIds: [],
      },
    });
    await expectProblem(response, 400);
  });

  test('hold → order → confirm → refund restores inventory and keeps metrics contract', async ({
    request,
    testId,
  }) => {
    const event = await fetchEventBySlug(request, seedEvents.conciertoDemo.slug);
    const offers = Array.isArray(event.offers) ? event.offers : [];
    const seat = await pickAvailableSeat(request, String(event.id), offers, `pay-${testId}`);
    const sessionId = `contracts-pay-${testId}`;
    const buyerEmail = `contracts+${testId.replace(/[^a-zA-Z0-9]/g, '')}@boletera.test`;

    let holdId: string | undefined;
    try {
      const hold = await createSeatHold(request, {
        eventId: String(event.id),
        offerId: seat.offerId,
        seatId: seat.seatId,
        sessionId,
      });
      holdId = hold.holdIds[0];

      const orderRes = await request.post(apiUrl('/orders'), {
        data: {
          eventId: event.id,
          offerId: seat.offerId,
          holdIds: [holdId],
          buyerName: 'Contracts Refund Buyer',
          buyerEmail,
          paymentMethod: 'CARD',
        },
        headers: { 'idempotency-key': `contracts-order-${testId}` },
      });
      expect([200, 201], await orderRes.text()).toContain(orderRes.status());
      const orderBody = await jsonObject(orderRes);
      const order = assertOrderContract(orderBody);
      expect(['PENDING', 'COMPLETED']).toContain(order.status);

      // Hold is consumed by the order — do not release afterward.
      holdId = undefined;

      let completedOrderId = order.id;
      let publicId = order.publicId;

      if (order.status === 'PENDING') {
        const paymentAction = orderBody.paymentAction;
        expect(paymentAction, 'WEB Banorte order must expose paymentAction').toBeTruthy();
        if (paymentAction) {
          const action = requireObject(paymentAction, 'paymentAction');
          expect(action.gateway).toBe('BANORTE');
          requireString(action, 'intentId');
          requireString(action, 'status');
        }

        const confirmRes = await request.post(apiUrl('/payments/confirm'), {
          data: { orderId: order.id },
        });
        expect([200, 201], await confirmRes.text()).toContain(confirmRes.status());
        const confirmBody = await jsonObject(confirmRes);
        const confirmedOrder = requireObject(
          confirmBody.order ?? confirmBody,
          'confirm.order',
        );
        const confirmed = assertOrderContract(confirmedOrder);
        expect(confirmed.status).toBe('COMPLETED');
        completedOrderId = confirmed.id;
        publicId = confirmed.publicId;
      }

      const statusRes = await request.get(apiUrl(`/orders/${publicId}/status`));
      expect(statusRes.status(), await statusRes.text()).toBe(200);
      const statusBody = await jsonObject(statusRes);
      expect(requireString(statusBody, 'publicId')).toBe(publicId);
      expect(requireString(statusBody, 'status')).toBe('COMPLETED');

      const soldAvail = assertAvailability(
        await jsonObject(
          await request.get(apiUrl(`/inventory/${event.id}/availability`)),
        ),
      );
      const soldTicket = soldAvail.tickets.find((t) => t.id === seat.ticketId);
      expect(soldTicket?.status, 'ticket must be SOLD after payment').toBe('SOLD');

      const adminHeaders = await authHeaders(request, seedUsers.superAdmin);
      const refundRes = await request.post(
        apiUrl(`/payments/${completedOrderId}/refunds`),
        {
          headers: adminHeaders,
          data: {
            reason: 'CUSTOMER_REQUEST',
            notes: `contracts-${testId}`,
          },
        },
      );
      expect([200, 201], await refundRes.text()).toContain(refundRes.status());
      const refundBody = await jsonObject(refundRes);
      const refund = requireObject(refundBody.refund, 'refund');
      requireString(refund, 'id');
      requireString(refund, 'status');
      expect(['COMPLETED', 'PENDING']).toContain(refund.status);
      expect(isNumber(refund.amount) || isString(refund.amount)).toBe(true);

      if (refund.status === 'PENDING') {
        const completeRes = await request.post(
          apiUrl(`/payments/refunds/${String(refund.id)}/complete`),
          {
            headers: adminHeaders,
            data: { banorteReference: `contracts-ref-${testId}` },
          },
        );
        expect([200, 201], await completeRes.text()).toContain(completeRes.status());
        const completeBody = await jsonObject(completeRes);
        expect(completeBody.inventoryReleased === true || completeBody.alreadyCompleted === true).toBe(
          true,
        );
      }

      const afterStatus = await request.get(apiUrl(`/orders/${publicId}/status`));
      expect(afterStatus.status()).toBe(200);
      const afterOrder = await jsonObject(afterStatus);
      expect(['REFUNDED', 'PARTIALLY_REFUNDED']).toContain(afterOrder.status);

      const afterAvail = assertAvailability(
        await jsonObject(
          await request.get(apiUrl(`/inventory/${event.id}/availability`)),
        ),
      );
      const ticketAfter = afterAvail.tickets.find((t) => t.id === seat.ticketId);
      expect(
        ticketAfter?.status,
        'full refund must release ticket from SOLD (AVAILABLE or REFUNDED)',
      ).toMatch(/^(AVAILABLE|REFUNDED)$/);

      const metricsRes = await request.get(
        metricsUrl('orders', { organizationId: seedOrgs.platform.id }),
        { headers: adminHeaders },
      );
      expect(metricsRes.status(), await metricsRes.text()).toBe(200);
      assertOrdersPaymentsMetrics(await jsonObject(metricsRes));

      const salesReport = await request.get(apiUrl('/admin/reports/sales'), {
        headers: adminHeaders,
      });
      expect(salesReport.status(), await salesReport.text()).toBe(200);
      // sales report may be object or array depending on implementation — never 5xx / empty body
      const reportText = await salesReport.text();
      expect(reportText.length).toBeGreaterThan(2);
      const reportJson: unknown = JSON.parse(reportText);
      expect(reportJson === null).toBe(false);
    } finally {
      await releaseHoldSafe(request, holdId);
    }
  });
});
