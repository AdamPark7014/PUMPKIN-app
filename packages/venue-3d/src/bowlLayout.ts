/**
 * Public barrel for bowl layout helpers.
 * Internals live under `./bowlLayout/` — import paths (`./bowlLayout`) stay stable.
 */
export type {
  BowlSeat,
  LaidOutSeat,
  SectionPlate,
  LayoutSceneExtras,
  LayoutGeometryOpts,
  LayoutStageInput,
  LayoutAisleInput,
  LayoutObstacleInput,
  LayoutStairInput,
  LayoutExitInput,
  LayoutFurnitureInput,
  LayoutFocusPointInput,
} from './bowlLayout/types';
export { EMPTY_EXTRAS } from './bowlLayout/types';
export { sectionColor } from './bowlLayout/colors';
export { layoutSeatsInBowl } from './bowlLayout/bowl';
export { layoutSeatsFromPublished } from './bowlLayout/published';
export { layoutSeatsAuto } from './bowlLayout/auto';
export type { LayoutSeatsAutoOpts } from './bowlLayout/auto';
