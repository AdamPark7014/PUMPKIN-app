/// <reference path="./react-three-fiber.d.ts" />
'use client';

import {
  useMemo,
  useState,
  useCallback,
  useRef,
  type CSSProperties,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  OrbitControls,
  PerspectiveCamera,
  Billboard,
  Text,
  Line,
} from '@react-three/drei';
import { SeatViewCamera } from './SeatViewCamera';
import {
  layoutSeatsAuto,
  sectionColor,
  type BowlSeat,
  type LaidOutSeat,
  type SectionPlate,
} from './bowlLayout';
import {
  calculateSightlines,
  priceHeatColor,
  projectEgressOverlaysTo3D,
  resolveGeometry,
  sightlineHeatColor,
  type EgressOverlayScene3D,
} from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import styles from './Venue3DViewer.module.css';

export type Venue3DHeatMode = 'off' | 'price' | 'view';

export interface Seat3D extends BowlSeat {
  x: number;
  y: number;
  z: number;
}

export interface Venue3DViewerProps {
  selectedSeat?: { x: number; y: number; z: number };
  seats?: Seat3D[];
  selectedIds?: string[];
  onToggleSeat?: (seatId: string) => void;
  mode?: 'orbit' | 'seat';
  className?: string;
  height?: number;
  currency?: string;
  /** Authored stage position/width from the 2D designer, used to center the 3D projection. */
  stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
  aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
  obstacles?: {
    id: string;
    type: string;
    points: [number, number][];
    height?: number;
    levelId?: string;
  }[];
  stairs?: {
    id: string;
    kind?: string;
    points: [number, number][];
    width?: number;
    fromLevelId?: string;
    toLevelId?: string;
  }[];
  exits?: {
    id: string;
    points: [number, number][];
    width?: number;
    label?: string;
    levelId?: string;
  }[];
  furniture?: {
    id: string;
    type: string;
    x: number;
    y: number;
    rotation?: number;
    levelId?: string;
  }[];
  focusPoints?: { id: string; label?: string; x: number; y: number; z?: number; levelId?: string }[];
  /** Multi-level venue filter chips (same ids as map.venue.levels). */
  levels?: { id: string; name: string; elevation?: number; zIndex?: number }[];
  /** Full map for egress path overlays (same geometry as 2D Salidas) + view heat. */
  mapData?: SeatMapData | null;
  /**
   * Initial heat mode when uncontrolled.
   * `true` → price (same as SeatMapViewer.heatDefault).
   */
  heatDefault?: boolean | Venue3DHeatMode;
  /** Controlled heat mode (omit for internal state). */
  heatMode?: Venue3DHeatMode;
  onHeatModeChange?: (mode: Venue3DHeatMode) => void;
}

function resolveHeatDefault(heatDefault?: boolean | Venue3DHeatMode): Venue3DHeatMode {
  if (heatDefault === true || heatDefault === 'price') return 'price';
  if (heatDefault === 'view') return 'view';
  return 'off';
}

