'use client';

import { memo } from 'react';
import { Line } from '@react-three/drei';
import type { EgressOverlayScene3D } from '@boletera/venue-engine';

type EgressPathOverlaysProps = {
  overlay: EgressOverlayScene3D | null;
  highlightSection?: string | null;
};

export const EgressPathOverlays = memo(function EgressPathOverlays({
  overlay,
  highlightSection,
}: EgressPathOverlaysProps) {
  if (!overlay) return null;
  return (
    <group>
      {overlay.paths.map((path) => {
        if (path.points.length < 2) return null;
        const active =
          Boolean(highlightSection) &&
          (path.sectionName === highlightSection || path.sectionId === highlightSection);
        return (
          <Line
            key={`egress-${path.sectionId}`}
            points={path.points}
            color={active ? '#f472b6' : '#f9a8d4'}
            lineWidth={active ? 3.5 : 1.8}
            transparent
            opacity={active ? 0.95 : 0.45}
            dashed
            dashSize={active ? 0.35 : 0.22}
            gapSize={active ? 0.18 : 0.16}
            depthWrite={false}
          />
        );
      })}
      {overlay.bottlenecks.map((b) => {
        if (b.points.length < 2) return null;
        return (
          <Line
            key={`bn-${b.edgeId}`}
            points={b.points}
            color="#fb923c"
            lineWidth={5}
            transparent
            opacity={0.88}
            depthWrite={false}
          />
        );
      })}
    </group>
  );
});
