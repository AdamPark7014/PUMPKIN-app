import { sectionColor } from './colors';
import type { BowlSeat, LaidOutSeat, SectionPlate } from './types';

/**
 * Places every section in its own non-overlapping angular wedge of the bowl.
 * Demo / fallback only — never the default for published maps.
 */
export function wedgeLayout(
  bySection: Map<string, BowlSeat[]>,
  opts?: { span?: number; sectionOrder?: string[] },
): { seats: LaidOutSeat[]; plates: SectionPlate[] } {
  const sectionKeys = opts?.sectionOrder ?? Array.from(bySection.keys());
  const laid: LaidOutSeat[] = [];
  const plates: SectionPlate[] = [];

  const totalSections = Math.max(sectionKeys.length, 1);
  const bowlSpan = opts?.span ?? Math.PI * 1.22;
  const startAngle = -bowlSpan / 2 - Math.PI / 2;
  const aisleGap = 0.045;

  sectionKeys.forEach((key, secIdx) => {
    const group = bySection.get(key);
    if (!group || !group.length) return;
    const sorted = [...group].sort((a, b) => {
      const dy = (a.y ?? 0) - (b.y ?? 0);
      if (Math.abs(dy) > 0.5) return dy;
      return (a.x ?? 0) - (b.x ?? 0);
    });

    const rows: BowlSeat[][] = [];
    let current: BowlSeat[] = [];
    let lastY: number | null = null;
    for (const seat of sorted) {
      const y = seat.y ?? 0;
      if (lastY != null && Math.abs(y - lastY) > 10) {
        rows.push(current);
        current = [];
      }
      current.push(seat);
      lastY = y;
    }
    if (current.length) rows.push(current);
    if (!rows.length) rows.push(group);

    const secSpan = bowlSpan / totalSections;
    const secStart = startAngle + secIdx * secSpan + secSpan * aisleGap;
    const secEnd = startAngle + (secIdx + 1) * secSpan - secSpan * aisleGap;
    const color = group[0]?.color || sectionColor(key, secIdx);

    const midAngle = (secStart + secEnd) / 2;
    const midR = 4.6 + (rows.length - 1) * 0.38;
    plates.push({
      name: key,
      color,
      center: [Math.cos(midAngle) * midR, 0.02 + rows.length * 0.12, Math.sin(midAngle) * midR],
      width: Math.max(1.6, rows[0]?.length ? rows[0].length * 0.32 : 2.2),
      depth: Math.max(1.2, rows.length * 0.7),
      rotY: -midAngle + Math.PI / 2,
      height: 0.08 + rows.length * 0.05,
    });

    rows.forEach((rowSeats, rowIdx) => {
      const radius = 4.35 + rowIdx * 0.78 + secIdx * 0.04;
      const height = 0.22 + rowIdx * 0.34;
      const sortedRow = [...rowSeats].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const n = Math.max(sortedRow.length, 1);

      sortedRow.forEach((seat, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = secStart + t * (secEnd - secStart);
        const authored = typeof seat.rotation === 'number' ? seat.rotation : undefined;
        const rotY =
          authored != null && Number.isFinite(authored)
            ? (authored * Math.PI) / 180
            : -angle + Math.PI / 2;
        laid.push({
          ...seat,
          color: seat.color || color,
          px: Math.cos(angle) * radius,
          py: height,
          pz: Math.sin(angle) * radius,
          rotY,
          rotX: 0,
          rotZ: 0,
          rowIndex: rowIdx,
          sectionIndex: secIdx,
        });
      });
    });
  });

  return { seats: laid, plates };
}
