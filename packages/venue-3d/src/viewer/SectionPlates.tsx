'use client';

import { memo } from 'react';
import type { SectionPlate } from '../bowlLayout';

const BASE_OPACITY = 0.07;

type SectionPlatesProps = {
  plates: SectionPlate[];
  /** Layer opacity multiplier (`opacity.plates`). */
  opacity?: number;
};

/** Labels live in the HUD legend — avoid overlapping floating text on seats. */
export const SectionPlates = memo(function SectionPlates({
  plates,
  opacity = 1,
}: SectionPlatesProps) {
  if (opacity <= 0) return null;
  return (
    <group>
      {plates.map((p) => (
        <mesh
          key={p.name}
          position={[p.center[0], 0.02, p.center[2]]}
          rotation={[-Math.PI / 2, 0, p.rotY]}
          receiveShadow
        >
          <planeGeometry args={[Math.max(p.width * 0.92, 1), Math.max(p.depth * 0.92, 1)]} />
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={BASE_OPACITY * opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
});
