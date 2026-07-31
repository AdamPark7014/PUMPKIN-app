import type { Venue3DBounds, Venue3DCameraPreset, Venue3DVec3 } from '../types';
import { fitDistance } from './bounds';
import type { StagePose } from './sceneTypes';

export type CameraPose = {
  position: Venue3DVec3;
  target: Venue3DVec3;
};

export type CameraConstraints = {
  minPolarAngle: number;
  maxPolarAngle: number;
  minDistance: number;
  maxDistance: number;
  /** Floor clamp so the camera never dips under the bowl. */
  minY: number;
  enablePan: boolean;
};

export type PresetContext = {
  bounds: Venue3DBounds;
  stagePose?: StagePose;
  stageZ: number;
  fov: number;
  aspect: number;
};

/** Legacy orbit pose — kept byte-identical so existing embeds do not shift. */
export const LEGACY_ORBIT_POSITION: Venue3DVec3 = { x: 0, y: 11, z: 13.5 };

export const MIN_CAM_Y = 3.4;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function stagePoint(ctx: PresetContext): { point: Venue3DVec3; rotation: number } {
  const pose = ctx.stagePose;
  return {
    point: {
      x: pose?.x ?? 0,
      y: pose?.y ?? 0,
      z: pose?.z ?? ctx.stageZ,
    },
    rotation: pose?.rotation ?? 0,
  };
}

export function resolvePresetPose(preset: Venue3DCameraPreset, ctx: PresetContext): CameraPose {
  const { bounds, fov, aspect } = ctx;
  const center = bounds.center;

  if (preset === 'plan') {
    const dist = clamp(fitDistance(bounds.radius, fov, aspect, 1.12), 6, 400);
    return {
      // Nudge Z so the up vector never degenerates into a gimbal lock.
      position: { x: center.x, y: dist, z: center.z + dist * 0.002 },
      target: { x: center.x, y: 0, z: center.z },
    };
  }

  if (preset === 'side') {
    const dist = clamp(fitDistance(bounds.radius, fov, aspect, 1.2), 8, 400);
    const targetY = Math.max(1.2, center.y);
    return {
      position: { x: center.x + dist * 0.94, y: targetY + dist * 0.34, z: center.z },
      target: { x: center.x, y: targetY, z: center.z },
    };
  }

  if (preset === 'stage') {
    const { point, rotation } = stagePoint(ctx);
    const dist = clamp(bounds.radius * 0.85, 9, 34);
    // Stage geometry faces local +Z, so its front vector is (sin, cos) after yaw.
    const dirX = Math.sin(rotation);
    const dirZ = Math.cos(rotation);
    const target = { x: point.x, y: point.y + 1.2, z: point.z };
    return {
      position: {
        x: point.x + dirX * dist,
        y: target.y + dist * 0.42,
        z: point.z + dirZ * dist,
      },
      target,
    };
  }

  // orbit (and any first-person preset before SeatViewCamera takes over)
  return {
    position: { ...LEGACY_ORBIT_POSITION },
    target: { x: 0, y: 1.6, z: ctx.stageZ * 0.28 },
  };
}

export function resolvePresetConstraints(
  preset: Venue3DCameraPreset,
  ctx: PresetContext,
  enablePanOverride?: boolean,
): CameraConstraints {
  const { bounds, fov, aspect } = ctx;
  const fit = fitDistance(bounds.radius, fov, aspect, 1.2);

  if (preset === 'plan') {
    return {
      minPolarAngle: 0,
      maxPolarAngle: 0.42,
      minDistance: 4,
      maxDistance: Math.max(fit * 2.2, 40),
      minY: 1,
      enablePan: enablePanOverride ?? true,
    };
  }

  if (preset === 'side') {
    return {
      minPolarAngle: 0.25,
      maxPolarAngle: Math.PI / 2.1,
      minDistance: 5,
      maxDistance: Math.max(fit * 2, 36),
      minY: 0.8,
      enablePan: enablePanOverride ?? true,
    };
  }

  if (preset === 'stage') {
    return {
      minPolarAngle: 0.35,
      maxPolarAngle: Math.PI / 2.2,
      minDistance: 5,
      maxDistance: Math.max(fit * 2.4, 36),
      minY: 1.2,
      enablePan: enablePanOverride ?? true,
    };
  }

  // Legacy orbit constraints — unchanged.
  return {
    minPolarAngle: 0.55,
    maxPolarAngle: Math.PI / 2.35,
    minDistance: 8,
    maxDistance: 22,
    minY: MIN_CAM_Y,
    enablePan: enablePanOverride ?? false,
  };
}

/**
 * Pose that frames `bounds` while keeping the current view direction, so a fit
 * never re-orients the venue under the user.
 */
export function resolveFitPose(
  bounds: Venue3DBounds,
  current: { position: Venue3DVec3; target: Venue3DVec3 },
  ctx: { fov: number; aspect: number; padding?: number },
): CameraPose {
  const dist = fitDistance(bounds.radius, ctx.fov, ctx.aspect, ctx.padding ?? 1.15);
  const dx = current.position.x - current.target.x;
  const dy = current.position.y - current.target.y;
  const dz = current.position.z - current.target.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    position: {
      x: bounds.center.x + (dx / len) * dist,
      y: bounds.center.y + (dy / len) * dist,
      z: bounds.center.z + (dz / len) * dist,
    },
    target: { ...bounds.center },
  };
}
