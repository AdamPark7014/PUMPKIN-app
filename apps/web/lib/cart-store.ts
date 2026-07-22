'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartItem = {
  eventId: string;
  eventTitle: string;
  slug?: string;
  holdIds: string[];
  offerId: string;
  expiresAt: string;
  seatCount: number;
};

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeAt: (index: number) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((s) => ({
          items: [...s.items.filter((i) => i.eventId !== item.eventId), item],
        })),
      removeAt: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'boletera-cart' },
  ),
);

export function secondsUntil(iso: string) {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}
