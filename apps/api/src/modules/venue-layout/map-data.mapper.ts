import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import type { Prisma } from '@prisma/client';

export type LayoutSeatRow = {
  id: string;
  label: string;
  x: number;
  y: number;
  rotation?: number | null;
  tier: string | null;
  coord3d: unknown;
  viewQuality?: number | null;
  row?: { label: string } | null;
};

export type LayoutSectionRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
  metadata?: unknown;
  seats: LayoutSeatRow[];
};

export type LayoutMapSource = {
  metadata?: unknown;
  sections: LayoutSectionRow[];
  mapData: unknown;
};

type Coord3dPayload = {
  x: number;
  y: number;
  z: number;
  pitch?: number;
  roll?: number;
  visibility?: SeatMapData['sections'][0]['seats'][0]['visibility'];
  levelId?: string;
  metadata?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asCoord3d(value: unknown): Coord3dPayload | null {
  const rec = asRecord(value);
  if (!rec) return null;
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number' || typeof rec.z !== 'number') {
    return null;
  }
  return {
    x: rec.x,
    y: rec.y,
    z: rec.z,
    pitch: typeof rec.pitch === 'number' ? rec.pitch : undefined,
    roll: typeof rec.roll === 'number' ? rec.roll : undefined,
    visibility: rec.visibility as Coord3dPayload['visibility'],
    levelId: typeof rec.levelId === 'string' ? rec.levelId : undefined,
    metadata: asRecord(rec.metadata) ?? undefined,
  };
}

export function layoutToMapData(layout: LayoutMapSource): SeatMapData {
  if (layout.sections.length > 0) {
    const stored = (layout.mapData as SeatMapData | null) ?? null;
    const sections = layout.sections.map((sec) => {
      const meta = asRecord(sec.metadata) ?? {};
      return {
        id: sec.id,
        name: sec.name,
        slug: sec.slug,
        color: sec.color,
        shape: (meta.shape as SeatMapSection['shape']) ?? undefined,
        blocks: (meta.blocks as SeatMapSection['blocks']) ?? undefined,
        rake: typeof meta.rake === 'number' ? meta.rake : undefined,
        seatPitch: typeof meta.seatPitch === 'number' ? meta.seatPitch : undefined,
        rowPitch: typeof meta.rowPitch === 'number' ? meta.rowPitch : undefined,
        curvature: typeof meta.curvature === 'number' ? meta.curvature : undefined,
        levelId: typeof meta.levelId === 'string' ? meta.levelId : undefined,
        seats: sec.seats.map((s) => {
          const c3 = asCoord3d(s.coord3d);
          const visibility =
            c3?.visibility ??
            (s.viewQuality != null
              ? s.viewQuality <= 0
                ? { blocked: true }
                : s.viewQuality <= 0.5
                  ? { restrictedView: true }
                  : s.viewQuality >= 0.95
                    ? { premiumView: true }
                    : undefined
              : undefined);
          return {
            id: s.id,
            label: s.label,
            x: s.x,
            y: s.y,
            rotation: s.rotation ?? undefined,
            tier: s.tier ?? 'standard',
            row: s.row?.label ?? undefined,
            coord3d: c3
              ? { x: c3.x, y: c3.y, z: c3.z, pitch: c3.pitch, roll: c3.roll }
              : undefined,
            position: c3 ? { x: c3.x, y: c3.y, z: c3.z } : undefined,
            elevation: c3?.y,
            rotation3d:
              c3 || s.rotation != null
                ? {
                    x: c3?.pitch ?? 0,
                    y: s.rotation ?? 0,
                    z: c3?.roll ?? 0,
                  }
                : undefined,
            visibility,
            levelId: c3?.levelId,
            metadata: c3?.metadata,
          };
        }),
      };
    });
    const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
    const ys = sections.flatMap((s) => s.seats.map((seat) => seat.y));
    const pad = 40;
    const minX = (xs.length ? Math.min(...xs) : 0) - pad;
    const minY = (ys.length ? Math.min(...ys) : 0) - pad;
    const maxX = (xs.length ? Math.max(...xs) : 800) + pad;
    const maxY = (ys.length ? Math.max(...ys) : 500) + pad;
    return {
      version: 3,
      sections,
      viewport: {
        minX,
        minY,
        width: Math.max(maxX - minX, 100),
        height: Math.max(maxY - minY, 100),
      },
      venue: stored?.venue ?? (layout.metadata as SeatMapData['venue']) ?? undefined,
    };
  }
  return (layout.mapData as SeatMapData) ?? {
    version: 3,
    sections: [],
    viewport: { width: 800, height: 500, minX: 0, minY: 0 },
  };
}

export function seatCoord3d(
  seat: SeatMapData['sections'][0]['seats'][0],
): Prisma.InputJsonValue | undefined {
  const elev = seat.elevation ?? seat.position?.y ?? seat.coord3d?.y ?? 0;
  const x = seat.position?.x ?? seat.coord3d?.x ?? seat.x;
  const z = seat.position?.z ?? seat.coord3d?.z ?? seat.y;
  const pitch = seat.rotation3d?.x ?? seat.coord3d?.pitch;
  const roll = seat.rotation3d?.z ?? seat.coord3d?.roll;
  const payload: Record<string, unknown> = {
    x,
    y: elev,
    z,
    ...(pitch != null ? { pitch } : {}),
    ...(roll != null ? { roll } : {}),
    ...(seat.visibility ? { visibility: seat.visibility } : {}),
    ...(seat.levelId ? { levelId: seat.levelId } : {}),
    ...(seat.metadata ? { metadata: seat.metadata } : {}),
  };
  return payload as unknown as Prisma.InputJsonValue;
}

export function viewQualityFromVisibility(
  visibility: SeatMapData['sections'][0]['seats'][0]['visibility'],
): number | null {
  if (!visibility) return null;
  if (visibility.blocked) return 0;
  if (visibility.restrictedView) return 0.4;
  if (visibility.premiumView) return 1;
  return null;
}

export function asSeatMapData(value: unknown): SeatMapData | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as SeatMapData;
  if (!Array.isArray(rec.sections)) return null;
  return rec;
}
