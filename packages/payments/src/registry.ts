import type { PaymentProvider, PaymentProviderId } from './types';
import { BanorteProvider } from './providers/banorte.provider';
import { CashProvider } from './providers/cash.provider';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import { isMercadoPagoConfigured } from './mercadopago/config';

const providers = new Map<PaymentProviderId, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: PaymentProviderId): PaymentProvider {
  const p = providers.get(id);
  if (!p) throw new Error(`Payment provider not registered: ${id}`);
  return p;
}

/**
 * Registra las pasarelas disponibles. Mercado Pago se registra siempre (el
 * provider valida su config al usarse); `onlinePaymentProviderId()` decide
 * cuál atiende las ventas online.
 */
export function initDefaultProviders(): void {
  registerProvider(new BanorteProvider());
  registerProvider(new CashProvider());
  registerProvider(new MercadoPagoProvider());
}

/**
 * Pasarela online activa: Mercado Pago cuando hay MP_ACCESS_TOKEN; si no,
 * Banorte (demo en desarrollo). Un solo lugar para esta decisión.
 */
export function onlinePaymentProviderId(): 'mercadopago' | 'banorte' {
  return isMercadoPagoConfigured() ? 'mercadopago' : 'banorte';
}

export function listProviders(): PaymentProviderId[] {
  return Array.from(providers.keys());
}
