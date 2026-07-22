import type { PaymentProvider, PaymentProviderId } from './types';
import { BanorteProvider } from './providers/banorte.provider';
import { CashProvider } from './providers/cash.provider';

const providers = new Map<PaymentProviderId, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: PaymentProviderId): PaymentProvider {
  const p = providers.get(id);
  if (!p) throw new Error(`Payment provider not registered: ${id}`);
  return p;
}

/** Pasarela principal: Banorte directo a cuenta empresarial (sin Stripe). */
export function initDefaultProviders(): void {
  registerProvider(new BanorteProvider());
  registerProvider(new CashProvider());
}

export function listProviders(): PaymentProviderId[] {
  return Array.from(providers.keys());
}
