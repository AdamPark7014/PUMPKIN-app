import type { SeatMapData } from '@boletera/shared';
import { generateLayoutTemplate, type LayoutTemplateId } from '@boletera/venue-engine';
import { PrismaClient } from '../../generated/client';

const BATCH = 1500;

export async function persistLayout(
  prisma: PrismaClient,
  venueId: string,
  name: string,
  mapData: SeatMapData,
): Promise<{ layoutId: string; snapshot: SeatMapData; seatCount: number }> {
  let layout = await prisma.venueLayout.findFirst({ where: { venueId, name } });
  if (!layout) {
    layout = await prisma.venueLayout.create({
      data: { venueId, name, isActive: true, mapData: mapData as object },
    });
  }

  await prisma.seat.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.seatRow.deleteMany({ where: { section: { layoutId: layout.id } } });
  await prisma.section.deleteMany({ where: { layoutId: layout.id } });

  const seatRows: Array<{
    id: string;
    sectionId: string;
    rowId: string | null;
    label: string;
    x: number;
    y: number;
    rotation: number;
    tier: string | null;
  }> = [];

  for (let i = 0; i < mapData.sections.length; i++) {
    const sec = mapData.sections[i]!;
    const section = await prisma.section.create({
      data: {
        id: sec.id,
        layoutId: layout.id,
        name: sec.name,
        slug: sec.slug,
        color: sec.color,
        sortOrder: i,
      },
    });

    const rowLabels = Array.from(
      new Set(sec.seats.map((s) => s.row || s.label.split('-')[0] || 'A')),
    );
    const rowIds = new Map<string, string>();
    const rowPayload = rowLabels.map((label, ri) => ({
      id: `${section.id}-row-${label}`,
      sectionId: section.id,
      label,
      sortOrder: ri,
    }));
    if (rowPayload.length) {
      await prisma.seatRow.createMany({ data: rowPayload, skipDuplicates: true });
      for (const r of rowPayload) rowIds.set(r.label, r.id);
    }

    for (const seat of sec.seats) {
      const rowLabel = seat.row || seat.label.split('-')[0] || 'A';
      seatRows.push({
        id: seat.id,
        sectionId: section.id,
        rowId: rowIds.get(rowLabel) ?? null,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        rotation: seat.rotation ?? 0,
        tier: seat.tier ?? 'standard',
      });
    }
  }

  for (let i = 0; i < seatRows.length; i += BATCH) {
    await prisma.seat.createMany({
      data: seatRows.slice(i, i + BATCH),
      skipDuplicates: true,
    });
  }

  const snapshot: SeatMapData = {
    ...mapData,
    version: mapData.version ?? 3,
    sections: mapData.sections.map((sec) => ({
      ...sec,
      seats: sec.seats.map((s) => ({
        ...s,
        tier: s.tier ?? 'standard',
        row: s.row || s.label.split('-')[0],
      })),
    })),
  };

  await prisma.venueLayout.update({
    where: { id: layout.id },
    data: { mapData: snapshot as object, isActive: true },
  });

  return { layoutId: layout.id, snapshot, seatCount: seatRows.length };
}

export function templateMap(
  template: LayoutTemplateId,
  idPrefix: string,
  capacity: number,
): SeatMapData {
  return generateLayoutTemplate(template, { idPrefix, capacity });
}
