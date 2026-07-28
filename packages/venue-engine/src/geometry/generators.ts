import type { SeatMapBlock, SeatMapSeat } from '@boletera/shared';

export type StraightRowOptions = {
  origin: { x: number; y: number };
  count: number;
  seatPitch: number;
  /** Yaw degrees — facing direction of the row */
  yaw?: number;
  elevation?: number;
  /** Pitch degrees applied as rotation3d.x */
  pitch?: number;
  rowLabel?: string;
  idPrefix?: string;
  startNumber?: number;
  tier?: string;
};

export type CurvedRowOptions = {
  center: { x: number; y: number };
  radius: number;
  count: number;
  /** Angular span in radians; if omitted, derived from seatPitch along arc */
  span?: number;
  startAngle?: number;
  seatPitch?: number;
  elevation?: number;
  rake?: number;
  rowLabel?: string;
  idPrefix?: string;
  startNumber?: number;
  tier?: string;
  /** Vertical squash of arc (theater foreshortening); 1 = circle */
  yScale?: number;
  /** Extra facing offset in degrees */
  facingOffset?: number;
};

export type BlockOptions = SeatMapBlock & {
  idPrefix?: string;
  skipColumns?: number[];
  /** Visual facing degrees; defaults to `yaw` (layout orientation) */
  facing?: number;
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function rowLabelFromIndex(start: string | undefined, index: number): string {
  if (!start) return String.fromCharCode(65 + (index % 26));
  const code = start.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code + index);
  return `${start}${index + 1}`;
}

/** Generate a straight row of seats with consistent spacing (no overlaps). */
export function generateStraightRow(opts: StraightRowOptions): SeatMapSeat[] {
  const {
    origin,
    count,
    seatPitch,
    yaw = 0,
    elevation = 0,
    pitch = 0,
    rowLabel = 'A',
    idPrefix = 'row',
    startNumber = 1,
    tier,
  } = opts;
  const rad = degToRad(yaw);
  // Along-row axis for yaw=0 is +X (stage at low Y / north)
  const alongX = Math.cos(rad);
  const alongY = Math.sin(rad);
  const seats: SeatMapSeat[] = [];
  const half = ((count - 1) * seatPitch) / 2;

  for (let i = 0; i < count; i++) {
    const offset = -half + i * seatPitch;
    const x = origin.x + alongX * offset;
    const y = origin.y + alongY * offset;
    const n = startNumber + i;
    seats.push({
      id: `${idPrefix}-${rowLabel}-${n}`,
      label: `${rowLabel}-${n}`,
      row: rowLabel,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rotation: yaw,
      tier,
      elevation,
      position: { x, y: elevation, z: y },
      rotation3d: { x: pitch, y: yaw, z: 0 },
      coord3d: { x, y: elevation, z: y, pitch, roll: 0 },
    });
  }
  return seats;
}

/** Generate a curved row facing the arc center (bowl / theater). */
export function generateCurvedRow(opts: CurvedRowOptions): SeatMapSeat[] {
  const {
    center,
    radius,
    count,
    seatPitch = 22,
    elevation = 0,
    rake = 0,
    rowLabel = 'A',
    idPrefix = 'arc',
    startNumber = 1,
    tier,
    yScale = 1,
    facingOffset = 0,
  } = opts;

  const arcLen = Math.max(0.01, count > 1 ? (count - 1) * seatPitch : seatPitch);
  const span = opts.span ?? arcLen / Math.max(radius, 1);
  const startAngle = opts.startAngle ?? -span / 2 - Math.PI / 2;
  const seats: SeatMapSeat[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = startAngle + t * span;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius * yScale;
    const yaw = ((angle + Math.PI / 2) * 180) / Math.PI + facingOffset;
    const elev = elevation + rake;
    const n = startNumber + i;
    seats.push({
      id: `${idPrefix}-${rowLabel}-${n}`,
      label: `${rowLabel}-${n}`,
      row: rowLabel,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rotation: yaw,
      tier,
      elevation: elev,
      position: { x, y: elev, z: y },
      rotation3d: { x: 0, y: yaw, z: 0 },
      coord3d: { x, y: elev, z: y },
    });
  }
  return seats;
}

/**
 * Generate a rectangular or gently curved seating block with rake.
 * Curvature > 0 pulls mid-row seats toward -Y (stage-forward) using a parabolic bias.
 */
export function generateBlock(opts: BlockOptions): SeatMapSeat[] {
  const {
    id,
    origin,
    rows,
    seatsPerRow,
    seatPitch,
    rowPitch,
    rake = 0,
    curvature = 0,
    yaw = 0,
    elevation = 0,
    startRowLabel,
    tier,
    idPrefix,
    skipColumns = [],
    facing,
  } = opts;

  const prefix = idPrefix ?? id;
  const faceDeg = facing ?? yaw;
  const rad = degToRad(yaw);
  const alongX = Math.cos(rad);
  const alongY = Math.sin(rad);
  const depthX = -Math.sin(rad);
  const depthY = Math.cos(rad);
  const seats: SeatMapSeat[] = [];
  const skip = new Set(skipColumns);

  for (let r = 0; r < rows; r++) {
    const rowLabel = rowLabelFromIndex(startRowLabel, r);
    const elev = elevation + r * rake;
    const pitch = rake > 0 ? Math.min(18, rake * 2.2) : 0;
    const half = ((seatsPerRow - 1) * seatPitch) / 2;

    for (let c = 0; c < seatsPerRow; c++) {
      if (skip.has(c)) continue;
      const lateral = -half + c * seatPitch;
      const midT = seatsPerRow === 1 ? 0 : (c / (seatsPerRow - 1) - 0.5) * 2;
      const curveBias = curvature > 0 ? midT * midT * curvature * (r + 1) * 0.35 : 0;
      const x = origin.x + alongX * lateral + depthX * (r * rowPitch + curveBias);
      const y = origin.y + alongY * lateral + depthY * (r * rowPitch + curveBias);
      const n = c + 1;
      seats.push({
        id: `${prefix}-${rowLabel}-${n}`,
        label: `${rowLabel}-${n}`,
        row: rowLabel,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        rotation: faceDeg,
        tier: tier ?? (r < 2 ? 'premium' : r >= rows - 2 ? 'economy' : 'standard'),
        elevation: elev,
        position: { x, y: elev, z: y },
        rotation3d: { x: pitch, y: faceDeg, z: 0 },
        coord3d: { x, y: elev, z: y, pitch, roll: 0 },
      });
    }
  }
  return seats;
}
