import type { SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';

/**
 * Large stadium map (~25k seats) compatible with venue-engine SeatMapData.
 * Geometry is simplified (grid tribunes) for seed performance while keeping
 * section/row/seat semantics the storefront and admin expect.
 */
export function generateMegaStadiumMap(opts: {
  idPrefix: string;
  targetSeats?: number;
}): SeatMapData {
  const prefix = opts.idPrefix;
  const target = opts.targetSeats ?? 25_000;

  const tribunes: Array<{
    name: string;
    slug: string;
    color: string;
    tier: string;
    priceMul: number;
    share: number;
    ox: number;
    oy: number;
  }> = [
    { name: 'Preferente Norte', slug: 'pref-norte', color: '#c45c6a', tier: 'premium', priceMul: 1.6, share: 0.12, ox: 0, oy: -1 },
    { name: 'Preferente Sur', slug: 'pref-sur', color: '#c45c6a', tier: 'premium', priceMul: 1.55, share: 0.12, ox: 0, oy: 1 },
    { name: 'Lateral Este', slug: 'lat-este', color: '#5b9fd4', tier: 'standard', priceMul: 1.1, share: 0.22, ox: 1, oy: 0 },
    { name: 'Lateral Oeste', slug: 'lat-oeste', color: '#5a9e78', tier: 'standard', priceMul: 1.1, share: 0.22, ox: -1, oy: 0 },
    { name: 'General Alta N', slug: 'gen-norte', color: '#7a8fd4', tier: 'economy', priceMul: 0.7, share: 0.16, ox: 0, oy: -1.4 },
    { name: 'General Alta S', slug: 'gen-sur', color: '#b87a9a', tier: 'economy', priceMul: 0.65, share: 0.16, ox: 0, oy: 1.4 },
  ];

  const sections: SeatMapSection[] = [];
  let total = 0;

  for (const trib of tribunes) {
    const want = Math.floor(target * trib.share);
    const rows = Math.max(12, Math.min(40, Math.round(Math.sqrt(want / 18))));
    const cols = Math.ceil(want / rows);
    const seats: SeatMapSeat[] = [];
    let n = 0;
    for (let r = 0; r < rows && n < want; r++) {
      const rowLabel = r < 26 ? String.fromCharCode(65 + r) : `R${r + 1}`;
      for (let c = 0; c < cols && n < want; c++) {
        n += 1;
        const seatNum = c + 1;
        seats.push({
          id: `${prefix}-${trib.slug}-${rowLabel}-${seatNum}`,
          label: `${rowLabel}-${seatNum}`,
          x: Math.round(450 + trib.ox * 280 + (c - cols / 2) * 14),
          y: Math.round(400 + trib.oy * 220 + r * 16),
          rotation: trib.ox !== 0 ? (trib.ox > 0 ? 90 : -90) : 0,
          tier: trib.tier,
          row: rowLabel,
        });
      }
    }
    total += seats.length;
    sections.push({
      id: `${prefix}-sec-${trib.slug}`,
      name: trib.name,
      slug: trib.slug,
      color: trib.color,
      seats,
    });
  }

  const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
  const ys = sections.flatMap((s) => s.seats.map((seat) => seat.y));
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + 40;
  const maxY = Math.max(...ys) + 40;

  void total;
  return {
    version: 3,
    sections,
    viewport: { minX, minY, width: maxX - minX, height: maxY - minY },
    venue: {
      units: 'map',
      scale: 1,
      stage: { x: 350, y: 360, width: 200, elevation: 0 },
    },
  };
}

export const MEGA_ZONE_PRICES: Record<string, number> = {
  'pref-norte': 1850,
  'pref-sur': 1750,
  'lat-este': 980,
  'lat-oeste': 980,
  'gen-norte': 420,
  'gen-sur': 380,
};
