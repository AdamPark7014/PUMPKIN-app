import type { SeatMapBlock, SeatMapData, SeatMapSeat, SeatMapSection } from '@boletera/shared';
import { generateBlock, generateCurvedRow, generateStraightRow } from './geometry/generators';

export type LayoutTemplateId = 'arena' | 'theater' | 'stadium' | 'festival';

export type TemplateOptions = {
  capacity?: number;
  sectionCount?: number;
  /** Stable id prefix so reseed can be deterministic */
  idPrefix?: string;
};

function seatId(prefix: string, sec: string, row: string, n: number) {
  return `${prefix}-${sec}-${row}-${n}`;
}

function viewportFromSections(
  sections: SeatMapSection[],
  pad = 48,
): NonNullable<SeatMapData['viewport']> {
  const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
  const ys = sections.flatMap((s) => s.seats.map((seat) => seat.y));
  if (!xs.length) return { minX: 0, minY: 0, width: 900, height: 600 };
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, width: Math.max(maxX - minX, 200), height: Math.max(maxY - minY, 200) };
}

function pack(sections: SeatMapSection[], stageCx?: number): SeatMapData {
  const viewport = viewportFromSections(sections);
  const xs = sections.flatMap((s) => s.seats.map((seat) => seat.x));
  const cx =
    stageCx ??
    (xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (viewport.minX ?? 0) + viewport.width / 2);
  const stageWidth = Math.min(320, Math.max(220, viewport.width * 0.36));
  const stageY = (viewport.minY ?? 0) + 10;
  return {
    version: 3,
    sections,
    viewport,
    venue: {
      units: 'map',
      scale: 1,
      stage: {
        x: Math.round(cx - stageWidth / 2),
        y: stageY,
        width: Math.round(stageWidth),
        elevation: 40,
      },
    },
  };
}

function withIds(
  seats: SeatMapSeat[],
  prefix: string,
  slug: string,
): SeatMapSeat[] {
  return seats.map((s, i) => {
    const row = s.row ?? 'A';
    const num = Number(String(s.label).split('-').pop()) || i + 1;
    return {
      ...s,
      id: seatId(prefix, slug, row, num),
    };
  });
}

/**
 * Curved bowl facing stage at top (low Y).
 * Sections are angular wedges with clear aisle gaps so labels/colors read as zones.
 */
export function generateArenaTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'arena';
  const capacity = opts.capacity ?? 240;
  const sectionCount = Math.min(6, Math.max(2, opts.sectionCount ?? 4));
  const perSection = Math.floor(capacity / sectionCount);
  const palette = [
    { name: 'Lateral Izq', slug: 'lateral-izq', color: '#5b9fd4' },
    { name: 'Preferente', slug: 'preferente', color: '#c45c6a' },
    { name: 'Platea', slug: 'platea', color: '#c4a35a' },
    { name: 'Lateral Der', slug: 'lateral-der', color: '#5a9e78' },
    { name: 'General', slug: 'general', color: '#7a8fd4' },
    { name: 'Mezzanine', slug: 'mezzanine', color: '#b87a9a' },
  ];
  const cx = 450;
  const cy = 400;
  const span = Math.PI * 1.05;
  const start = Math.PI + (Math.PI - span) / 2;
  const aisleGap = 0.07;
  const seatPitch = 22;
  const rowPitch = 30;
  const rake = 14;

  const sections: SeatMapSection[] = [];
  for (let s = 0; s < sectionCount; s++) {
    const meta = palette[s % palette.length];
    const seats: SeatMapSeat[] = [];
    const rows = Math.max(4, Math.min(8, Math.ceil(Math.sqrt(perSection / 2))));
    const secSpan = span / sectionCount;
    const a0 = start + s * secSpan + aisleGap;
    const a1 = start + (s + 1) * secSpan - aisleGap;

    let n = 0;
    for (let r = 0; r < rows && n < perSection; r++) {
      const rowLabel = String.fromCharCode(65 + r);
      const radius = 155 + r * rowPitch;
      const arcLen = Math.max(0.01, (a1 - a0) * radius);
      const cols = Math.max(3, Math.min(Math.floor(arcLen / seatPitch), perSection - n));
      const rowSeats = generateCurvedRow({
        center: { x: cx, y: cy },
        radius,
        count: cols,
        span: a1 - a0,
        startAngle: a0,
        seatPitch,
        elevation: r * rake,
        rake: 0,
        rowLabel,
        idPrefix: `${prefix}-${meta.slug}`,
        tier: r < 2 ? 'premium' : r >= rows - 2 ? 'economy' : 'standard',
        yScale: 0.78,
      });
      for (const seat of rowSeats) {
        if (n >= perSection) break;
        seats.push({
          ...seat,
          id: seatId(prefix, meta.slug, rowLabel, n + 1),
          label: `${rowLabel}-${n + 1}`,
        });
        n += 1;
      }
    }

    sections.push({
      id: `${prefix}-sec-${meta.slug}`,
      name: meta.name,
      slug: meta.slug,
      color: meta.color,
      rake,
      seatPitch,
      rowPitch,
      curvature: 1,
      seats,
    });
  }

  return pack(sections);
}

