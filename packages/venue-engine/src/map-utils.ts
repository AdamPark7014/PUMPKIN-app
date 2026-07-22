import type { SeatMapData, SeatMapSeat } from '@boletera/shared';

export function findSeatById(map: SeatMapData, seatId: string): SeatMapSeat | undefined {
  for (const section of map.sections) {
    const seat = section.seats.find((s) => s.id === seatId);
    if (seat) return seat;
  }
  return undefined;
}

export function seatToViewCoords(seat: SeatMapSeat): { x: number; y: number; z: number } {
  if (seat.coord3d) return seat.coord3d;
  return { x: seat.x / 100, y: 0.5, z: seat.y / 100 };
}

export function buildAvailabilityMap(
  seats: { id: string; status: string }[],
): Record<string, string> {
  return Object.fromEntries(seats.map((s) => [s.id, s.status]));
}
