import type { SeatMapShape } from '@boletera/shared';
import { analyzeCirculation } from './circulation';
import { resolveEgressPolicy } from './egress-report';
import type { GeometryIssue, GeometryValidation, ResolvedVenueScene } from './types';

export type ValidateGeometryOptions = {
  /**
   * When set, only validate seats/sections on this level (untagged included).
   * Overlaps between different levels are never reported, even without levelId.
   */
  levelId?: string;
};

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  if (points.length < 3) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function touchesLevel(
  levelId: string | undefined,
  entityLevelId: string | undefined,
): boolean {
  if (!levelId) return true;
  if (!entityLevelId) return true;
  return entityLevelId === levelId;
}

/**
 * Validate spatial integrity.
 * Overlaps are warnings by default; set venue.cadLocks.strictOverlaps to elevate to errors.
 */
export function validateGeometry(
  scene: ResolvedVenueScene,
  options?: ValidateGeometryOptions,
): GeometryValidation {
  const issues: GeometryIssue[] = [];
  const levelId = options?.levelId;
  const seats = levelId
    ? scene.seats.filter((s) => touchesLevel(levelId, s.levelId))
    : scene.seats;
  const sections = levelId
    ? scene.sections.filter((s) => touchesLevel(levelId, s.levelId))
    : scene.sections;
  const sectionIds = new Set(sections.map((s) => s.id));

  const strict = Boolean(scene.map.venue?.cadLocks?.strictOverlaps);
  const overlapSeverity = strict ? 'error' : 'warning';

  const pitchBySection = new Map(
    scene.sections.map((s) => [s.id, s.seatPitch ?? 26] as const),
  );

  // Spatial hash for overlap detection (same-level only)
  const cellSize = 12;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

  seats.forEach((s, i) => {
    const k = key(s.x, s.y);
    const arr = grid.get(k) ?? [];
    arr.push(i);
    grid.set(k, arr);
  });

  const reported = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    const a = seats[i];
    const minDist = (pitchBySection.get(a.sectionId) ?? 26) * 0.55;
    const cx = Math.floor(a.x / cellSize);
    const cy = Math.floor(a.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(`${cx + dx}:${cy + dy}`) ?? [];
        for (const j of neighbors) {
          if (j <= i) continue;
          const b = seats[j];
          // Stacked plan seats on different floors are not overlaps
          if (a.levelId && b.levelId && a.levelId !== b.levelId) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < minDist) {
            const pair = [a.id, b.id].sort().join('|');
            if (reported.has(pair)) continue;
            reported.add(pair);
            issues.push({
              code: 'overlap',
              severity: overlapSeverity,
              seatIds: [a.id, b.id],
              message: `Asientos ${a.label} y ${b.label} se solapan (dist ${dist.toFixed(1)} < ${minDist.toFixed(1)})`,
            });
          }
        }
      }
    }
  }

  for (const sec of sections) {
    const shape: SeatMapShape | undefined = sec.shape;
    if (!shape?.points?.length) continue;
    for (const seat of seats.filter((s) => s.sectionId === sec.id)) {
      if (!pointInPolygon(seat.x, seat.y, shape.points)) {
        issues.push({
          code: 'outside_shape',
          severity: 'warning',
          seatIds: [seat.id],
          message: `Asiento ${seat.label} fuera del contorno de ${sec.name}`,
        });
      }
    }
  }

  for (const seat of seats) {
    if (!seat.position || ![seat.position.x, seat.position.y, seat.position.z].every(Number.isFinite)) {
      issues.push({
        code: 'missing_position',
        severity: 'error',
        seatIds: [seat.id],
        message: `Asiento ${seat.label} sin posición 3D válida`,
      });
    }
  }

  const circulation = analyzeCirculation(scene);
  if (circulation.hasNetwork && circulation.unreachableSections.length) {
    for (const sectionId of circulation.unreachableSections) {
      if (!sectionIds.has(sectionId)) continue;
      const sec = scene.sections.find((s) => s.id === sectionId);
      issues.push({
        code: 'unreachable_section',
        severity: 'warning',
        seatIds: [],
        sectionIds: [sectionId],
        message: `Sección ${sec?.name ?? sectionId} sin ruta a salida (pasillo/escalera/exit)`,
      });
    }
  }

  // Venue-wide exit/clearance warnings only when not level-scoped
  if (!levelId && circulation.hasNetwork && circulation.seedMode === 'stage') {
    issues.push({
      code: 'no_exits',
      severity: 'warning',
      seatIds: [],
      sectionIds: [],
      message:
        'Sin salidas autoradas: el análisis mide acceso al escenario. Coloca salidas (tool Salida) para egress real.',
    });
  }

  const policy = resolveEgressPolicy(scene.map.venue?.egressPolicy);
  if (circulation.hasNetwork) {
    for (const secEg of circulation.egress.sections) {
      if (!sectionIds.has(secEg.sectionId)) continue;
      if (secEg.pathLength != null && secEg.pathLength > policy.longPathUnits) {
        issues.push({
          code: 'long_egress',
          severity: 'warning',
          seatIds: [],
          sectionIds: [secEg.sectionId],
          message: `Sección ${secEg.sectionName ?? secEg.sectionId}: ruta de salida larga (${Math.round(secEg.pathLength)}u)`,
        });
      }
    }
    if (!levelId) {
      for (const bn of circulation.egress.bottlenecks.slice(0, 3)) {
        if (
          bn.overCapacity ||
          (bn.utilization >= policy.bottleneckUtilization && bn.sectionCount >= 2)
        ) {
          issues.push({
            code: 'egress_bottleneck',
            severity: 'warning',
            seatIds: [],
            message: `Cuello de botella en ${bn.kind}: carga ${bn.seatLoad}/${bn.capacity} (${Math.round(bn.utilization * 100)}%, ancho ${bn.width}u, ~${bn.clearanceMinutes.toFixed(1)} min)`,
          });
        } else if (bn.seatLoad >= policy.bottleneckSeatLoad && bn.sectionCount >= 2) {
          issues.push({
            code: 'egress_bottleneck',
            severity: 'warning',
            seatIds: [],
            message: `Cuello de botella en ${bn.kind}: ~${bn.seatLoad} asientos / ${bn.sectionCount} secciones`,
          });
        }
      }
      if (
        circulation.egress.clearanceMinutes != null &&
        circulation.egress.clearanceMinutes > policy.slowClearanceMinutes
      ) {
        issues.push({
          code: 'slow_clearance',
          severity: 'warning',
          seatIds: [],
          message: `Vaciado estimado ~${circulation.egress.clearanceMinutes.toFixed(1)} min (umbral ${policy.slowClearanceMinutes} min)`,
        });
      }
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}
