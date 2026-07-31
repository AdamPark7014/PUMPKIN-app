import { buildDecorativeBowl } from './decorative';
import { wedgeLayout } from './wedge';
import type { BowlSeat, LaidOutSeat, SectionPlate } from './types';

export function layoutSeatsInBowl(
  seats: BowlSeat[],
  opts?: { maxSeats?: number },
): {
  seats: LaidOutSeat[];
  plates: SectionPlate[];
} {
  const max = opts?.maxSeats ?? 900;
  const list = seats.slice(0, max);
  if (!list.length) {
    return { seats: buildDecorativeBowl(), plates: [] };
  }

  const bySection = new Map<string, BowlSeat[]>();
  for (const s of list) {
    const key = s.section || 'General';
    const arr = bySection.get(key) ?? [];
    arr.push(s);
    bySection.set(key, arr);
  }

  const { seats: laid, plates } = wedgeLayout(bySection);
  laid.push(...buildDecorativeBowl({ dim: true, skipInner: 2 }));
  return { seats: laid, plates };
}
