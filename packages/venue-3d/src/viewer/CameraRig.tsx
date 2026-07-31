'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type {
  Venue3DBounds,
  Venue3DCameraCommandOptions,
  Venue3DCameraPreset,
  Venue3DCameraState,
  Venue3DVec3,
} from '../types';
import type { CameraController, CameraControllerRef } from './cameraController';
import {
  resolveFitPose,
  resolvePresetConstraints,
  resolvePresetPose,
  type CameraPose,
  type PresetContext,
} from './cameraPresets';
import type { StagePose } from './sceneTypes';

export const DEFAULT_TRANSITION_MS = 520;

type CameraRigProps = {
  preset: Venue3DCameraPreset;
  bounds: Venue3DBounds;
  stagePose?: StagePose;
  stageZ: number;
  autoRotate: boolean;
  reducedMotion: boolean;
  transitionMs: number;
  enablePan?: boolean;
  controllerRef: CameraControllerRef;
  /** Transition options requested by the host for the next preset change. */
  presetOptionsRef: { current: Venue3DCameraCommandOptions | undefined };
  onCameraChange?: (state: Venue3DCameraState) => void;
  cameraSampleMs: number;
  onUserInteract: () => void;
};

type OrbitHandle = {
  object: { position: Vector3; fov?: number };
  target: Vector3;
  update: () => void;
  getPolarAngle: () => number;
  getAzimuthalAngle: () => number;
};

type Animation = {
  fromPosition: Vector3;
  toPosition: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  start: number;
  duration: number;
};

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function toVec3(point: Venue3DVec3) {
  return new Vector3(point.x, point.y, point.z);
}

function plain(vector: Vector3): Venue3DVec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

/**
 * Owns the orbit camera: preset framing, animated transitions, fit/pan commands
 * and `onCameraChange` sampling. Transitions collapse to instant jumps whenever
 * `reducedMotion` is on, so the venue never slides under a motion-sensitive user.
 */
