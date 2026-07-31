'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Intersection,
} from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { LaidOutSeat } from '../bowlLayout';
import {
  isSeatDisabled,
  seatBackrestColor,
  seatDisplayColor,
  seatLift,
} from './seatAppearance';

/** Default interactive seat count at which rendering switches to `InstancedMesh`. */
export const INSTANCED_SEAT_THRESHOLD = 180;

type InstancedSeatingProps = {
  seats: LaidOutSeat[];
  selectedIds: Set<string>;
  hoveredId: string | null;
  heatBySeat?: Map<string, string> | null;
  interactive: boolean;
  /** Material opacity multiplier from the host `opacity.seats` layer control. */
  opacity?: number;
  /** Camera distance past which backrests stop drawing (halves seat draw work). */
  lodDistance?: number;
  castShadow?: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
};

const _dummy = new Object3D();
const _color = new Color();
const _matrix = new Matrix4();
const _center = new Vector3();

function writeInstance(
  mesh: InstancedMesh,
  index: number,
  seat: LaidOutSeat,
  localY: number,
  localZ: number,
  lift: number,
  colorHex: string,
  dimmed: boolean,
) {
  _dummy.position.set(seat.px, seat.py + lift, seat.pz);
  _dummy.rotation.set(seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0);
  _dummy.updateMatrix();
  // Bake local cushion/backrest offset into the instance matrix.
  _matrix.makeTranslation(0, localY, localZ);
  _dummy.matrix.multiply(_matrix);
  mesh.setMatrixAt(index, _dummy.matrix);
  _color.set(colorHex);
  // Per-instance alpha is not available on a shared material, so unavailable
  // seats are darkened instead of made translucent.
  if (dimmed) _color.multiplyScalar(0.35);
  mesh.setColorAt(index, _color);
}

/**
 * Draws the whole seating set as two `InstancedMesh` calls (cushion + backrest)
 * instead of two meshes per chair. Geometries and materials are created once per
 * mount and disposed on unmount, so switching levels or filters does not leak
 * GPU buffers.
 */
