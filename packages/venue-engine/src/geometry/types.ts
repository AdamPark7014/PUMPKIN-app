import type {
  SeatMapAisle,
  SeatMapBounds,
  SeatMapData,
  SeatMapExit,
  SeatMapObstacle,
  SeatMapSeat,
  SeatMapSection,
  SeatMapStage,
  SeatMapStair,
  SeatMapVenueMeta,
  SeatVisibility,
} from '@boletera/shared';

/** Fully resolved seat pose ready for visualization / persistence */
export type ResolvedSeat = SeatMapSeat & {
  sectionId: string;
  sectionName: string;
  sectionColor: string;
  position: { x: number; y: number; z: number };
  rotation3d: { x: number; y: number; z: number };
  elevation: number;
  rowIndex: number;
  visibility: SeatVisibility;
};

export type ResolvedSection = {
  id: string;
  name: string;
  slug: string;
  color: string;
  shape?: SeatMapSection['shape'];
  rake?: number;
  seatPitch?: number;
  rowPitch?: number;
  curvature?: number;
  levelId?: string;
  seatIds: string[];
};

export type ResolvedVenueScene = {
  version: 3;
  seats: ResolvedSeat[];
  sections: ResolvedSection[];
  stage?: SeatMapStage;
  aisles: SeatMapAisle[];
  obstacles: SeatMapObstacle[];
  stairs: SeatMapStair[];
  exits: SeatMapExit[];
  furniture: NonNullable<SeatMapVenueMeta['furniture']>;
  levels: NonNullable<SeatMapVenueMeta['levels']>;
  bounds: SeatMapBounds;
  units: 'map' | 'meters';
  scale: number;
  /** Source map after migrate/normalize */
  map: SeatMapData;
};

export type ProjectedSeat2D = {
  id: string;
  sectionId: string;
  levelId?: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
  row?: string;
  color: string;
  tier?: string;
  visibility: SeatVisibility;
};

export type ProjectedScene2D = {
  seats: ProjectedSeat2D[];
  sections: ResolvedSection[];
  stage?: SeatMapStage;
  aisles: SeatMapAisle[];
  obstacles: SeatMapObstacle[];
  stairs: SeatMapStair[];
  exits: SeatMapExit[];
  furniture: NonNullable<SeatMapVenueMeta['furniture']>;
  bounds: SeatMapBounds;
};

export type ProjectedSeat3D = {
  id: string;
  label?: string;
  section?: string;
  row?: string;
  color?: string;
  tier?: string;
  status?: string;
  price?: number;
  levelId?: string;
  /** World X */
  px: number;
  /** World elevation Y */
  py: number;
  /** World depth Z */
  pz: number;
  /** Radians */
  rotX: number;
  rotY: number;
  rotZ: number;
  decorative?: boolean;
  rowIndex?: number;
  sectionIndex?: number;
  visibility: SeatVisibility;
};

export type SectionPlate3D = {
  name: string;
  color: string;
  levelId?: string;
  center: [number, number, number];
  width: number;
  depth: number;
  rotY: number;
  height: number;
};

export type ProjectedScene3D = {
  seats: ProjectedSeat3D[];
  plates: SectionPlate3D[];
  stageZ: number;
  stage?: {
    x: number;
    y: number;
    z: number;
    width: number;
    depth: number;
    rotation: number;
  };
  aisles: Array<{
    id: string;
    points: [number, number, number][];
    width?: number;
    levelId?: string;
  }>;
  obstacles: Array<{
    id: string;
    type: string;
    points: [number, number, number][];
    height: number;
    levelId?: string;
  }>;
  stairs: Array<{
    id: string;
    kind: string;
    points: [number, number, number][];
    width?: number;
    fromLevelId?: string;
    toLevelId?: string;
  }>;
  exits: Array<{
    id: string;
    label?: string;
    points: [number, number, number][];
    width?: number;
    levelId?: string;
  }>;
  furniture: Array<{
    id: string;
    type: string;
    label?: string;
    /** World position [x, elevY, z] */
    position: [number, number, number];
    rotation?: number;
    levelId?: string;
  }>;
  focusPoints: Array<{
    id: string;
    label?: string;
    /** World position [x, elevY, z] */
    position: [number, number, number];
    levelId?: string;
  }>;
};

export type GeometryIssue = {
  code:
    | 'overlap'
    | 'outside_shape'
    | 'missing_position'
    | 'unreachable_section'
    | 'long_egress'
    | 'egress_bottleneck'
    | 'slow_clearance'
    | 'no_exits';
  severity: 'warning' | 'error';
  seatIds: string[];
  sectionIds?: string[];
  message: string;
};

export type GeometryValidation = {
  ok: boolean;
  issues: GeometryIssue[];
};
