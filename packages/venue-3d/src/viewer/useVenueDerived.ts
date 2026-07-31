import { useMemo } from 'react';
import {
  calculateSightlines,
  priceHeatColor,
  projectEgressOverlaysTo3D,
  resolveGeometry,
  sightlineHeatColor,
} from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import { layoutSeatsAuto, sectionColor, type BowlSeat } from '../bowlLayout';
import type { Seat3D, Venue3DHeatMode } from '../types';

export type VenueDerivedInput = {
  seats: Seat3D[];
  stage?: { x: number; y: number; width: number; rotation?: number; elevation?: number };
  aisles?: { id: string; points: [number, number][]; width?: number; levelId?: string }[];
  obstacles?: {
    id: string;
    type: string;
    points: [number, number][];
    height?: number;
    levelId?: string;
  }[];
  stairs?: {
    id: string;
    kind?: string;
    points: [number, number][];
    width?: number;
    fromLevelId?: string;
    toLevelId?: string;
  }[];
  exits?: {
    id: string;
    points: [number, number][];
    width?: number;
    label?: string;
    levelId?: string;
  }[];
  furniture?: {
    id: string;
    type: string;
    x: number;
    y: number;
    rotation?: number;
    levelId?: string;
  }[];
  focusPoints?: { id: string; label?: string; x: number; y: number; z?: number; levelId?: string }[];
  levels: { id: string; name: string; elevation?: number; zIndex?: number }[];
  levelFilter: string | 'ALL';
  mapData: SeatMapData | null;
  showEgress: boolean;
  heatMode: Venue3DHeatMode;
  selectedIds: string[];
};