export function InstancedSeating({
  seats,
  selectedIds,
  hoveredId,
  heatBySeat,
  interactive,
  opacity = 1,
  lodDistance = Number.POSITIVE_INFINITY,
  castShadow = false,
  onHover,
  onClick,
}: InstancedSeatingProps) {
  const cushionRef = useRef<InstancedMesh>(null);
  const backRef = useRef<InstancedMesh>(null);
  const count = seats.length;
  const transparent = opacity < 1;

  const cushionGeo = useMemo(
    () => new BoxGeometry(interactive ? 0.26 : 0.2, 0.08, interactive ? 0.24 : 0.22),
    [interactive],
  );
  const backGeo = useMemo(
    () => new BoxGeometry(interactive ? 0.26 : 0.2, interactive ? 0.18 : 0.16, 0.05),
    [interactive],
  );
  const cushionMat = useMemo(
    () =>
      new MeshStandardMaterial({
        roughness: interactive ? 0.55 : 0.95,
        metalness: interactive ? 0.08 : 0,
      }),
    [interactive],
  );
  const backMat = useMemo(
    () =>
      new MeshStandardMaterial({
        roughness: interactive ? 0.6 : 0.95,
        metalness: interactive ? 0.06 : 0,
      }),
    [interactive],
  );

  useEffect(() => {
    cushionMat.transparent = transparent;
    cushionMat.opacity = opacity;
    cushionMat.depthWrite = !transparent;
    cushionMat.needsUpdate = true;
    backMat.transparent = transparent;
    backMat.opacity = opacity;
    backMat.depthWrite = !transparent;
    backMat.needsUpdate = true;
  }, [cushionMat, backMat, opacity, transparent]);

  useEffect(() => {
    return () => {
      cushionGeo.dispose();
      backGeo.dispose();
      cushionMat.dispose();
      backMat.dispose();
    };
  }, [cushionGeo, backGeo, cushionMat, backMat]);

  useLayoutEffect(() => {
    const cushion = cushionRef.current;
    const back = backRef.current;
    if (!cushion || !back || count === 0) return;

    for (let i = 0; i < count; i++) {
      const seat = seats[i];
      const selected = interactive && selectedIds.has(seat.id);
      const hovered = interactive && hoveredId === seat.id;
      const heatColor = heatBySeat?.get(seat.id);
      const disabled = interactive && isSeatDisabled(seat);
      const lift = interactive ? seatLift(selected, hovered) : 0;
      const cushionColor = interactive
        ? seatDisplayColor(seat, { selected, hovered, heatColor })
        : seat.color || '#1f1f23';
      const backColor = interactive
        ? seatBackrestColor(seat, { selected, hovered, heatColor })
        : seat.color || '#1a1a1e';

      writeInstance(
        cushion,
        i,
        seat,
        interactive ? 0.055 : 0.05,
        interactive ? 0.015 : 0,
        lift,
        cushionColor,
        disabled,
      );
      writeInstance(
        back,
        i,
        seat,
        interactive ? 0.16 : 0.14,
        interactive ? 0.09 : 0.08,
        lift,
        backColor,
        disabled,
      );
    }

    cushion.instanceMatrix.needsUpdate = true;
    back.instanceMatrix.needsUpdate = true;
    if (cushion.instanceColor) cushion.instanceColor.needsUpdate = true;
    if (back.instanceColor) back.instanceColor.needsUpdate = true;
    cushion.count = count;
    back.count = count;
    cushion.computeBoundingSphere();
    back.computeBoundingSphere();
  }, [seats, count, selectedIds, hoveredId, heatBySeat, interactive]);

  useLayoutEffect(() => {
    const cushion = cushionRef.current;
    const back = backRef.current;
    if (!cushion || !back) return;
    cushion.instanceMatrix.setUsage(DynamicDrawUsage);
    back.instanceMatrix.setUsage(DynamicDrawUsage);
  }, [count]);

  useFrame((state) => {
    const back = backRef.current;
    const cushion = cushionRef.current;
    if (!back || !cushion) return;
    if (!Number.isFinite(lodDistance)) {
      if (!back.visible) back.visible = true;
      return;
    }
    const sphere = cushion.boundingSphere;
    if (sphere) _center.copy(sphere.center);
    else _center.set(0, 0, 0);
    const distance = state.camera.position.distanceTo(_center);
    const visible = distance <= lodDistance;
    if (back.visible !== visible) back.visible = visible;
  });

  const resolveSeat = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const hit = event.intersections.find(
      (entry: Intersection) =>
        entry.object === cushionRef.current || entry.object === backRef.current,
    );
    const instanceId = hit?.instanceId;
    if (instanceId == null || instanceId < 0 || instanceId >= seats.length) return null;
    return seats[instanceId] ?? null;
  };

  const pointerHandlers = interactive
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const seat = resolveSeat(e);
          if (!seat || isSeatDisabled(seat)) return;
          onHover(seat.id);
          document.body.style.cursor = 'pointer';
        },
        onPointerOut: () => {
          onHover(null);
          document.body.style.cursor = 'auto';
        },
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const seat = resolveSeat(e);
          if (!seat || isSeatDisabled(seat)) return;
          onClick(seat.id);
        },
      }
    : undefined;

  if (count === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={cushionRef}
        args={[cushionGeo, cushionMat, count]}
        castShadow={castShadow && interactive}
        raycast={interactive ? undefined : () => null}
        {...pointerHandlers}
      />
      <instancedMesh
        ref={backRef}
        args={[backGeo, backMat, count]}
        castShadow={castShadow && interactive}
        raycast={interactive ? undefined : () => null}
        {...pointerHandlers}
      />
    </group>
  );
}
