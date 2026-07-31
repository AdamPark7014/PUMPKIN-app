import { Injectable } from '@nestjs/common';
import { PosAnalyticsService } from './analytics.service';
import { CheckoutService } from './checkout.service';
import { ManagerPinService } from './manager-pin.service';
import { SessionService } from './session.service';
import { TerminalService } from './terminal.service';
import { VoidRefundService } from './void-refund.service';
import { WillcallService } from './willcall.service';
import type { PosAnalyticsPeriod, PosPaymentMethod } from './types';

/**
 * Facade preserving the historical TaquillaPosService surface while
 * delegating to domain services (terminal, session, checkout, void, etc.).
 */
@Injectable()
export class TaquillaPosService {
  constructor(
    private readonly terminals: TerminalService,
    private readonly sessions: SessionService,
    private readonly checkout: CheckoutService,
    private readonly voids: VoidRefundService,
    private readonly willcall: WillcallService,
    private readonly managerPin: ManagerPinService,
    private readonly analytics: PosAnalyticsService,
  ) {}

  initializeTerminal(data: {
    organizationId: string;
    locationName: string;
    terminalName: string;
    hardwareConfig?: Record<string, string>;
  }) {
    return this.terminals.initializeTerminal(data);
  }

  startCashierSession(terminalId: string, cashierId: string, openingCash = 0) {
    return this.sessions.startCashierSession(terminalId, cashierId, openingCash);
  }

  quickCheckout(
    terminalId: string,
    sessionId: string,
    data: {
      eventId: string;
      offerId: string;
      quantity?: number;
      seatIds?: string[];
      paymentMethod: PosPaymentMethod;
      discountCode?: string;
      discountPercent?: number;
      cashierId?: string;
      buyerName?: string;
      buyerEmail?: string;
      buyerPhone?: string;
      isComp?: boolean;
      compReason?: string;
      managerPin?: string;
      clientSaleId?: string;
      holdIds?: string[];
    },
  ) {
    return this.checkout.quickCheckout(terminalId, sessionId, data);
  }

  createPosHold(data: {
    terminalId: string;
    sessionId: string;
    eventId: string;
    offerId?: string;
    seatIds?: string[];
    quantity?: number;
    cashierId?: string;
  }) {
    return this.checkout.createPosHold(data);
  }

  releaseHolds(holdIds: string[]) {
    return this.checkout.releaseHolds(holdIds);
  }

  processPayment(
    orderId: string,
    data: {
      method: 'CASH' | 'CARD' | 'CHECK';
      amount: number;
      cardDetails?: { lastFour: string; brand: string };
    },
  ) {
    return this.checkout.processPayment(orderId, data);
  }

  generateReceipt(orderId: string, terminalId: string) {
    return this.willcall.generateReceipt(orderId, terminalId);
  }

  scanBarcode(terminalId: string, barcode: string) {
    return this.willcall.scanBarcode(terminalId, barcode);
  }

  voidOrder(data: {
    orderId: string;
    sessionId?: string;
    cashierId?: string;
    reason?: string;
    managerPin?: string;
  }) {
    return this.voids.voidOrder(data);
  }

  syncInventory(terminalId: string, eventId: string) {
    return this.terminals.syncInventory(terminalId, eventId);
  }

  enableOfflineMode(terminalId: string) {
    return this.terminals.enableOfflineMode(terminalId);
  }

  syncOfflineTransactions(
    terminalId: string,
    transactions: Array<{
      checkoutData: {
        eventId: string;
        offerId: string;
        quantity?: number;
        seatIds?: string[];
        paymentMethod: PosPaymentMethod;
        buyerName?: string;
        buyerEmail?: string;
        buyerPhone?: string;
        clientSaleId?: string;
        isComp?: boolean;
        compReason?: string;
        cashierId?: string;
        holdIds?: string[];
        discountCode?: string;
        discountPercent?: number;
        managerPin?: string;
      };
      sessionId: string;
      clientSaleId?: string;
    }>,
  ) {
    return this.checkout.syncOfflineTransactions(terminalId, transactions);
  }

  getSessionSummary(sessionId: string) {
    return this.sessions.getSessionSummary(sessionId);
  }

  endCashierSession(
    sessionId: string,
    cashierId: string,
    closingCashCounted?: number,
    managerPin?: string,
  ) {
    return this.sessions.endCashierSession(
      sessionId,
      cashierId,
      closingCashCounted,
      managerPin,
    );
  }

  willcallLookup(q: string, organizationId?: string) {
    return this.willcall.willcallLookup(q, organizationId);
  }

  willcallFulfill(orderId: string, cashierId: string, terminalId?: string) {
    return this.willcall.willcallFulfill(orderId, cashierId, terminalId);
  }

  exchange(data: {
    orderId: string;
    sessionId: string;
    terminalId: string;
    cashierId: string;
    newOfferId?: string;
    newSeatIds?: string[];
    quantity?: number;
    paymentMethod: 'CASH' | 'CARD';
    managerPin?: string;
  }) {
    return this.voids.exchange(data);
  }

  addCashDrop(sessionId: string, amount: number, cashierId: string, note?: string) {
    return this.sessions.addCashDrop(sessionId, amount, cashierId, note);
  }

  setManagerPin(organizationId: string, pin: string, currentPin?: string) {
    return this.managerPin.setManagerPin(organizationId, pin, currentPin);
  }

  verifyManagerPin(organizationId: string, pin: string) {
    return this.managerPin.verifyManagerPin(organizationId, pin);
  }

  handoff(data: {
    sessionId: string;
    fromCashierId: string;
    toCashierId: string;
    openingCash?: number;
    closingCashCounted?: number;
    managerPin?: string;
  }) {
    return this.sessions.handoff(data);
  }

  listZReports(organizationId: string, take = 30, skip = 0) {
    return this.sessions.listZReports(organizationId, take, skip);
  }

  getTerminalAnalytics(terminalId: string, period: PosAnalyticsPeriod) {
    return this.analytics.getTerminalAnalytics(terminalId, period);
  }
}
