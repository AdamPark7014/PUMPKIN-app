export { Venue3DViewer } from './Venue3DViewer';
export { SeatViewCamera } from './SeatViewCamera';
export {
  layoutSeatsInBowl,
  layoutSeatsFromPublished,
  layoutSeatsAuto,
  sectionColor,
} from './bowlLayout';
export type { BowlSeat, LaidOutSeat, SectionPlate, LayoutSceneExtras } from './bowlLayout';

export type {
  Seat3D,
  Venue3DViewerProps,
  Venue3DHeatMode,
  Venue3DViewerHandle,
  Venue3DCameraPreset,
  Venue3DCameraState,
  Venue3DCameraCommandOptions,
  Venue3DFitOptions,
  Venue3DBounds,
  Venue3DVec3,
  Venue3DQuality,
  Venue3DQualityPreset,
  Venue3DQualitySettings,
  Venue3DPerfStats,
  Venue3DLayerKey,
  Venue3DLayerVisibility,
  Venue3DLayerOpacity,
  Venue3DOpacityKey,
  Venue3DHud,
  Venue3DHudOptions,
} from './types';

/** Quality presets, exported so hosts can show the exact settings they select. */
export { QUALITY_PRESETS, resolveQuality } from './viewer/quality';
/** Manual GPU teardown for hosts that own their own `<Canvas>`. */
export { disposeSceneResources, disposeWebGLRenderer } from './viewer/dispose';
export { computeBounds, fitDistance } from './viewer/bounds';
export { INSTANCED_SEAT_THRESHOLD } from './viewer/InstancedSeating';