function VenueShell() {
  return (
    <group>
      {/* Deep opaque ground — prevents “underfloor” void if camera dips */}
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
      {/* GA ring lines */}
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
      {/* Upper bowl wall */}
      <mesh position={[0, 3.1, 12.2]}>
        <boxGeometry args={[26, 6.2, 0.55]} />
        <meshStandardMaterial color="#0a0a0c" roughness={1} />
      </mesh>
      {/* Side wings */}
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
}

function StageBlock({
  z = -6.6,
  pose,
}: {
  z?: number;
  pose?: {
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    rotation: number;
  };
}) {
  const width = pose?.width ?? 8.4;
  const depth = pose?.depth ?? 3.1;
  const px = pose?.x ?? 0;
  const py = pose?.y ?? 0;
  const pz = pose?.z ?? z;
  const rotY = pose?.rotation ?? 0;

  return (
    <group position={[px, py, pz]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.28, 0.2]} castShadow>
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
      {/* LED wall */}
      <mesh position={[0, 2.4, -Math.max(depth * 0.45, 1.2)]}>
        <boxGeometry args={[Math.max(width * 1.08, 6), 3.6, 0.2]} />
        <meshStandardMaterial
          color="#120810"
          emissive="#4c0519"
          emissiveIntensity={0.28}
          roughness={0.45}
        />
      </mesh>
      {/* Speakers */}
      {[-width * 0.55, width * 0.55].map((x) => (
        <mesh key={x} position={[x, 1.4, -0.4]} castShadow>
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
        castShadow
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
}

function polylineCenter(points: [number, number, number][]) {
  if (!points.length) return [0, 0, 0] as [number, number, number];
  const sx = points.reduce((n, p) => n + p[0], 0) / points.length;
  const sy = points.reduce((n, p) => n + p[1], 0) / points.length;
  const sz = points.reduce((n, p) => n + p[2], 0) / points.length;
  return [sx, sy, sz] as [number, number, number];
}

function GeometryOverlays({
  aisles,
  obstacles,
  stairs,
  exits,
  furniture,
  focusPoints,
}: {
  aisles: Array<{ id: string; points: [number, number, number][]; width?: number }>;
  obstacles: Array<{
    id: string;
    type: string;
    points: [number, number, number][];
    height: number;
  }>;
  stairs?: Array<{ id: string; kind: string; points: [number, number, number][]; width?: number }>;
  exits?: Array<{
    id: string;
    label?: string;
    points: [number, number, number][];
    width?: number;
  }>;
  furniture?: Array<{
    id: string;
    type: string;
    label?: string;
    position: [number, number, number];
    rotation?: number;
  }>;
  focusPoints?: Array<{
    id: string;
    label?: string;
    position: [number, number, number];
    levelId?: string;
  }>;
}) {
  return (
    <group>
      {aisles.map((aisle) => {
        if (aisle.points.length < 2) return null;
        // World units: map width defaults ~24u → ~0.55m corridor when scale≈40 in engine
        const corridorW = Math.max(0.25, Math.min(2.4, (aisle.width ?? 24) * 0.025));
        return (
          <group key={aisle.id}>
            {aisle.points.slice(0, -1).map((a, i) => {
              const b = aisle.points[i + 1];
              const dx = b[0] - a[0];
              const dz = b[2] - a[2];
              const len = Math.hypot(dx, dz) || 0.01;
              const midX = (a[0] + b[0]) / 2;
              const midZ = (a[2] + b[2]) / 2;
              const rotY = Math.atan2(dx, dz);
              return (
                <mesh
                  key={`${aisle.id}-${i}`}
                  position={[midX, 0.03, midZ]}
                  rotation={[-Math.PI / 2, 0, -rotY]}
                  receiveShadow
                >
                  <planeGeometry args={[Math.max(len, 0.2), corridorW]} />
                  <meshBasicMaterial color="#64748b" transparent opacity={0.28} depthWrite={false} />
                </mesh>
              );
            })}
          </group>
        );
      })}
      {(stairs ?? []).map((stair) => {
        if (stair.points.length < 2) return null;
        const stairW = Math.max(0.35, Math.min(2.8, (stair.width ?? 28) * 0.025));
        return (
          <group key={stair.id}>
            {stair.points.slice(0, -1).map((a, i) => {
              const b = stair.points[i + 1];
              const dx = b[0] - a[0];
              const dz = b[2] - a[2];
              const len = Math.hypot(dx, dz) || 0.01;
              const midX = (a[0] + b[0]) / 2;
              const midZ = (a[2] + b[2]) / 2;
              const rotY = Math.atan2(dx, dz);
              const stepY = 0.06 + i * 0.05;
              return (
                <mesh
                  key={`${stair.id}-${i}`}
                  position={[midX, stepY, midZ]}
                  rotation={[0, rotY, 0]}
                  castShadow
                >
                  <boxGeometry args={[stairW, 0.08, Math.max(len, 0.25)]} />
                  <meshStandardMaterial color="#ea580c" roughness={0.7} metalness={0.1} />
                </mesh>
              );
            })}
          </group>
        );
      })}
      {(exits ?? []).map((exit) => {
        if (!exit.points.length) return null;
        const p = exit.points[0];
        const doorW = Math.max(0.45, Math.min(2.2, (exit.width ?? 32) * 0.03));
        return (
          <group key={exit.id} position={[p[0], 0, p[2]]}>
            <mesh position={[0, 1.05, 0]} castShadow>
              <boxGeometry args={[doorW, 2.1, 0.12]} />
              <meshStandardMaterial color="#16a34a" emissive="#14532d" emissiveIntensity={0.35} roughness={0.55} />
            </mesh>
            <mesh position={[0, 2.25, 0]}>
              <boxGeometry args={[doorW * 1.05, 0.18, 0.14]} />
              <meshStandardMaterial color="#bbf7d0" roughness={0.4} />
            </mesh>
            <Billboard position={[0, 2.6, 0]}>
              <Text fontSize={0.28} color="#bbf7d0" anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#052e16">
                {exit.label ?? 'Salida'}
              </Text>
            </Billboard>
          </group>
        );
      })}
      {(furniture ?? []).map((item) => {
        const [x, y, z] = item.position;
        const rotY = ((item.rotation ?? 0) * Math.PI) / 180;
        if (item.type === 'led') {
          return (
            <group key={item.id} position={[x, y, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow>
                <boxGeometry args={[2.4, 1.1, 0.12]} />
                <meshStandardMaterial
                  color="#0ea5e9"
                  emissive="#0369a1"
                  emissiveIntensity={0.55}
                  roughness={0.35}
                  metalness={0.2}
                />
              </mesh>
              <Billboard position={[0, 0.85, 0]}>
                <Text fontSize={0.22} color="#e0f2fe" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#0c4a6e">
                  LED
                </Text>
              </Billboard>
            </group>
          );
        }
        if (item.type === 'speaker') {
          return (
            <group key={item.id} position={[x, y, z]} rotation={[0, rotY, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.55, 0.9, 0.45]} />
                <meshStandardMaterial color="#27272a" roughness={0.65} metalness={0.25} />
              </mesh>
              <mesh position={[0, 0.15, 0.2]}>
                <cylinderGeometry args={[0.18, 0.18, 0.08, 20]} />
                <meshStandardMaterial color="#52525b" roughness={0.5} />
              </mesh>
              <Billboard position={[0, 0.7, 0]}>
                <Text fontSize={0.2} color="#d4d4d8" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#18181b">
                  Altavoz
                </Text>
              </Billboard>
            </group>
          );
        }
        // door / default
        return (
          <group key={item.id} position={[x, 0, z]} rotation={[0, rotY, 0]}>
            <mesh position={[0, 1.0, 0]} castShadow>
              <boxGeometry args={[0.9, 2.0, 0.1]} />
              <meshStandardMaterial color="#a16207" emissive="#713f12" emissiveIntensity={0.25} roughness={0.6} />
            </mesh>
            <Billboard position={[0, 2.25, 0]}>
              <Text fontSize={0.22} color="#fde68a" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#422006">
                {item.label ?? 'Puerta'}
              </Text>
            </Billboard>
          </group>
        );
      })}
      {(focusPoints ?? []).map((fp) => {
        const [x, y, z] = fp.position;
        return (
          <group key={fp.id} position={[x, y, z]}>
            <mesh>
              <octahedronGeometry args={[0.28, 0]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#b45309"
                emissiveIntensity={0.45}
                roughness={0.35}
                metalness={0.15}
              />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshBasicMaterial color="#fef3c7" />
            </mesh>
            <Billboard position={[0, 0.55, 0]}>
              <Text fontSize={0.24} color="#fef3c7" anchorX="center" anchorY="middle" outlineWidth={0.018} outlineColor="#78350f">
                {fp.label ?? 'Foco'}
              </Text>
            </Billboard>
          </group>
        );
      })}
      {obstacles.map((obs) => {
        if (obs.points.length < 3) return null;
        const [cx, , cz] = polylineCenter(obs.points);
        const xs = obs.points.map((p) => p[0]);
        const zs = obs.points.map((p) => p[2]);
        const w = Math.max(Math.max(...xs) - Math.min(...xs), 0.6);
        const d = Math.max(Math.max(...zs) - Math.min(...zs), 0.6);
        const h = Math.min(Math.max(obs.height * 0.01, 0.6), 3.5);
        return (
          <mesh key={obs.id} position={[cx, h / 2, cz]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#3f3f46" roughness={0.85} metalness={0.05} transparent opacity={0.72} />
          </mesh>
        );
      })}
    </group>
  );
}

function EgressPathOverlays({
  overlay,
  highlightSection,
}: {
  overlay: EgressOverlayScene3D | null;
  highlightSection?: string | null;
}) {
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
}

/** Labels live in the HUD legend — avoid overlapping floating text on seats. */
function SectionPlates({ plates }: { plates: SectionPlate[] }) {
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
          <meshBasicMaterial color={p.color} transparent opacity={0.07} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const MIN_CAM_Y = 3.4;

function ConstrainedOrbit({
  stageZ,
  autoOrbit,
  onUserInteract,
}: {
  stageZ: number;
  autoOrbit: boolean;
  onUserInteract: () => void;
}) {
  // `any` here: drei's OrbitControls imperative handle type doesn't line up cleanly
  // with the minimal {object, update} shape this clamp actually needs.
  const ref = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  useFrame(() => {
    const ctrl = ref.current as { object: { position: { y: number } }; update: () => void } | null;
    if (!ctrl) return;
    const cam = ctrl.object;
    if (cam.position.y < MIN_CAM_Y) {
      cam.position.y = MIN_CAM_Y;
      ctrl.update();
    }
  });

  return (
    <OrbitControls
      ref={ref}
      enablePan={false}
      // Stay above the horizon so we never look under the floor.
      minPolarAngle={0.55}
      maxPolarAngle={Math.PI / 2.35}
      minDistance={8}
      maxDistance={22}
      target={[0, 1.6, stageZ * 0.28]}
      enableDamping
      dampingFactor={0.07}
      autoRotate={autoOrbit}
      autoRotateSpeed={0.55}
      onStart={onUserInteract}
    />
  );
}

function ChairSeat({
  seat,
  selected,
  hovered,
  heatColor,
  onHover,
  onClick,
}: {
  seat: LaidOutSeat;
  selected: boolean;
  hovered: boolean;
  heatColor?: string | null;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  if (seat.decorative) {
    return (
      <group position={[seat.px, seat.py, seat.pz]} rotation={[seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0]} raycast={() => null}>
        <mesh position={[0, 0.05, 0]} raycast={() => null}>
          <boxGeometry args={[0.2, 0.08, 0.22]} />
          <meshStandardMaterial color={seat.color || '#1f1f23'} roughness={0.95} />
        </mesh>
        {/* Backrest at local +Z — same facing as interactive chairs */}
        <mesh position={[0, 0.14, 0.08]} raycast={() => null}>
          <boxGeometry args={[0.2, 0.16, 0.05]} />
          <meshStandardMaterial color={seat.color || '#1a1a1e'} roughness={0.95} />
        </mesh>
      </group>
    );
  }

  const blockedView = seat.visibility?.blocked || seat.status === 'blocked';
  const restricted = seat.visibility?.restrictedView;
  const disabled =
    seat.status === 'sold' || seat.status === 'blocked' || seat.status === 'held' || blockedView;
  const zoneBase = seat.visibility?.premiumView
    ? '#d4a017'
    : seat.color || '#5b9fd4';
  const base = heatColor || (restricted ? '#94a3b8' : zoneBase);
  const color = selected ? '#ffffff' : hovered ? '#fecdd3' : base;
  const lift = selected ? 0.08 : hovered ? 0.045 : 0;

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
      <mesh castShadow position={[0, 0.055, 0.015]}>
        <boxGeometry args={[0.26, 0.08, 0.24]} />
        <meshStandardMaterial
          color={color}
          emissive={selected ? '#9f1239' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
          roughness={0.55}
          metalness={0.08}
          opacity={disabled ? 0.28 : 1}
          transparent={disabled}
        />
      </mesh>
      {/* Backrest behind the sitter (local +Z); layout aims local +Z toward stage */}
      <mesh castShadow position={[0, 0.16, 0.09]}>
        <boxGeometry args={[0.26, 0.18, 0.05]} />
        <meshStandardMaterial
          color={selected ? '#fafafa' : hovered ? '#fda4af' : base}
          roughness={0.6}
          metalness={0.06}
          opacity={disabled ? 0.28 : 1}
          transparent={disabled}
        />
      </mesh>
    </group>
  );
}

function SeatingBowl({
  seats,
  selectedIds,
  heatBySeat,
  onToggleSeat,
  onHoverSeat,
}: {
  seats: LaidOutSeat[];
  selectedIds: Set<string>;
  heatBySeat?: Map<string, string> | null;
  onToggleSeat?: (id: string) => void;
  onHoverSeat: (seat: LaidOutSeat | null) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const handleHover = useCallback(
    (id: string | null) => {
      setHovered(id);
      onHoverSeat(id ? seats.find((s) => s.id === id) ?? null : null);
    },
    [onHoverSeat, seats],
  );

  const deco = seats.filter((s) => s.decorative);
  const real = seats.filter((s) => !s.decorative);

  return (
    <group>
      {deco.map((seat) => (
        <ChairSeat key={seat.id} seat={seat} selected={false} hovered={false} onHover={() => {}} onClick={() => {}} />
      ))}
      {real.map((seat) => (
        <ChairSeat
          key={seat.id}
          seat={seat}
          selected={selectedIds.has(seat.id)}
          hovered={hovered === seat.id}
          heatColor={heatBySeat?.get(seat.id)}
          onHover={handleHover}
          onClick={(id) => onToggleSeat?.(id)}
        />
      ))}
    </group>
  );
}

function Scene({
  seats,
  plates,
  stageZ = -6.6,
  stagePose,
  aisles,
  obstacles,
  stairs,
  exits,
  furniture,
  focusPoints,
  egressOverlay,
  highlightEgressSection,
  selectedIds,
  heatBySeat,
  onToggleSeat,
  onHoverSeat,
  mode,
  selectedSeat,
  autoOrbit,
  onUserInteract,
}: {
  seats: LaidOutSeat[];
  plates: SectionPlate[];
  stageZ?: number;
  stagePose?: {
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    rotation: number;
  };
  aisles: Array<{ id: string; points: [number, number, number][]; width?: number }>;
  obstacles: Array<{
    id: string;
    type: string;
    points: [number, number, number][];
    height: number;
  }>;
  stairs: Array<{ id: string; kind: string; points: [number, number, number][]; width?: number }>;
  exits: Array<{
    id: string;
    label?: string;
    points: [number, number, number][];
    width?: number;
  }>;
  furniture: Array<{
    id: string;
    type: string;
    label?: string;
    position: [number, number, number];
    rotation?: number;
  }>;
  focusPoints: Array<{
    id: string;
    label?: string;
    position: [number, number, number];
    levelId?: string;
  }>;
  egressOverlay: EgressOverlayScene3D | null;
  highlightEgressSection?: string | null;
  selectedIds: Set<string>;
  heatBySeat?: Map<string, string> | null;
  onToggleSeat?: (id: string) => void;
  onHoverSeat: (seat: LaidOutSeat | null) => void;
  mode: 'orbit' | 'seat';
  selectedSeat?: { x: number; y: number; z: number };
  autoOrbit: boolean;
  onUserInteract: () => void;
}) {
  return (
    <>
      <color attach="background" args={['#050506']} />
      <fog attach="fog" args={['#050506', 14, 36]} />
      <fog attach="fog" args={['#070708', 16, 38]} />
      <color attach="background" args={['#070708']} />
      <ambientLight intensity={0.28} />
      <directionalLight position={[7, 16, 5]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#93c5fd" />
      <hemisphereLight intensity={0.4} color="#fafafa" groundColor="#0a0a0a" />

      <VenueShell />
      <StageBlock z={stageZ} pose={stagePose} />
      <GeometryOverlays
        aisles={aisles}
        obstacles={obstacles}
        stairs={stairs}
        exits={exits}
        furniture={furniture}
        focusPoints={focusPoints}
      />
      <EgressPathOverlays overlay={egressOverlay} highlightSection={highlightEgressSection} />
      <SectionPlates plates={plates} />
      <SeatingBowl
        seats={seats}
        selectedIds={selectedIds}
        heatBySeat={heatBySeat}
        onToggleSeat={onToggleSeat}
        onHoverSeat={onHoverSeat}
      />
      {mode === 'seat' && selectedSeat ? (
        <SeatViewCamera target={selectedSeat} />
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[0, 11, 13.5]} fov={40} />
          <ConstrainedOrbit
            stageZ={stageZ}
            autoOrbit={autoOrbit}
            onUserInteract={onUserInteract}
          />
        </>
      )}
    </>
  );
}

function CompatibleVenueView({ seats }: { seats: LaidOutSeat[] }) {
  const projected = useMemo(
    () =>
      seats.map((seat) => ({
        ...seat,
        sx: (seat.px - seat.pz) * 0.72,
        sy: (seat.px + seat.pz) * 0.36 - seat.py * 1.4,
      })),
    [seats],
  );
  const bounds = useMemo(() => {
    if (!projected.length) return { minX: -8, minY: -5, width: 16, height: 10 };
    const xs = projected.map((seat) => seat.sx);
    const ys = projected.map((seat) => seat.sy);
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minY = Math.min(...ys) - 1;
    const maxY = Math.max(...ys) + 1;
    return {
      minX,
      minY,
      width: Math.max(maxX - minX, 4),
      height: Math.max(maxY - minY, 3),
    };
  }, [projected]);
  const radius = Math.max(0.08, Math.min(0.22, bounds.width / 90));

  return (
    <div className={styles.compatibleView} role="img" aria-label="Vista compatible del venue">
      <svg
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="venue-seat-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0.08" stdDeviation="0.08" floodOpacity="0.7" />
          </filter>
        </defs>
        <ellipse
          cx={bounds.minX + bounds.width / 2}
          cy={bounds.minY + bounds.height * 0.62}
          rx={bounds.width * 0.42}
          ry={bounds.height * 0.27}
          fill="#111114"
          stroke="#27272a"
          strokeWidth={radius * 0.35}
        />
        {projected
          .slice()
          .sort((a, b) => a.sy - b.sy)
          .map((seat) => (
            <circle
              key={seat.id}
              cx={seat.sx}
              cy={seat.sy}
              r={seat.decorative ? radius * 0.72 : radius}
              fill={seat.status === 'blocked' ? '#52525b' : seat.color || '#5b9fd4'}
              stroke={seat.decorative ? 'none' : 'rgba(255,255,255,0.5)'}
              strokeWidth={radius * 0.12}
              opacity={seat.decorative ? 0.45 : 1}
              filter="url(#venue-seat-shadow)"
            />
          ))}
      </svg>
      <div className={styles.compatibleNote}>
        Vista compatible · activa la aceleración por hardware para órbita 3D
      </div>
    </div>
  );
}

export function Venue3DViewer({
  selectedSeat,
  seats = [],
  selectedIds = [],
  onToggleSeat,
  mode = 'orbit',
  className,
  height = 520,
  currency = 'MXN',
  stage,
  aisles: aislesProp,
  obstacles: obstaclesProp,
  stairs: stairsProp,
  exits: exitsProp,
  furniture: furnitureProp,
  focusPoints: focusPointsProp,
  levels: levelsProp = [],
  mapData = null,
  heatDefault,
  heatMode: heatModeProp,
  onHeatModeChange,
}: Venue3DViewerProps) {
  const [hover, setHover] = useState<LaidOutSeat | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [webglLost, setWebglLost] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | 'ALL'>('ALL');
  const [showEgress, setShowEgress] = useState(false);
  const [heatModeInternal, setHeatModeInternal] = useState<Venue3DHeatMode>(() =>
    resolveHeatDefault(heatDefault),
  );
  const heatMode = heatModeProp ?? heatModeInternal;

  function setHeatMode(next: Venue3DHeatMode) {
    onHeatModeChange?.(next);
    if (heatModeProp === undefined) setHeatModeInternal(next);
  }

  function toggleHeat(mode: Exclude<Venue3DHeatMode, 'off'>) {
    setHeatMode(heatMode === mode ? 'off' : mode);
  }

  const levels = useMemo(() => {
    const list = [...levelsProp];
    list.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    return list;
  }, [levelsProp]);

  const layout = useMemo(() => {
    const enriched: BowlSeat[] = seats.map((s, i) => ({
      ...s,
      color: s.color || sectionColor(s.section || String(i)),
    }));
    return layoutSeatsAuto(enriched, {
      mode: 'published',
      stage,
      aisles: aislesProp,
      obstacles: obstaclesProp,
      stairs: stairsProp,
      exits: exitsProp,
      furniture: furnitureProp,
      focusPoints: focusPointsProp,
    });
  }, [seats, stage, aislesProp, obstaclesProp, stairsProp, exitsProp, furnitureProp, focusPointsProp]);

  const {
    seats: laidOutAll,
    plates: platesAll,
    stageZ,
    stagePose,
    aisles: aislesAll,
    obstacles: obstaclesAll,
    stairs: stairsAll,
    exits: exitsAll,
    furniture: furnitureAll,
    focusPoints: focusPointsAll,
  } = layout;

  const laidOut = useMemo(() => {
    if (levelFilter === 'ALL') return laidOutAll;
    return laidOutAll.filter((s) => !s.levelId || s.levelId === levelFilter);
  }, [laidOutAll, levelFilter]);

  const plates = useMemo(() => {
    if (levelFilter === 'ALL') return platesAll;
    return platesAll.filter((p) => !p.levelId || p.levelId === levelFilter);
  }, [platesAll, levelFilter]);

  const aisles = useMemo(() => {
    if (levelFilter === 'ALL') return aislesAll;
    return aislesAll.filter((a) => !a.levelId || a.levelId === levelFilter);
  }, [aislesAll, levelFilter]);

  const obstacles = useMemo(() => {
    if (levelFilter === 'ALL') return obstaclesAll;
    return obstaclesAll.filter((o) => !o.levelId || o.levelId === levelFilter);
  }, [obstaclesAll, levelFilter]);

  const stairs = useMemo(() => {
    if (levelFilter === 'ALL') return stairsAll;
    return stairsAll.filter((st) => {
      if (!st.fromLevelId && !st.toLevelId) return true;
      return st.fromLevelId === levelFilter || st.toLevelId === levelFilter;
    });
  }, [stairsAll, levelFilter]);

  const exits = useMemo(() => {
    if (levelFilter === 'ALL') return exitsAll;
    return exitsAll.filter((e) => !e.levelId || e.levelId === levelFilter);
  }, [exitsAll, levelFilter]);

  const furniture = useMemo(() => {
    if (levelFilter === 'ALL') return furnitureAll;
    return furnitureAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [furnitureAll, levelFilter]);

  const focusPoints = useMemo(() => {
    if (levelFilter === 'ALL') return focusPointsAll;
    return focusPointsAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [focusPointsAll, levelFilter]);

  const egressOverlay = useMemo(() => {
    if (!showEgress || !mapData) return null;
    return projectEgressOverlaysTo3D(mapData, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, mapData, levelFilter]);

  const priceRange = useMemo(() => {
    const prices: number[] = [];
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price === 'number' && Number.isFinite(s.price) && s.price > 0) {
        prices.push(s.price);
      }
    }
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [laidOut]);

  const sightlineMeta = useMemo(() => {
    if (heatMode !== 'view' || !mapData) return null;
    const result = calculateSightlines(resolveGeometry(mapData), {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    const heatBySeat = new Map<string, string>();
    const gradeBySeat = new Map<string, string>();
    for (const s of result.scores) {
      heatBySeat.set(s.seatId, sightlineHeatColor(s.score));
      gradeBySeat.set(s.seatId, s.grade);
    }
    return { heatBySeat, gradeBySeat, summary: result.summary };
  }, [heatMode, mapData, levelFilter]);

  const priceHeatBySeat = useMemo(() => {
    if (heatMode !== 'price' || !priceRange) return null;
    const heatBySeat = new Map<string, string>();
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price !== 'number' || !Number.isFinite(s.price)) continue;
      heatBySeat.set(s.id, priceHeatColor(s.price, priceRange.min, priceRange.max));
    }
    return heatBySeat.size ? heatBySeat : null;
  }, [heatMode, laidOut, priceRange]);

  const heatBySeat =
    heatMode === 'view' ? sightlineMeta?.heatBySeat : heatMode === 'price' ? priceHeatBySeat : null;

  const hasPricedSeats = Boolean(priceRange && priceRange.max > 0);
  const showHeatToolbar = hasPricedSeats || Boolean(mapData);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const interactiveCount = laidOut.filter((s) => !s.decorative).length;

  const sections = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const s of laidOut) {
      if (s.decorative || !s.section) continue;
      const cur = map.get(s.section) ?? {
        name: s.section,
        color: s.color || sectionColor(s.section),
        count: 0,
      };
      cur.count += 1;
      map.set(s.section, cur);
    }
    return Array.from(map.values());
  }, [laidOut]);

  const wrapStyle = { ['--venue-h' as string]: `${height}px` } as CSSProperties;

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} style={wrapStyle}>
      <div className={styles.canvas}>
        <Canvas
          dpr={[1, 1.25]}
          gl={{
            antialias: false,
            alpha: false,
            powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener(
              'webglcontextlost',
              (event) => {
                event.preventDefault();
                setWebglLost(true);
              },
              { once: true },
            );
          }}
        >
          <Scene
            seats={laidOut}
            plates={plates}
            stageZ={stageZ}
            stagePose={stagePose}
            aisles={aisles}
            obstacles={obstacles}
            stairs={stairs}
            exits={exits}
            furniture={furniture}
            focusPoints={focusPoints}
            egressOverlay={egressOverlay}
            highlightEgressSection={hover?.section ?? null}
            selectedIds={selectedSet}
            heatBySeat={heatBySeat}
            onToggleSeat={onToggleSeat}
            onHoverSeat={setHover}
            mode={mode}
            selectedSeat={selectedSeat}
            autoOrbit={autoOrbit && selectedIds.length === 0}
            onUserInteract={() => setAutoOrbit(false)}
          />
        </Canvas>

        {webglLost && <CompatibleVenueView seats={laidOut} />}

        <div className={styles.overlayTop}>
          <div className={styles.topLeft}>
            <span className={styles.badge}>Venue 3D</span>
            <span className={styles.meta}>
              {interactiveCount} asientos
              {levelFilter !== 'ALL'
                ? ` · ${levels.find((l) => l.id === levelFilter)?.name ?? 'nivel'}`
                : ''}
              {' · '}
              {autoOrbit ? 'rotación auto' : 'órbita libre'}
            </span>
            {levels.length > 0 && (
              <div className={styles.levelBar} role="toolbar" aria-label="Niveles">
                <button
                  type="button"
                  className={levelFilter === 'ALL' ? styles.levelActive : styles.levelBtn}
                  onClick={() => setLevelFilter('ALL')}
                >
                  Todos
                </button>
                {levels.map((lv) => (
                  <button
                    key={lv.id}
                    type="button"
                    className={levelFilter === lv.id ? styles.levelActive : styles.levelBtn}
                    onClick={() => setLevelFilter(lv.id)}
                  >
                    {lv.name}
                  </button>
                ))}
              </div>
            )}
            {showHeatToolbar && (
              <div className={styles.levelBar} role="toolbar" aria-label="Heat y salidas">
                {hasPricedSeats && (
                  <button
                    type="button"
                    className={heatMode === 'price' ? styles.levelActive : styles.levelBtn}
                    aria-pressed={heatMode === 'price'}
                    onClick={() => toggleHeat('price')}
                  >
                    Precio
                  </button>
                )}
                {mapData && (
                  <button
                    type="button"
                    className={heatMode === 'view' ? styles.levelActive : styles.levelBtn}
                    aria-pressed={heatMode === 'view'}
                    onClick={() => toggleHeat('view')}
                  >
                    Vistas
                  </button>
                )}
                {mapData && (
                  <button
                    type="button"
                    className={showEgress ? styles.levelActive : styles.levelBtn}
                    aria-pressed={showEgress}
                    onClick={() => setShowEgress((v) => !v)}
                  >
                    Salidas
                  </button>
                )}
              </div>
            )}
            {heatMode === 'price' && priceRange && (
              <div className={styles.viewHeatBar} aria-hidden>
                <span>
                  ${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                </span>
                <div className={styles.priceHeatScale} />
                <span>
                  ${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
            {heatMode === 'view' && sightlineMeta && (
              <div className={styles.viewHeatBar} aria-hidden>
                <span>Mala</span>
                <div className={styles.viewHeatScale} />
                <span>Buena</span>
              </div>
            )}
            {heatMode === 'view' && sightlineMeta && (
              <p className={styles.egressHint} role="status" aria-live="polite">
                Heat de vista · {sightlineMeta.heatBySeat.size} asientos
                {sightlineMeta.summary.premium
                  ? ` · ${sightlineMeta.summary.premium} premium`
                  : ''}
              </p>
            )}
            {showEgress && egressOverlay && (
              <p className={styles.egressHint} id="egress-3d-status" role="status" aria-live="polite">
                {egressOverlay.hasNetwork
                  ? `Rutas · ${egressOverlay.paths.length} sección(es)${
                      egressOverlay.clearanceMinutes != null
                        ? ` · ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                        : ''
                    }`
                  : 'Sin red de pasillos/salidas'}
              </p>
            )}
            {showEgress && (
              <ul className={styles.egressLegend} id="egress-3d-legend" aria-label="Leyenda de salidas">
                <li>
                  <i className={styles.swatchRoute} aria-hidden /> Ruta
                </li>
                <li>
                  <i className={styles.swatchRouteActive} aria-hidden /> Activa
                </li>
                <li>
                  <i className={styles.swatchBottleneck} aria-hidden /> Cuello
                </li>
              </ul>
            )}
          </div>
          {selectedIds.length > 0 && (
            <span className={styles.selBadge}>{selectedIds.length} elegidos</span>
          )}
        </div>

        {hover && !hover.decorative && (
          <div className={styles.tooltip}>
            <strong>{hover.label || 'Asiento'}</strong>
            <span>
              {hover.section || 'Zona'}
              {typeof hover.price === 'number' && hover.price > 0
                ? ` · $${hover.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
                : ''}
              {heatMode === 'view' && sightlineMeta?.gradeBySeat.has(hover.id)
                ? ` · vista ${sightlineMeta.gradeBySeat.get(hover.id)}`
                : ''}
            </span>
            <em>Click para {selectedSet.has(hover.id) ? 'quitar' : 'elegir'}</em>
          </div>
        )}

        <div className={styles.overlayBottom}>
          <ul className={styles.legend}>
            <li>
              <i
                className={
                  heatMode === 'view'
                    ? styles.legHeat
                    : heatMode === 'price'
                      ? styles.legPrice
                      : styles.legAvail
                }
              />{' '}
              {heatMode === 'view'
                ? 'Color = vista'
                : heatMode === 'price'
                  ? 'Color = precio'
                  : 'Color = zona'}
            </li>
            <li>
              <i className={styles.legSel} /> Elegido
            </li>
            <li>
              <i className={styles.legSold} /> No disponible
            </li>
          </ul>
          {sections.length > 0 && (
            <ul className={styles.sections}>
              {sections.slice(0, 6).map((s) => (
                <li key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name}
                  <em>{s.count}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
