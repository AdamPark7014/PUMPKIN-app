'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EVENT } from './event-config';

export type CartOfferLine = {
  offerId: string;
  offerName?: string;
  holdIds: string[];
  seatLabels?: string[];
  quantity: number;
  lineTotal?: number;
};

export type CartItem = {
  eventId: string;
  eventTitle: string;
  slug?: string;
  startsAt?: string;
  venueName?: string;
  venueCity?: string;
  expiresAt: string;
  seatCount: number;
  currency?: string;
  lines: CartOfferLine[];
  /** @deprecated use lines — kept for older persisted carts */
  holdIds?: string[];
  offerId?: string;
  seatLabels?: string[];
  lineTotal?: number;
};

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeAt: (index: number) => void;
  clear: () => void;
};

export function normalizeCartItem(item: CartItem): CartItem {
  if (item.lines?.length) {
    const seatCount = item.lines.reduce((s, l) => s + (l.quantity || l.holdIds.length), 0);
    return { ...item, seatCount, holdIds: item.lines.flatMap((l) => l.holdIds) };
  }
  if (item.holdIds?.length && item.offerId) {
    return {
      ...item,
      lines: [
        {
          offerId: item.offerId,
          holdIds: item.holdIds,
          seatLabels: item.seatLabels,
          quantity: item.holdIds.length,
          lineTotal: item.lineTotal,
        },
      ],
      seatCount: item.holdIds.length,
    };
  }
  return { ...item, lines: item.lines ?? [], seatCount: item.seatCount ?? 0 };
}

/** Estimated line total from persisted cart data (fees confirmed at checkout). */
export function cartItemEstimatedTotal(item: CartItem): number {
  const normalized = normalizeCartItem(item);
  const fromLines = normalized.lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  if (fromLines > 0) return fromLines;
  return normalized.lineTotal ?? 0;
}

export function cartHoldIds(item: CartItem): string[] {
  const normalized = normalizeCartItem(item);
  return normalized.lines.flatMap((l) => l.holdIds);
}

/**
 * Llave de almacenamiento propia del evento.
 *
 * Antes era `boletera-cart`, global: al correr dos proyectos distintos en el
 * mismo origen (localhost:3000) el carrito de uno aparecía en el otro. La
 * llave lleva ahora el slug del evento, así que carritos ajenos son
 * invisibles aunque compartan dominio.
 */
const CART_STORAGE_KEY = `pumpkin-cart:${EVENT.slug}`;

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          items: [
            ...s.items.filter((i) => i.eventId !== item.eventId),
            normalizeCartItem(item),
          ],
        })),
      removeAt: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: CART_STORAGE_KEY,
      // Sistema de un solo evento: un item de otro evento no puede comprarse
      // ni mostrarse. Se descarta al rehidratar en vez de arrastrar basura.
      merge: (persisted, current) => {
        const saved = (persisted as Partial<CartState> | undefined)?.items ?? [];
        return { ...current, items: saved.filter((i) => Boolean(i?.eventId)) };
      },
    },
  ),
);

export function secondsUntil(iso: string) {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}
