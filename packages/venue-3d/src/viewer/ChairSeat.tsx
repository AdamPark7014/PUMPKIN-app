'use client';

import { memo } from 'react';
import type { LaidOutSeat } from '../bowlLayout';
import {
  isSeatDisabled,
  seatBackrestColor,
  seatDisplayColor,
  seatLift,
} from './seatAppearance';

type ChairSeatProps = {
  seat: LaidOutSeat;
  selected: boolean;
  hovered: boolean;
  heatColor?: string | null;
  /** Host-controlled layer opacity (`opacity.seats`). */
  opacity?: number;
  castShadow?: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
};

export const ChairSeat = memo(function ChairSeat({
  seat,
  selected,
  hovered,
  heatColor,
  opacity = 1,
  castShadow = true,
  onHover,
  onClick,
}: ChairSeatProps) {
  if (seat.decorative) {
    const decoTransparent = opacity < 1;
    return (
      <group
        position={[seat.px, seat.py, seat.pz]}
        rotation={[seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0]}
        raycast={() => null}
      >
        <mesh position={[0, 0.05, 0]} raycast={() => null}>
          <boxGeometry args={[0.2, 0.08, 0.22]} />
          <meshStandardMaterial
            color={seat.color || '#1f1f23'}
            roughness={0.95}
            transparent={decoTransparent}
            opacity={opacity}
          />
        </mesh>
        <mesh position={[0, 0.14, 0.08]} raycast={() => null}>
          <boxGeometry args={[0.2, 0.16, 0.05]} />
          <meshStandardMaterial
            color={seat.color || '#1a1a1e'}
            roughness={0.95}
            transparent={decoTransparent}
            opacity={opacity}
          />
        </mesh>
      </group>
    );
  }

  const disabled = isSeatDisabled(seat);
  const color = seatDisplayColor(seat, { selected, hovered, heatColor });
  const backColor = seatBackrestColor(seat, { selected, hovered, heatColor });
  const lift = seatLift(selected, hovered);
  const seatOpacity = disabled ? 0.28 * opacity : opacity;
  const transparent = seatOpacity < 1;

  return (
    <group
      position={[seat.px, seat.py + lift, seat.pz]}
      rotation={[seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onHover(seat.id);
          document.body.style.cursor = 'pointer';
        }
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = 'auto';
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick(seat.id);
      }}
    >
      <mesh castShadow={castShadow} position={[0, 0.055, 0.015]}>
        <boxGeometry args={[0.26, 0.08, 0.24]} />
        <meshStandardMaterial
          color={color}
          emissive={selected ? '#9f1239' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
          roughness={0.55}
          metalness={0.08}
          opacity={seatOpacity}
          transparent={transparent}
        />
      </mesh>
      <mesh castShadow={castShadow} position={[0, 0.16, 0.09]}>
        <boxGeometry args={[0.26, 0.18, 0.05]} />
        <meshStandardMaterial
          color={backColor}
          roughness={0.6}
          metalness={0.06}
          opacity={seatOpacity}
          transparent={transparent}
        />
      </mesh>
    </group>
  );
});
