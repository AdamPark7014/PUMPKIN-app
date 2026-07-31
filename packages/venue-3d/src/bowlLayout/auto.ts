import { layoutSeatsInBowl } from './bowl';
import { layoutSeatsFromPublished } from './published';
import { EMPTY_EXTRAS, type BowlSeat, type LayoutGeometryOpts } from './types';

export type LayoutSeatsAutoOpts = LayoutGeometryOpts & {
  /**
   * `published` — geometry engine only.
   * `bowl` — demo wedge (explicit opt-in).
   * `auto` — use authored plan coords whenever present; bowl only if no usable XY.
   */
  mode?: 'published' | 'bowl' | 'auto';
};

export function layoutSeatsAuto(seats: BowlSeat[], opts?: LayoutSeatsAutoOpts) {
  const mode = opts?.mode ?? 'auto';
  if (mode === 'bowl') return { ...layoutSeatsInBowl(seats, opts), stageZ: -6.6, ...EMPTY_EXTRAS };
  if (mode === 'published') return layoutSeatsFromPublished(seats, opts);

  // auto: never invent a wedge when the map already has plan coordinates
  const list = seats.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (list.length >= 1) return layoutSeatsFromPublished(seats, opts);
  return { ...layoutSeatsInBowl(seats, opts), stageZ: -6.6, ...EMPTY_EXTRAS };
}
