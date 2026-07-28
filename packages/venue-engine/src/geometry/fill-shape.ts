import type { SeatMapSeat, SeatMapShape } from '@boletera/shared';
import { generateBlock } from './generators';

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  if (points.length < 3) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type FillShapeOptions = {
  shape: SeatMapShape;
  seatPitch: number;
  rowPitch: number;
  rake?: number;
  elevation?: number;
  yaw?: number;
  idPrefix?: string;
  tier?: string;
  /** Margin inset from polygon edge */
  inset?: number;
  startRowLabel?: string;
};

/**
 * Fill a section polygon with a regular seating grid, keeping only seats inside the shape.
 * Rows march in +Y (depth); seats along +X — then filtered by point-in-polygon.
 */
export function fillShapeWithSeats(opts: FillShapeOptions): SeatMapSeat[] {
  const {
    shape,
    seatPitch,
    rowPitch,
    rake = 0,
    elevation = 0,
    yaw = 0,
    idPrefix = `fill-${Date.now()}`,
    tier = 'standard',
    inset = seatPitch * 0.35,
    startRowLabel = 'A',
  } = opts;

  const pts = shape.points;
  if (!pts?.length) return [];

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) + inset;
  const maxX = Math.max(...xs) - inset;
  const minY = Math.min(...ys) + inset;
  const maxY = Math.max(...ys) - inset;
  if (maxX <= minX || maxY <= minY) return [];

  const cols = Math.max(1, Math.floor((maxX - minX) / seatPitch) + 1);
  const rows = Math.max(1, Math.floor((maxY - minY) / rowPitch) + 1);
  const origin = {
    x: minX + ((cols - 1) * seatPitch) / 2,
    y: minY,
  };

  const generated = generateBlock({
    id: idPrefix,
    origin,
    rows,
    seatsPerRow: cols,
    seatPitch,
    rowPitch,
    rake,
    yaw,
    facing: yaw,
    elevation,
    startRowLabel,
    tier,
  });

  return generated
    .filter((s) => pointInPolygon(s.x, s.y, pts))
    .map((s, i) => ({
      ...s,
      id: `${idPrefix}-${s.row ?? 'R'}-${i + 1}`,
    }));
}
