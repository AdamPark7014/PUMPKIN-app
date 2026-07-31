'use client';

import { memo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { polylineCenter } from './geometryUtils';
import type {
  SceneAisle,
  SceneExit,
  SceneFocusPoint,
  SceneFurniture,
  SceneObstacle,
  SceneStair,
} from './sceneTypes';

type GeometryOverlaysProps = {
  aisles: SceneAisle[];
  obstacles: SceneObstacle[];
  stairs?: SceneStair[];
  exits?: SceneExit[];
  furniture?: SceneFurniture[];
  focusPoints?: SceneFocusPoint[];
  /** Multiplier for aisles / stairs / exits / obstacles (`opacity.structure`). */
  structureOpacity?: number;
  /** Multiplier for furniture props (`opacity.furniture`). */
  furnitureOpacity?: number;
  castShadow?: boolean;
};

export const GeometryOverlays = memo(function GeometryOverlays({
  aisles,
  obstacles,
  stairs,
  exits,
  furniture,
  focusPoints,
  structureOpacity = 1,
  furnitureOpacity = 1,
  castShadow = false,
}: GeometryOverlaysProps) {
  const showStructure = structureOpacity > 0;
  const showFurniture = furnitureOpacity > 0;
  const structureTransparent = structureOpacity < 1;
  const furnitureTransparent = furnitureOpacity < 1;

  return (
    <group>
      {showStructure &&
        aisles.map((aisle) => {
          if (aisle.points.length < 2) return null;
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
                    <meshBasicMaterial
                      color="#64748b"
                      transparent
                      opacity={0.28 * structureOpacity}
                      depthWrite={false}
                    />
                  </mesh>
                );
              })}
            </group>
          );
        })}
      {showStructure &&
        (stairs ?? []).map((stair) => {
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
                    castShadow={castShadow}
                  >
                    <boxGeometry args={[stairW, 0.08, Math.max(len, 0.25)]} />
                    <meshStandardMaterial
                      color="#ea580c"
                      roughness={0.7}
                      metalness={0.1}
                      transparent={structureTransparent}
                      opacity={structureOpacity}
                    />
                  </mesh>
                );
              })}
            </group>
          );
        })}
      {showStructure &&
        (exits ?? []).map((exit) => {
          if (!exit.points.length) return null;
          const p = exit.points[0];
          const doorW = Math.max(0.45, Math.min(2.2, (exit.width ?? 32) * 0.03));
          return (
            <group key={exit.id} position={[p[0], 0, p[2]]}>
              <mesh position={[0, 1.05, 0]} castShadow={castShadow}>
                <boxGeometry args={[doorW, 2.1, 0.12]} />
                <meshStandardMaterial
                  color="#16a34a"
                  emissive="#14532d"
                  emissiveIntensity={0.35}
                  roughness={0.55}
                  transparent={structureTransparent}
                  opacity={structureOpacity}
                />
              </mesh>
              <mesh position={[0, 2.25, 0]}>
                <boxGeometry args={[doorW * 1.05, 0.18, 0.14]} />
                <meshStandardMaterial
                  color="#bbf7d0"
                  roughness={0.4}
                  transparent={structureTransparent}
                  opacity={structureOpacity}
                />
              </mesh>
              <Billboard position={[0, 2.6, 0]}>
                <Text
                  fontSize={0.28}
                  color="#bbf7d0"
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.02}
                  outlineColor="#052e16"
                >
                  {exit.label ?? 'Salida'}
                </Text>
              </Billboard>
            </group>
          );
        })}
      {showFurniture &&
        (furniture ?? []).map((item) => {
          const [x, y, z] = item.position;
          const rotY = ((item.rotation ?? 0) * Math.PI) / 180;
          if (item.type === 'led') {
            return (
              <group key={item.id} position={[x, y, z]} rotation={[0, rotY, 0]}>
                <mesh castShadow={castShadow}>
                  <boxGeometry args={[2.4, 1.1, 0.12]} />
                  <meshStandardMaterial
                    color="#0ea5e9"
                    emissive="#0369a1"
                    emissiveIntensity={0.55}
                    roughness={0.35}
                    metalness={0.2}
                    transparent={furnitureTransparent}
                    opacity={furnitureOpacity}
                  />
                </mesh>
                <Billboard position={[0, 0.85, 0]}>
                  <Text
                    fontSize={0.22}
                    color="#e0f2fe"
                    anchorX="center"
                    anchorY="middle"
                    outlineWidth={0.015}
                    outlineColor="#0c4a6e"
                  >
                    LED
                  </Text>
                </Billboard>
              </group>
            );
          }
          if (item.type === 'speaker') {
            return (
              <group key={item.id} position={[x, y, z]} rotation={[0, rotY, 0]}>
                <mesh castShadow={castShadow}>
                  <boxGeometry args={[0.55, 0.9, 0.45]} />
                  <meshStandardMaterial
                    color="#27272a"
                    roughness={0.65}
                    metalness={0.25}
                    transparent={furnitureTransparent}
                    opacity={furnitureOpacity}
                  />
                </mesh>
                <mesh position={[0, 0.15, 0.2]}>
                  <cylinderGeometry args={[0.18, 0.18, 0.08, 20]} />
                  <meshStandardMaterial
                    color="#52525b"
                    roughness={0.5}
                    transparent={furnitureTransparent}
                    opacity={furnitureOpacity}
                  />
                </mesh>
                <Billboard position={[0, 0.7, 0]}>
                  <Text
                    fontSize={0.2}
                    color="#d4d4d8"
                    anchorX="center"
                    anchorY="middle"
                    outlineWidth={0.012}
                    outlineColor="#18181b"
                  >
                    Altavoz
                  </Text>
                </Billboard>
              </group>
            );
          }
          return (
            <group key={item.id} position={[x, 0, z]} rotation={[0, rotY, 0]}>
              <mesh position={[0, 1.0, 0]} castShadow={castShadow}>
                <boxGeometry args={[0.9, 2.0, 0.1]} />
                <meshStandardMaterial
                  color="#a16207"
                  emissive="#713f12"
                  emissiveIntensity={0.25}
                  roughness={0.6}
                  transparent={furnitureTransparent}
                  opacity={furnitureOpacity}
                />
              </mesh>
              <Billboard position={[0, 2.25, 0]}>
                <Text
                  fontSize={0.22}
                  color="#fde68a"
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.015}
                  outlineColor="#422006"
                >
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
              <Text
                fontSize={0.24}
                color="#fef3c7"
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.018}
                outlineColor="#78350f"
              >
                {fp.label ?? 'Foco'}
              </Text>
            </Billboard>
          </group>
        );
      })}
      {showStructure &&
        obstacles.map((obs) => {
          if (obs.points.length < 3) return null;
          const [cx, , cz] = polylineCenter(obs.points);
          const xs = obs.points.map((p) => p[0]);
          const zs = obs.points.map((p) => p[2]);
          const w = Math.max(Math.max(...xs) - Math.min(...xs), 0.6);
          const d = Math.max(Math.max(...zs) - Math.min(...zs), 0.6);
          const h = Math.min(Math.max(obs.height * 0.01, 0.6), 3.5);
          return (
            <mesh
              key={obs.id}
              position={[cx, h / 2, cz]}
              castShadow={castShadow}
              receiveShadow
            >
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial
                color="#3f3f46"
                roughness={0.85}
                metalness={0.05}
                transparent
                opacity={0.72 * structureOpacity}
              />
            </mesh>
          );
        })}
    </group>
  );
});
