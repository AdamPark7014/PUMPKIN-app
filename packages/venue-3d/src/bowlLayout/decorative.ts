import type { LaidOutSeat } from './types';

export function buildDecorativeBowl(opts?: { dim?: boolean; skipInner?: number }): LaidOutSeat[] {
  const out: LaidOutSeat[] = [];
  const rows = 12;
  const skip = opts?.skipInner ?? 0;
  for (let r = skip; r < rows; r++) {
    const radius = 4.35 + r * 0.78;
    const height = 0.18 + r * 0.34;
    const count = 22 + r * 5;
    const span = Math.PI * 1.22;
    const start = -span / 2 - Math.PI / 2;
    for (let i = 0; i < count; i++) {
      if (i % 9 === 0) continue;
      const t = i / (count - 1);
      const angle = start + t * span;
      out.push({
        id: `deco-${r}-${i}`,
        decorative: true,
        status: 'sold',
        color: opts?.dim ? (r % 2 === 0 ? '#1f1f23' : '#26262b') : '#3f3f46',
        px: Math.cos(angle) * radius,
        py: height,
        pz: Math.sin(angle) * radius,
        rotY: -angle + Math.PI / 2,
        rotX: 0,
        rotZ: 0,
        rowIndex: r,
      });
    }
  }
  return out;
}