/** Horseshoe theater — stage top, curved orchestra + balcony */
export function generateTheaterTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'theater';
  const capacity = opts.capacity ?? 180;
  const colors = { orch: '#e11d48', left: '#38bdf8', right: '#f59e0b', balc: '#22c55e' };
  const sections: SeatMapSection[] = [];
  const rake = 12;
  const seatPitch = 28;
  const rowPitch = 26;

  {
    const max = Math.floor(capacity * 0.45);
    const rows = 8;
    const cols = 14;
    const orchBlock: SeatMapBlock = {
      id: `${prefix}-orch`,
      label: 'Luneta',
      origin: { x: 180 + ((cols - 1) * seatPitch) / 2, y: 120 },
      rows,
      seatsPerRow: cols,
      seatPitch,
      rowPitch,
      rake,
      curvature: 8,
      yaw: 0,
      elevation: 0,
      startRowLabel: 'A',
      skipColumns: [6, 7],
    };
    const blockSeats = generateBlock(orchBlock);
    const seats = withIds(blockSeats.slice(0, max), prefix, 'orch').map((s, i) => ({
      ...s,
      tier: (s.row?.charCodeAt(0) ?? 65) < 68 ? 'premium' : 'standard',
      id: seatId(prefix, 'orch', s.row ?? 'A', i + 1),
    }));
    sections.push({
      id: `${prefix}-sec-orch`,
      name: 'Luneta',
      slug: 'luneta',
      color: colors.orch,
      rake,
      seatPitch,
      rowPitch,
      curvature: 8,
      blocks: [orchBlock],
      seats,
    });
  }

  for (const side of [
    { slug: 'izq', name: 'Palco Izq', color: colors.left, x0: 70, yaw: 12 },
    { slug: 'der', name: 'Palco Der', color: colors.right, x0: 680, yaw: -12 },
  ] as const) {
    const sideBlock: SeatMapBlock = {
      id: `${prefix}-${side.slug}`,
      label: side.name,
      origin: { x: side.x0 + 1.5 * 26, y: 140 },
      rows: 6,
      seatsPerRow: 4,
      seatPitch: 26,
      rowPitch: 30,
      rake: 10,
      yaw: side.yaw,
      elevation: 80,
      tier: 'premium',
    };
    const seats = withIds(generateBlock(sideBlock), prefix, side.slug);
    sections.push({
      id: `${prefix}-sec-${side.slug}`,
      name: side.name,
      slug: side.slug,
      color: side.color,
      rake: 10,
      seatPitch: 26,
      rowPitch: 30,
      blocks: [sideBlock],
      seats,
    });
  }

  {
    const balcBlock: SeatMapBlock = {
      id: `${prefix}-balc`,
      label: 'Balcón',
      origin: { x: 140 + (17 * 28) / 2, y: 360 },
      rows: 4,
      seatsPerRow: 18,
      seatPitch: 28,
      rowPitch: 28,
      rake: 16,
      elevation: 160,
      curvature: 4,
      tier: 'economy',
      skipColumns: [8, 9],
    };
    const seats = withIds(generateBlock(balcBlock), prefix, 'balc');
    sections.push({
      id: `${prefix}-sec-balc`,
      name: 'Balcón',
      slug: 'balcon',
      color: colors.balc,
      rake: 16,
      seatPitch: 28,
      rowPitch: 28,
      curvature: 4,
      blocks: [balcBlock],
      seats,
    });
  }

  return pack(sections);
}