export function CameraRig({
  preset,
  bounds,
  stagePose,
  stageZ,
  autoRotate,
  reducedMotion,
  transitionMs,
  enablePan,
  controllerRef,
  presetOptionsRef,
  onCameraChange,
  cameraSampleMs,
  onUserInteract,
}: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useRef<OrbitHandle | null>(null);
  const animation = useRef<Animation | null>(null);
  const lastEmit = useRef(0);
  const lastState = useRef<Venue3DCameraState | null>(null);

  const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
  const fov = (camera as { fov?: number }).fov ?? 40;

  const presetContext = useMemo<PresetContext>(
    () => ({ bounds, stagePose, stageZ, fov, aspect }),
    [bounds, stagePose, stageZ, fov, aspect],
  );

  const constraints = useMemo(
    () => resolvePresetConstraints(preset, presetContext, enablePan),
    [preset, presetContext, enablePan],
  );

  // Read through refs inside useFrame / imperative calls so the controller
  // identity stays stable across prop churn.
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const transitionRef = useRef(transitionMs);
  transitionRef.current = transitionMs;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const contextRef = useRef(presetContext);
  contextRef.current = presetContext;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  const readState = useCallback(
    (animating: boolean): Venue3DCameraState => {
      const control = controls.current;
      const target = control ? plain(control.target) : { x: 0, y: 0, z: 0 };
      const position = plain(camera.position);
      return {
        preset: presetRef.current,
        position,
        target,
        distance: Math.hypot(
          position.x - target.x,
          position.y - target.y,
          position.z - target.z,
        ),
        azimuth: control?.getAzimuthalAngle() ?? 0,
        polar: control?.getPolarAngle() ?? 0,
        animating,
      };
    },
    [camera],
  );

  const emit = useCallback(
    (animating: boolean, force = false) => {
      const handler = onCameraChangeRef.current;
      if (!handler) return;
      const next = readState(animating);
      const prev = lastState.current;
      if (
        !force &&
        prev &&
        prev.animating === next.animating &&
        Math.abs(prev.position.x - next.position.x) < 0.01 &&
        Math.abs(prev.position.y - next.position.y) < 0.01 &&
        Math.abs(prev.position.z - next.position.z) < 0.01 &&
        Math.abs(prev.target.x - next.target.x) < 0.01 &&
        Math.abs(prev.target.z - next.target.z) < 0.01
      ) {
        return;
      }
      lastState.current = next;
      handler(next);
    },
    [readState],
  );

  const applyPose = useCallback(
    (pose: CameraPose, opts?: Venue3DCameraCommandOptions) => {
      const control = controls.current;
      if (!control) return;
      const duration = opts?.durationMs ?? transitionRef.current;
      const animate = opts?.animate !== false && !reducedMotionRef.current && duration > 0;

      if (!animate) {
        animation.current = null;
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        control.target.set(pose.target.x, pose.target.y, pose.target.z);
        control.update();
        emit(false, true);
        return;
      }

      animation.current = {
        fromPosition: camera.position.clone(),
        toPosition: toVec3(pose.position),
        fromTarget: control.target.clone(),
        toTarget: toVec3(pose.target),
        start: performance.now(),
        duration,
      };
      emit(true, true);
    },
    [camera, emit],
  );

  const controller = useMemo<CameraController>(
    () => ({
      applyPreset: (next, opts) => {
        applyPose(resolvePresetPose(next, contextRef.current), opts);
      },
      frameBounds: (target, opts) => {
        const control = controls.current;
        if (!control) return;
        applyPose(
          resolveFitPose(
            target,
            { position: plain(camera.position), target: plain(control.target) },
            {
              fov: contextRef.current.fov,
              aspect: contextRef.current.aspect,
              padding: opts?.padding,
            },
          ),
          opts,
        );
      },
      pan: (deltaX, deltaZ, opts) => {
        const control = controls.current;
        if (!control) return;
        applyPose(
          {
            position: {
              x: camera.position.x + deltaX,
              y: camera.position.y,
              z: camera.position.z + deltaZ,
            },
            target: {
              x: control.target.x + deltaX,
              y: control.target.y,
              z: control.target.z + deltaZ,
            },
          },
          opts,
        );
      },
      panTo: (target, opts) => {
        const control = controls.current;
        if (!control) return;
        applyPose(
          {
            position: {
              x: camera.position.x + (target.x - control.target.x),
              y: camera.position.y + (target.y - control.target.y),
              z: camera.position.z + (target.z - control.target.z),
            },
            target,
          },
          opts,
        );
      },
      getState: () => readState(animation.current != null),
    }),
    [applyPose, camera, readState],
  );

  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [controller, controllerRef]);

  // Snap to the incoming preset on mount, animate on later switches. The host
  // can override the transition for a single change through `presetOptionsRef`.
  const mounted = useRef(false);
  useEffect(() => {
    const requested = presetOptionsRef.current;
    presetOptionsRef.current = undefined;
    controller.applyPreset(preset, mounted.current ? requested : { animate: false });
    mounted.current = true;
  }, [controller, preset, presetOptionsRef]);

  useFrame(() => {
    const control = controls.current;
    if (!control) return;

    const active = animation.current;
    if (active) {
      const elapsed = performance.now() - active.start;
      const t = Math.min(1, elapsed / active.duration);
      const eased = easeInOutCubic(t);
      camera.position.lerpVectors(active.fromPosition, active.toPosition, eased);
      control.target.lerpVectors(active.fromTarget, active.toTarget, eased);
      control.update();
      if (t >= 1) {
        animation.current = null;
        emit(false, true);
      }
      return;
    }

    const minY = constraintsRef.current.minY;
    if (camera.position.y < minY) {
      camera.position.y = minY;
      control.update();
    }

    if (!onCameraChangeRef.current) return;
    const now = performance.now();
    if (now - lastEmit.current < cameraSampleMs) return;
    lastEmit.current = now;
    emit(false);
  });

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enablePan={constraints.enablePan}
      minPolarAngle={constraints.minPolarAngle}
      maxPolarAngle={constraints.maxPolarAngle}
      minDistance={constraints.minDistance}
      maxDistance={constraints.maxDistance}
      enableDamping
      dampingFactor={0.07}
      autoRotate={autoRotate && !reducedMotion}
      autoRotateSpeed={0.55}
      onStart={onUserInteract}
    />
  );
}
