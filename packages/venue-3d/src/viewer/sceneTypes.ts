import type { EgressOverlayScene3D } from '@boletera/venue-engine';
import type { LaidOutSeat, LayoutSceneExtras, SectionPlate } from '../bowlLayout';
import type {
  Venue3DBounds,
  Venue3DCameraCommandOptions,
  Venue3DCameraPreset,
  Venue3DCameraState,
  Venue3DPerfStats,
  Venue3DQualitySettings,
} from '../types';
import type { CameraControllerRef } from './cameraController';
import type { ResolvedLayers, ResolvedOpacity } from './layers';

export type StagePose = NonNullable<LayoutSceneExtras['stagePose']>;

export type SceneAisle = LayoutSceneExtras['aisles'][number];
export type SceneObstacle = LayoutSceneExtras['obstacles'][number];
export type SceneStair = LayoutSceneExtras['stairs'][number];
export type SceneExit = LayoutSceneExtras['exits'][number];
export type SceneFurniture = LayoutSceneExtras['furniture'][number];
export type SceneFocusPoint = LayoutSceneExtras['focusPoints'][number];

export type SceneProps = {
  seats: LaidOutSeat[];
  plates: SectionPlate[];
  stageZ: number;
  stagePose?: StagePose;
  aisles: SceneAisle[];
  obstacles: SceneObstacle[];
  stairs: SceneStair[];
  exits: SceneExit[];
  furniture: SceneFurniture[];
  focusPoints: SceneFocusPoint[];
  egressOverlay: EgressOverlayScene3D | null;
  highlightEgressSection?: string | null;
  selectedIds: Set<string>;
  heatBySeat?: Map<string, string> | null;
  onToggleSeat?: (id: string) => void;
  onHoverSeat: (seat: LaidOutSeat | null) => void;
  /** First-person mode when a seat is selected; otherwise the orbit rig runs. */
  seatView: boolean;
  selectedSeat?: { x: number; y: number; z: number };
  cameraPreset: Venue3DCameraPreset;
  bounds: Venue3DBounds;
  controllerRef: CameraControllerRef;
  /** Options for the next preset transition, consumed once by the rig. */
  presetOptionsRef: { current: Venue3DCameraCommandOptions | undefined };
  autoOrbit: boolean;
  reducedMotion: boolean;
  cameraTransitionMs: number;
  cameraSampleMs: number;
  enablePan?: boolean;
  onCameraChange?: (state: Venue3DCameraState) => void;
  onUserInteract: () => void;
  layers: ResolvedLayers;
  opacity: ResolvedOpacity;
  quality: Venue3DQualitySettings;
  fpsSampleMs: number;
  onPerfSample?: (stats: Venue3DPerfStats) => void;
};