/** Sports stadium — north/south/east/west tribunes */
export function generateStadiumTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'stadium';
  const capacity = opts.capacity ?? 320;
  const per = Math.floor(capacity / 4);
  const rake = 18;
  const seatPitch = 26;
  const rowPitch = 24;

  const defs = [
    {
      slug: 'norte',
      name: 'Tribuna Norte',
      color: '#22c55e',
      origin: { x: 160 + 9.5 * seatPitch, y: 60 },
      rows: 5,
      cols: 20,
      facing: 0,
      elev: 0,
    },
    {
      slug: 'sur',
      name: 'Tribuna Sur',
      color: '#e11d48',
      origin: { x: 160 + 9.5 * seatPitch, y: 420 },
      rows: 5,
      cols: 20,
      facing: 180,
      elev: 0,
    },
    {
      slug: 'este',
      name: 'Preferente Este',
      color: '#38bdf8',
      origin: { x: 720 + 2.5 * seatPitch, y: 120 },
      rows: 10,
      cols: 6,
      facing: -90,
      elev: 40,
    },
    {
      slug: 'oeste',
      name: 'Preferente Oeste',
      color: '#f59e0b',
      origin: { x: 40 + 2.5 * seatPitch, y: 120 },
      rows: 10,
      cols: 6,
      facing: 90,
      elev: 40,
    },
  ] as const;

  const sections: SeatMapSection[] = defs.map((d, di) => {
    const skip = Array.from({ length: d.cols }, (_, c) => c).filter((c) => c > 0 && c % 7 === 0);
    const block: SeatMapBlock = {
      id: `${prefix}-${d.slug}`,
      label: d.name,
      origin: d.origin,
      rows: d.rows,
      seatsPerRow: d.cols,
      seatPitch,
      rowPitch,
      rake,
      yaw: 0,
      elevation: d.elev,
      tier: di < 2 ? 'standard' : 'premium',
      skipColumns: skip,
    };
    const generated = generateBlock({
      ...block,
      facing: d.facing,
    });
    const seats = withIds(generated.slice(0, per), prefix, d.slug).map((s, i) => ({
      ...s,
      id: seatId(prefix, d.slug, s.row ?? 'A', i + 1),
      tier: di < 2 ? ((s.row?.charCodeAt(0) ?? 65) < 67 ? 'premium' : 'standard') : 'premium',
    }));
    return {
      id: `${prefix}-sec-${d.slug}`,
      name: d.name,
      slug: d.slug,
      color: d.color,
      rake,
      seatPitch,
      rowPitch,
      blocks: [block],
      seats,
    };
  });

  return pack(sections);
}

/**
 * Festival: GA pit + numbered side stands.
 */
