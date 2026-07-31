import { resolveGeometry, projectTo3D } from '@boletera/venue-engine';
import { sectionColor } from './colors';
import {
  EMPTY_EXTRAS,
  type BowlSeat,
  type LaidOutSeat,
  type LayoutGeometryOpts,
  type LayoutSceneExtras,
  type SectionPlate,
} from './types';

function bowlsToSeatMap(seats: BowlSeat[], opts?: LayoutGeometryOpts) {
  const bySection = new Map<string, BowlSeat[]>();
  for (const s of seats) {
    const key = s.section || 'General';
    const arr = bySection.get(key) ?? [];
    arr.push(s);
    bySection.set(key, arr);
  }

  const stage = opts?.stage;
  return {
    version: 3 as const,
    venue: {
      ...(stage
        ? {
            stage: {
              x: stage.x,
              y: stage.y,
              width: stage.width,
              rotation: stage.rotation,
              elevation: stage.elevation,
            },
          }
        : {}),
      aisles: opts?.aisles,
      obstacles: opts?.obstacles,
      stairs: opts?.stairs,
      exits: opts?.exits,
      furniture: opts?.furniture as
        | {
            id: string;
            type: 'led' | 'speaker' | 'door';
            x: number;
            y: number;
            rotation?: number;
            levelId?: string;
          }[]
        | undefined,
      focusPoints: opts?.focusPoints,
    },
    sections: Array.from(bySection.entries()).map(([name, group], i) => ({
      id: `sec-${i}`,
      name,
      slug: `sec-${i}`,
      color: group[0]?.color || sectionColor(name, i),
      levelId: group[0]?.levelId,
      seats: group.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        row: s.row,
        x: s.x ?? 0,
        y: s.y ?? 0,
        rotation: s.rotation,
        elevation: s.elevation,
        position: s.position,
        rotation3d: s.rotation3d,
        coord3d: s.coord3d,
        visibility: s.visibility,
        levelId: s.levelId,
      })),
    })),
  };
}

/**
 * Project published venue geometry via the Venue Geometry Engine.
 * Prefer authored elevation / position / rotation3d — never invent bowl wedges.
 */
export function layoutSeatsFromPublished(
  seats: BowlSeat[],
  opts?: LayoutGeometryOpts,
): { seats: LaidOutSeat[]; plates: SectionPlate[]; stageZ: number } & LayoutSceneExtras {
  const max = opts?.maxSeats ?? 1200;
  const list = seats.slice(0, max).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (list.length < 1) {
    return { seats: [], plates: [], stageZ: -6.6, ...EMPTY_EXTRAS };
  }

  const metaById = new Map(list.map((s) => [s.id, s]));
  const scene = resolveGeometry(
    bowlsToSeatMap(list, {
      stage: opts?.stage,
      aisles: opts?.aisles,
      obstacles: opts?.obstacles,
      stairs: opts?.stairs,
      exits: opts?.exits,
      furniture: opts?.furniture,
      focusPoints: opts?.focusPoints,
    }),
  );
  const projected = projectTo3D(scene, { maxSeats: max });

  const laid: LaidOutSeat[] = projected.seats.map((p) => {
    const src = metaById.get(p.id);
    return {
      ...src,
      id: p.id,
      label: p.label ?? src?.label,
      section: p.section ?? src?.section,
      row: p.row ?? src?.row,
      status: src?.status,
      color: p.color || src?.color,
      price: src?.price,
      x: src?.x,
      y: src?.y,
      z: src?.z,
      levelId: p.levelId ?? src?.levelId,
      rotation: src?.rotation,
      elevation: src?.elevation,
      visibility: p.visibility ?? src?.visibility,
      px: p.px,
      py: p.py,
      pz: p.pz,
      rotY: p.rotY,
      rotX: p.rotX,
      rotZ: p.rotZ,
      rowIndex: p.rowIndex,
      sectionIndex: p.sectionIndex,
    };
  });

  return {
    seats: laid,
    plates: projected.plates,
    stageZ: projected.stageZ,
    stagePose: projected.stage,
    aisles: projected.aisles,
    obstacles: projected.obstacles,
    stairs: projected.stairs,
    exits: projected.exits,
    furniture: projected.furniture,
    focusPoints: projected.focusPoints,
  };
}
