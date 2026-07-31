'use client';

import { memo } from 'react';

export const VenueShell = memo(function VenueShell() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <circleGeometry args={[28, 80]} />
        <meshStandardMaterial color="#050506" roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <circleGeometry args={[15, 72]} />
        <meshStandardMaterial color="#0c0c0e" roughness={0.95} metalness={0.04} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -1.4]} receiveShadow>
        <circleGeometry args={[3.85, 56]} />
        <meshStandardMaterial color="#151518" roughness={0.8} metalness={0.12} />
      </mesh>
      {[2.2, 2.9, 3.55].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -1.4]}>
          <ringGeometry args={[r - 0.02, r, 64]} />
          <meshBasicMaterial color="#2a2a30" transparent opacity={0.55} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[12.1, 13.4, 72]} />
        <meshStandardMaterial color="#09090b" roughness={0.92} />
      </mesh>
      <mesh position={[0, 3.1, 12.2]}>
        <boxGeometry args={[26, 6.2, 0.55]} />
        <meshStandardMaterial color="#0a0a0c" roughness={1} />
      </mesh>
      <mesh position={[-12.5, 2.4, 2]} rotation={[0, 0.35, 0]}>
        <boxGeometry args={[0.45, 5.2, 16]} />
        <meshStandardMaterial color="#0b0b0d" roughness={1} />
      </mesh>
      <mesh position={[12.5, 2.4, 2]} rotation={[0, -0.35, 0]}>
        <boxGeometry args={[0.45, 5.2, 16]} />
        <meshStandardMaterial color="#0b0b0d" roughness={1} />
      </mesh>
    </group>
  );
});