export function generateFestivalTemplate(opts: TemplateOptions = {}): SeatMapData {
  const prefix = opts.idPrefix ?? 'fest';
  const sections: SeatMapSection[] = [];
  const cx = 450;
  const gaCols = 10;
  const gaPitch = 28;
  const gaHalf = ((gaCols - 1) * gaPitch) / 2;
  const latCols = 5;
  const latPitch = 26;
  const latSpan = (latCols - 1) * latPitch;
  const aisle = 90;
  const rake = 10;

  {
    const seats = withIds(
      generateStraightRow({
        origin: { x: cx, y: 110 },
        count: 16,
        seatPitch: 26,
        yaw: 0,
        elevation: 0,
        rowLabel: 'V',
        idPrefix: `${prefix}-vip`,
        tier: 'premium',
      }),
      prefix,
      'vip',
    );
    sections.push({
      id: `${prefix}-sec-vip`,
      name: 'VIP Front',
      slug: 'vip',
      color: '#a67c52',
      seatPitch: 26,
      rowPitch: 28,
      rake: 0,
      seats,
    });
  }

  {
    const gaBlock: SeatMapBlock = {
      id: `${prefix}-ga`,
      label: 'Pista GA',
      origin: { x: cx, y: 160 },
      rows: 6,
      seatsPerRow: gaCols,
      seatPitch: gaPitch,
      rowPitch: 28,
      rake: 4,
      elevation: 0,
      startRowLabel: 'A',
      tier: 'standard',
    };
    const seats = withIds(generateBlock(gaBlock), prefix, 'ga').map((s, i) => ({
      ...s,
      row: 'GA',
      label: `GA-${i + 1}`,
      id: seatId(prefix, 'ga', 'P', i + 1),
    }));
    sections.push({
      id: `${prefix}-sec-ga`,
      name: 'Pista GA',
      slug: 'ga',
      color: '#9f4258',
      rake: 4,
      seatPitch: gaPitch,
      rowPitch: 28,
      blocks: [gaBlock],
      seats,
    });
  }

  const latLeftX0 = cx - gaHalf - aisle - latSpan;
  const latRightX0 = cx + gaHalf + aisle;
  for (const side of [
    { slug: 'lat-a', name: 'Lateral A', color: '#5b8fb8', x0: latLeftX0 },
    { slug: 'lat-b', name: 'Lateral B', color: '#5a8f72', x0: latRightX0 },
  ] as const) {
    const latBlock: SeatMapBlock = {
      id: `${prefix}-${side.slug}`,
      label: side.name,
      origin: { x: side.x0 + latSpan / 2, y: 140 },
      rows: 8,
      seatsPerRow: latCols,
      seatPitch: latPitch,
      rowPitch: 28,
      rake,
      elevation: 20,
      tier: 'economy',
    };
    const seats = withIds(generateBlock(latBlock), prefix, side.slug);
    sections.push({
      id: `${prefix}-sec-${side.slug}`,
      name: side.name,
      slug: side.slug,
      color: side.color,
      rake,
      seatPitch: latPitch,
      rowPitch: 28,
      blocks: [latBlock],
      seats,
    });
  }

  return pack(sections, cx);
}

export function generateLayoutTemplate(
  template: LayoutTemplateId,
  opts: TemplateOptions = {},
): SeatMapData {
  switch (template) {
    case 'theater':
      return generateTheaterTemplate(opts);
    case 'stadium':
      return generateStadiumTemplate(opts);
    case 'festival':
      return generateFestivalTemplate(opts);
    case 'arena':
    default:
      return generateArenaTemplate(opts);
  }
}

/** Heuristic: map free-text prompt → template + capacity */
export function suggestTemplateFromPrompt(prompt: string): {
  template: LayoutTemplateId;
  capacity: number;
} {
  const p = prompt.toLowerCase();
  let template: LayoutTemplateId = 'arena';
  if (/teatro|obra|ballet|ópera|opera|auditorio/.test(p)) template = 'theater';
  else if (/estadio|fútbol|futbol|partido|deport/.test(p)) template = 'stadium';
  else if (/festival|open.?air|ga|pista|outdoor/.test(p)) template = 'festival';
  else if (/arena|concierto|música|musica|show/.test(p)) template = 'arena';

  const num = prompt.match(/(\d{2,5})\s*(asientos|personas|cap)/i);
  const capacity = num ? Math.min(2000, Math.max(40, parseInt(num[1], 10))) : undefined;
  const defaults: Record<LayoutTemplateId, number> = {
    arena: 240,
    theater: 180,
    stadium: 320,
    festival: 200,
  };
  return { template, capacity: capacity ?? defaults[template] };
}
