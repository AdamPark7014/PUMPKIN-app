import type {
  Venue3DBounds,
  Venue3DCameraCommandOptions,
  Venue3DCameraPreset,
  Venue3DCameraState,
  Venue3DVec3,
} from '../types';

/**
 * Imperative bridge between the DOM-side component and the R3F scene graph.
 * `CameraRig` fills the ref in; `Venue3DViewer` forwards it to `apiRef`.
 */
export type CameraController = {
  applyPreset: (preset: Venue3DCameraPreset, opts?: Venue3DCameraCommandOptions) => void;
  frameBounds: (
    bounds: Venue3DBounds,
    opts?: Venue3DCameraCommandOptions & { padding?: number },
  ) => void;
  pan: (deltaX: number, deltaZ: number, opts?: Venue3DCameraCommandOptions) => void;
  panTo: (target: Venue3DVec3, opts?: Venue3DCameraCommandOptions) => void;
  getState: () => Venue3DCameraState;
};

export type CameraControllerRef = { current: CameraController | null };
