'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import type { LaidOutSeat } from '../bowlLayout';
import { ChairSeat } from './ChairSeat';
import { INSTANCED_SEAT_THRESHOLD, InstancedSeating } from './InstancedSeating';

type SeatingBowlProps = {
  seats: LaidOutSeat[];
  selectedIds: Set<string>;
  heatBySeat?: Map<string, string> | null;
  /** Layer opacity for chairs (`opacity.seats`). */
  opacity?: number;
  /** Draw the non-interactive filler chairs. */
  showDecorative?: boolean;
  /** Hard cap on decorative chairs, from the quality preset. */
  maxDecorativeSeats?: number;
  /** Seat count at which the instanced path takes over. */
  instancingThreshold?: number;
  lodDistance?: number;
  castShadow?: boolean;
  onToggleSeat?: (id: string) => void;
  onHoverSeat: (seat: LaidOutSeat | null) => void;
};

export const SeatingBowl = memo(function SeatingBowl({
  seats,
  selectedIds,
  heatBySeat,
  opacity = 1,
  showDecorative = true,
  maxDecorativeSeats = Number.POSITIVE_INFINITY,
  instancingThreshold = INSTANCED_SEAT_THRESHOLD,
  lodDistance = Number.POSITIVE_INFINITY,
  castShadow = false,
  onToggleSeat,
  onHoverSeat,
}: SeatingBowlProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const { deco, real } = useMemo(() => {
    const decorative: LaidOutSeat[] = [];
    const interactive: LaidOutSeat[] = [];
    for (const seat of seats) {
      if (seat.decorative) decorative.push(seat);
      else interactive.push(seat);
    }
    return {
      deco: showDecorative ? decorative.slice(0, maxDecorativeSeats) : [],
      real: interactive,
    };
  }, [seats, showDecorative, maxDecorativeSeats]);

  const seatById = useMemo(() => {
    const map = new Map<string, LaidOutSeat>();
    for (const seat of real) map.set(seat.id, seat);
    return map;
  }, [real]);

  const handleHover = useCallback(
    (id: string | null) => {
      setHovered(id);
      onHoverSeat(id ? (seatById.get(id) ?? null) : null);
    },
    [onHoverSeat, seatById],
  );

  const handleClick = useCallback(
    (id: string) => {
      onToggleSeat?.(id);
    },
    [onToggleSeat],
  );

  const useInstanced =
    real.length >= instancingThreshold || deco.length >= instancingThreshold;

  if (useInstanced) {
    return (
      <group>
        <InstancedSeating
          seats={deco}
          selectedIds={selectedIds}
          hoveredId={null}
          interactive={false}
          opacity={opacity}
          lodDistance={lodDistance}
          onHover={() => {}}
          onClick={() => {}}
        />
        <InstancedSeating
          seats={real}
          selectedIds={selectedIds}
          hoveredId={hovered}
          heatBySeat={heatBySeat}
          interactive
          opacity={opacity}
          lodDistance={lodDistance}
          castShadow={castShadow}
          onHover={handleHover}
          onClick={handleClick}
        />
      </group>
    );
  }

  return (
    <group>
      {deco.map((seat) => (
        <ChairSeat
          key={seat.id}
          seat={seat}
          selected={false}
          hovered={false}
          opacity={opacity}
          castShadow={castShadow}
          onHover={() => {}}
          onClick={() => {}}
        />
      ))}
      {real.map((seat) => (
        <ChairSeat
          key={seat.id}
          seat={seat}
          selected={selectedIds.has(seat.id)}
          hovered={hovered === seat.id}
          heatColor={heatBySeat?.get(seat.id)}
          opacity={opacity}
          castShadow={castShadow}
          onHover={handleHover}
          onClick={handleClick}
        />
      ))}
    </group>
  );
});
