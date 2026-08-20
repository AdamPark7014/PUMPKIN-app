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
 * Pumpkin / despliegues que fijan la pasarela: solo Mercado Pago.
 * Sin token, createIntent falla con configuración faltante (no Banorte).
 */
export function isMercadoPagoOnlyMode(): boolean {
  const gateway = (process.env.PAYMENTS_GATEWAY ?? '').trim().toLowerCase();
  const tenant = (process.env.DEMO_TENANT_SLUG ?? '').trim().toLowerCase();
  return gateway === 'mercadopago' || tenant === 'pumpkin-zone';
}

/**
 * Pasarela online activa. En modo Pumpkin / PAYMENTS_GATEWAY=mercadopago
 * siempre es Mercado Pago; en otros tenants cae a Banorte solo si no hay token.
 */
export function onlinePaymentProviderId(): 'mercadopago' | 'banorte' {
  if (isMercadoPagoOnlyMode()) return 'mercadopago';
  return isMercadoPagoConfigured() ? 'mercadopago' : 'banorte';
}

export function listProviders(): PaymentProviderId[] {
  return Array.from(providers.keys());
}
