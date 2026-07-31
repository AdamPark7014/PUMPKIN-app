'use client';

import { memo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import type { StagePose } from './sceneTypes';

type StageBlockProps = {
  z?: number;
  pose?: StagePose;
  /** Enables shadow casting for the stage rig; driven by the quality preset. */
  shadows?: boolean;
};

export const StageBlock = memo(function StageBlock({
  z = -6.6,
  pose,
  shadows = false,
}: StageBlockProps) {
  const width = pose?.width ?? 8.4;
  const depth = pose?.depth ?? 3.1;
  const px = pose?.x ?? 0;
  const py = pose?.y ?? 0;
  const pz = pose?.z ?? z;
  const rotY = pose?.rotation ?? 0;

  return (
    <group position={[px, py, pz]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.28, 0.2]} castShadow={shadows}>
        <boxGeometry args={[Math.max(width, 4), 0.55, Math.max(depth, 2)]} />
        <meshStandardMaterial color="#141416" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <boxGeometry args={[Math.max(width * 0.9, 3.5), 0.08, Math.max(depth * 0.75, 1.6)]} />
        <meshStandardMaterial
          color="#9f1239"
          emissive="#7f1d1d"
          emissiveIntensity={0.22}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 2.4, -Math.max(depth * 0.45, 1.2)]}>
        <boxGeometry args={[Math.max(width * 1.08, 6), 3.6, 0.2]} />
        <meshStandardMaterial
          color="#120810"
          emissive="#4c0519"
          emissiveIntensity={0.28}
          roughness={0.45}
        />
      </mesh>
      {[-width * 0.55, width * 0.55].map((x) => (
        <mesh key={x} position={[x, 1.4, -0.4]} castShadow={shadows}>
          <boxGeometry args={[0.7, 2.2, 0.7]} />
          <meshStandardMaterial color="#0f0f12" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[-2.2, 3.8, 0.4]} rotation={[0.35, 0, 0.15]}>
        <coneGeometry args={[1.1, 4.2, 24, 1, true]} />
        <meshBasicMaterial color="#fda4af" transparent opacity={0.045} depthWrite={false} />
      </mesh>
      <mesh position={[2.2, 3.8, 0.4]} rotation={[0.35, 0, -0.15]}>
        <coneGeometry args={[1.1, 4.2, 24, 1, true]} />
        <meshBasicMaterial color="#fda4af" transparent opacity={0.045} depthWrite={false} />
      </mesh>
      <spotLight
        position={[0, 8, -1]}
        angle={0.5}
        penumbra={0.6}
        intensity={42}
        color="#fff7ed"
        castShadow={shadows}
      />
      <pointLight position={[0, 2.8, -4.5]} intensity={10} color="#fb7185" distance={16} />
      <Billboard position={[0, 1.55, 0.7]} follow lockX={false} lockY={false} lockZ={false}>
        <Text
          fontSize={0.34}
          color="#f5f5f4"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.018}
          outlineColor="#0a0a0a"
          letterSpacing={0.16}
        >
          ESCENARIO
        </Text>
      </Billboard>
    </group>
  );
});