export function useVenueDerived(input: VenueDerivedInput) {
  const {
    seats,
    stage,
    aisles: aislesProp,
    obstacles: obstaclesProp,
    stairs: stairsProp,
    exits: exitsProp,
    furniture: furnitureProp,
    focusPoints: focusPointsProp,
    levels: levelsProp,
    levelFilter,
    mapData,
    showEgress,
    heatMode,
    selectedIds,
  } = input;

  const levels = useMemo(() => {
    const list = [...levelsProp];
    list.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    return list;
  }, [levelsProp]);

  const layout = useMemo(() => {
    const enriched: BowlSeat[] = seats.map((s, i) => ({
      ...s,
      color: s.color || sectionColor(s.section || String(i)),
    }));
    return layoutSeatsAuto(enriched, {
      mode: 'published',
      stage,
      aisles: aislesProp,
      obstacles: obstaclesProp,
      stairs: stairsProp,
      exits: exitsProp,
      furniture: furnitureProp,
      focusPoints: focusPointsProp,
    });
  }, [
    seats,
    stage,
    aislesProp,
    obstaclesProp,
    stairsProp,
    exitsProp,
    furnitureProp,
    focusPointsProp,
  ]);

  const {
    seats: laidOutAll,
    plates: platesAll,
    stageZ,
    stagePose,
    aisles: aislesAll,
    obstacles: obstaclesAll,
    stairs: stairsAll,
    exits: exitsAll,
    furniture: furnitureAll,
    focusPoints: focusPointsAll,
  } = layout;

  const laidOut = useMemo(() => {
    if (levelFilter === 'ALL') return laidOutAll;
    return laidOutAll.filter((s) => !s.levelId || s.levelId === levelFilter);
  }, [laidOutAll, levelFilter]);

  const plates = useMemo(() => {
    if (levelFilter === 'ALL') return platesAll;
    return platesAll.filter((p) => !p.levelId || p.levelId === levelFilter);
  }, [platesAll, levelFilter]);

  const aisles = useMemo(() => {
    if (levelFilter === 'ALL') return aislesAll;
    return aislesAll.filter((a) => !a.levelId || a.levelId === levelFilter);
  }, [aislesAll, levelFilter]);

  const obstacles = useMemo(() => {
    if (levelFilter === 'ALL') return obstaclesAll;
    return obstaclesAll.filter((o) => !o.levelId || o.levelId === levelFilter);
  }, [obstaclesAll, levelFilter]);

  const stairs = useMemo(() => {
    if (levelFilter === 'ALL') return stairsAll;
    return stairsAll.filter((st) => {
      if (!st.fromLevelId && !st.toLevelId) return true;
      return st.fromLevelId === levelFilter || st.toLevelId === levelFilter;
    });
  }, [stairsAll, levelFilter]);

  const exits = useMemo(() => {
    if (levelFilter === 'ALL') return exitsAll;
    return exitsAll.filter((e) => !e.levelId || e.levelId === levelFilter);
  }, [exitsAll, levelFilter]);

  const furniture = useMemo(() => {
    if (levelFilter === 'ALL') return furnitureAll;
    return furnitureAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [furnitureAll, levelFilter]);

  const focusPoints = useMemo(() => {
    if (levelFilter === 'ALL') return focusPointsAll;
    return focusPointsAll.filter((f) => !f.levelId || f.levelId === levelFilter);
  }, [focusPointsAll, levelFilter]);

  const egressOverlay = useMemo(() => {
    if (!showEgress || !mapData) return null;
    return projectEgressOverlaysTo3D(mapData, {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
  }, [showEgress, mapData, levelFilter]);

  const priceRange = useMemo(() => {
    const prices: number[] = [];
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price === 'number' && Number.isFinite(s.price) && s.price > 0) {
        prices.push(s.price);
      }
    }
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [laidOut]);

  const sightlineMeta = useMemo(() => {
    if (heatMode !== 'view' || !mapData) return null;
    const result = calculateSightlines(resolveGeometry(mapData), {
      levelId: levelFilter === 'ALL' ? undefined : levelFilter,
    });
    const heatBySeat = new Map<string, string>();
    const gradeBySeat = new Map<string, string>();
    for (const s of result.scores) {
      heatBySeat.set(s.seatId, sightlineHeatColor(s.score));
      gradeBySeat.set(s.seatId, s.grade);
    }
    return { heatBySeat, gradeBySeat, summary: result.summary };
  }, [heatMode, mapData, levelFilter]);

  const priceHeatBySeat = useMemo(() => {
    if (heatMode !== 'price' || !priceRange) return null;
    const heatBySeat = new Map<string, string>();
    for (const s of laidOut) {
      if (s.decorative) continue;
      if (typeof s.price !== 'number' || !Number.isFinite(s.price)) continue;
      heatBySeat.set(s.id, priceHeatColor(s.price, priceRange.min, priceRange.max));
    }
    return heatBySeat.size ? heatBySeat : null;
  }, [heatMode, laidOut, priceRange]);

  const heatBySeat =
    heatMode === 'view' ? sightlineMeta?.heatBySeat : heatMode === 'price' ? priceHeatBySeat : null;

  const hasPricedSeats = Boolean(priceRange && priceRange.max > 0);
  const showHeatToolbar = hasPricedSeats || Boolean(mapData);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const interactiveCount = useMemo(
    () => laidOut.reduce((n, s) => (s.decorative ? n : n + 1), 0),
    [laidOut],
  );

  const sections = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const s of laidOut) {
      if (s.decorative || !s.section) continue;
      const cur = map.get(s.section) ?? {
        name: s.section,
        color: s.color || sectionColor(s.section),
        count: 0,
      };
      cur.count += 1;
      map.set(s.section, cur);
    }
    return Array.from(map.values());
  }, [laidOut]);

  return {
    levels,
    laidOut,
    plates,
    stageZ,
    stagePose,
    aisles,
    obstacles,
    stairs,
    exits,
    furniture,
    focusPoints,
    egressOverlay,
    priceRange,
    sightlineMeta,
    heatBySeat,
    hasPricedSeats,
    showHeatToolbar,
    selectedSet,
    interactiveCount,
    sections,
  };
}
