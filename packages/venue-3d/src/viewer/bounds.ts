import type { LaidOutSeat } from '../bowlLayout';
import type { Venue3DBounds } from '../types';
import type { StagePose } from './sceneTypes';

/** Fallback used when nothing is laid out yet — roughly one bowl radius. */
export const DEFAULT_BOUNDS: Venue3DBounds = {
  min: { x: -10, y: 0, z: -10 },
  max: { x: 10, y: 4, z: 10 },
  center: { x: 0, y: 1.6, z: 0 },
  radius: 12,
};

type BoundsInput = {
  seats: LaidOutSeat[];
  stagePose?: StagePose;
  stageZ?: number;
  seatIds?: string[] | null;
  includeStage?: boolean;
};

/**
 * World-space bounds of the laid-out scene. Seat geometry is ~0.3u tall, so the
 * box is inflated slightly to avoid framing chairs flush against the viewport.
 */
export function computeBounds({
  seats,
  stagePose,
  stageZ,
  seatIds,
  includeStage = true,
}: BoundsInput): Venue3DBounds {
  const filter = seatIds && seatIds.length ? new Set(seatIds) : null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let count = 0;

  for (const seat of seats) {
    if (filter && !filter.has(seat.id)) continue;
    count += 1;
    if (seat.px < minX) minX = seat.px;
    if (seat.px > maxX) maxX = seat.px;
    if (seat.py < minY) minY = seat.py;
    if (seat.py > maxY) maxY = seat.py;
    if (seat.pz < minZ) minZ = seat.pz;
    if (seat.pz > maxZ) maxZ = seat.pz;
  }

  if (includeStage && !filter) {
    const sx = stagePose?.x ?? 0;
    const sz = stagePose?.z ?? stageZ ?? -6.6;
    const sy = stagePose?.y ?? 0;
    const halfW = (stagePose?.width ?? 8.4) / 2;
    const halfD = (stagePose?.depth ?? 3.1) / 2;
    const reach = Math.max(halfW, halfD);
    count += 1;
    minX = Math.min(minX, sx - reach);
    maxX = Math.max(maxX, sx + reach);
    minZ = Math.min(minZ, sz - reach);
    maxZ = Math.max(maxZ, sz + reach);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy + 3.6);
  }

  if (!count || !Number.isFinite(minX)) return DEFAULT_BOUNDS;

  // Chairs are ~0.3u tall and 0.26u wide; pad so the frame never clips them.
  const pad = 0.6;
  minX -= pad;
  minZ -= pad;
  maxX += pad;
  maxZ += pad;
  maxY += 0.4;

  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
  const radius =
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 || DEFAULT_BOUNDS.radius;

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center,
    radius,
  };
}

/**
 * Distance at which a sphere of `radius` fits inside both the vertical and the
 * horizontal frustum of a perspective camera.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, padding = 1.15): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.2));
  const distV = radius / Math.max(Math.tan(vFov / 2), 0.05);
  const distH = radius / Math.max(Math.tan(hFov / 2), 0.05);
  return Math.max(distV, distH) * padding;
}
