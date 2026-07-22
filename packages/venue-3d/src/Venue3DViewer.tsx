/// <reference path="./react-three-fiber.d.ts" />
'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { SeatViewCamera } from './SeatViewCamera';

export interface Seat3D {
  id: string;
  x: number;
  y: number;
  z: number;
  status?: 'available' | 'held' | 'sold' | 'blocked';
  color?: string;
}

export interface Venue3DViewerProps {
  selectedSeat?: { x: number; y: number; z: number };
  seats?: Seat3D[];
  mode?: 'orbit' | 'seat';
  className?: string;
  height?: number;
}

function ArenaMesh() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <cylinderGeometry args={[8, 10, 0.3, 48]} />
      <meshStandardMaterial color="#e8e8e8" />
    </mesh>
  );
}

function Stage() {
  return (
    <mesh position={[0, 0.2, -6]}>
      <boxGeometry args={[6, 0.4, 2]} />
      <meshStandardMaterial color="#171717" />
    </mesh>
  );
}

function SeatDots({ seats }: { seats: Seat3D[] }) {
  const statusColor: Record<string, string> = {
    available: '#4c6fff',
    held: '#ffd166',
    sold: '#a3a3a3',
    blocked: '#ff6b6b',
  };

  return (
    <>
      {seats.map((s) => (
        <mesh key={s.id} position={[s.x / 15, s.z / 15 + 0.15, s.y / 15]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial
            color={s.color ?? statusColor[s.status ?? 'available'] ?? '#4c6fff'}
          />
        </mesh>
      ))}
    </>
  );
}

export function Venue3DViewer({
  selectedSeat,
  seats = [],
  mode = 'orbit',
  className,
  height = 420,
}: Venue3DViewerProps) {
  const normalized = useMemo(
    () =>
      seats.slice(0, 800).map((s) => ({
        ...s,
        x: s.x ?? 0,
        y: s.y ?? 0,
        z: s.z ?? 0,
      })),
    [seats],
  );

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height,
        background: '#fafafa',
        borderRadius: 12,
        border: '1px solid #e5e5e5',
        overflow: 'hidden',
      }}
    >
      <Canvas>
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 10, 5]} intensity={1.1} />
        <ArenaMesh />
        <Stage />
        {normalized.length > 0 && <SeatDots seats={normalized} />}
        {mode === 'seat' && selectedSeat ? (
          <SeatViewCamera target={selectedSeat} />
        ) : (
          <>
            <PerspectiveCamera makeDefault position={[0, 8, 12]} />
            <OrbitControls enablePan enableZoom enableRotate />
          </>
        )}
      </Canvas>
    </div>
  );
}
