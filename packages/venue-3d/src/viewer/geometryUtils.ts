export function polylineCenter(points: [number, number, number][]) {
  if (!points.length) return [0, 0, 0] as [number, number, number];
  const sx = points.reduce((n, p) => n + p[0], 0) / points.length;
  const sy = points.reduce((n, p) => n + p[1], 0) / points.length;
  const sz = points.reduce((n, p) => n + p[2], 0) / points.length;
  return [sx, sy, sz] as [number, number, number];
}
