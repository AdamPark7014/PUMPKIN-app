export type BowlSeat = {
  id: string;
  label?: string;
  section?: string;
  row?: string;
  status?: 'available' | 'held' | 'sold' | 'blocked';
  color?: string;
  price?: number;
  x?: number;
  y?: number;
  z?: number;
  levelId?: string;
  /** Authored yaw in degrees from the 2D map editor */
  rotation?: number;
  elevation?: number;
  position?: { x: number; y: number; z: number };
  rotation3d?: { x: number; y: number; z: number };
  coord3d?: { x: number; y: number; z: number; pitch?: number; roll?: number };
  visibility?: {
    blocked?: boolean;
    restrictedView?: boolean;
    premiumView?: boolean;
  };
};

export type LaidOutSeat = BowlSeat & {
  px: number;
  py: number;
  pz: number;
  rotY: number;
  rotX?: number;
  rotZ?: number;
  decorative?: boolean;
  rowIndex?: number;
  sectionIndex?: number;
};

export type SectionPlate = {
  name: string;
  color: string;
  levelId?: string;
  center: [number, number, number];
  width: number;
  depth: number;
  rotY: number;
  height: number;
};

export type LayoutStageInput = {
  x: number;
  y: number;
  width: number;
  rotation?: number;
  elevation?: number;
};

export type LayoutAisleInput = {
  id: string;
  points: [number, number][];
  width?: number;
  levelId?: string;
};

export type LayoutObstacleInput = {
  id: string;
  type: string;
  points: [number, number][];
  height?: number;
  levelId?: string;
};

export type LayoutStairInput = {
  id: string;
  kind?: string;
  points: [number, number][];
  width?: number;
  fromLevelId?: string;
  toLevelId?: string;
};

export type LayoutExitInput = {
  id: string;
  points: [number, number][];
  width?: number;
  label?: string;
  levelId?: string;
};

export type LayoutFurnitureInput = {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation?: number;
  levelId?: string;
};

export type LayoutFocusPointInput = {
  id: string;
  label?: string;
  x: number;
  y: number;
  z?: number;
  levelId?: string;
};

export type LayoutGeometryOpts = {
  maxSeats?: number;
  stage?: LayoutStageInput;
  aisles?: LayoutAisleInput[];
  obstacles?: LayoutObstacleInput[];
  stairs?: LayoutStairInput[];
  exits?: LayoutExitInput[];
  furniture?: LayoutFurnitureInput[];
  focusPoints?: LayoutFocusPointInput[];
};

export type LayoutSceneExtras = {
  stagePose?: {
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
    position: [number, number, number];
    rotation?: number;
    levelId?: string;
  }>;
  focusPoints: Array<{
    id: string;
    label?: string;
    position: [number, number, number];
    levelId?: string;
  }>;
};

export const EMPTY_EXTRAS: LayoutSceneExtras = {
  aisles: [],
  obstacles: [],
  stairs: [],
  exits: [],
  furniture: [],
  focusPoints: [],
};
