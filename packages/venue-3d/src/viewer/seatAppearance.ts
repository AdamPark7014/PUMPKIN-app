import type { LaidOutSeat } from '../bowlLayout';

export function isSeatDisabled(seat: LaidOutSeat): boolean {
  const blockedView = seat.visibility?.blocked || seat.status === 'blocked';
  return (
    seat.status === 'sold' || seat.status === 'held' || seat.status === 'blocked' || blockedView
  );
}

export function seatZoneBase(seat: LaidOutSeat): string {
  if (seat.visibility?.premiumView) return '#d4a017';
  return seat.color || '#5b9fd4';
}

export function seatDisplayColor(
  seat: LaidOutSeat,
  opts: {
    selected: boolean;
    hovered: boolean;
    heatColor?: string | null;
  },
): string {
  if (opts.selected) return '#ffffff';
  if (opts.hovered) return '#fecdd3';
  if (opts.heatColor) return opts.heatColor;
  if (seat.visibility?.restrictedView) return '#94a3b8';
  return seatZoneBase(seat);
}

export function seatBackrestColor(
  seat: LaidOutSeat,
  opts: {
    selected: boolean;
    hovered: boolean;
    heatColor?: string | null;
  },
): string {
  if (opts.selected) return '#fafafa';
  if (opts.hovered) return '#fda4af';
  if (opts.heatColor) return opts.heatColor;
  if (seat.visibility?.restrictedView) return '#94a3b8';
  return seatZoneBase(seat);
}

export function seatLift(selected: boolean, hovered: boolean): number {
  if (selected) return 0.08;
  if (hovered) return 0.045;
  return 0;
}
