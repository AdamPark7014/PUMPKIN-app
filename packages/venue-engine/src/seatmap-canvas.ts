/** SVG path helpers for 2D seat rendering */
export function seatCircle(x: number, y: number, r = 6): string {
  return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}

export const SEAT_STATUS_COLORS: Record<string, string> = {
  AVAILABLE: '#fafafa',
  HELD: '#d4d4d4',
  SOLD: '#737373',
  SELECTED: '#171717',
};
