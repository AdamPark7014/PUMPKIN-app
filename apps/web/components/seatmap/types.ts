export type SeatMapOffer = {
  id: string;
  zone: string;
  name?: string;
  basePrice: string;
};

export type SelectedSeatInfo = {
  seatId: string;
  label: string;
  sectionName: string;
  sectionSlug: string;
  price: number;
  offerId: string;
};

/** Derive checkout offerId from majority zone among selected seats. */
export function primaryOfferIdFromSelection(
  items: SelectedSeatInfo[],
  fallback = '',
): string {
  if (!items.length) return fallback;
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.offerId) continue;
    counts.set(i.offerId, (counts.get(i.offerId) ?? 0) + 1);
  }
  let best = fallback;
  let n = 0;
  for (const [id, c] of counts) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best || items[0]?.offerId || fallback;
}

export function selectionTotal(items: SelectedSeatInfo[]): number {
  return items.reduce((s, i) => s + i.price, 0);
}
