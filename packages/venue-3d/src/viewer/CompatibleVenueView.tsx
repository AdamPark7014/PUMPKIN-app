'use client';

import { useMemo } from 'react';
import type { LaidOutSeat } from '../bowlLayout';
import styles from '../Venue3DViewer.module.css';

/** DOM-only isometric fallback shown when the WebGL context is lost or disposed. */
export function CompatibleVenueView({
  seats,
  note = 'Vista compatible · activa la aceleración por hardware para órbita 3D',
}: {
  seats: LaidOutSeat[];
  note?: string;
}) {
  const projected = useMemo(
    () =>
      seats.map((seat) => ({
        ...seat,
        sx: (seat.px - seat.pz) * 0.72,
        sy: (seat.px + seat.pz) * 0.36 - seat.py * 1.4,
      })),
    [seats],
  );

  const bounds = useMemo(() => {
    if (!projected.length) return { minX: -8, minY: -5, width: 16, height: 10 };
    const xs = projected.map((seat) => seat.sx);
    const ys = projected.map((seat) => seat.sy);
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minY = Math.min(...ys) - 1;
    const maxY = Math.max(...ys) + 1;
    return {
      minX,
      minY,
      width: Math.max(maxX - minX, 4),
      height: Math.max(maxY - minY, 3),
    };
  }, [projected]);

  const radius = Math.max(0.08, Math.min(0.22, bounds.width / 90));

  return (
    <div className={styles.compatibleView} role="img" aria-label="Vista compatible del venue">
      <svg
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="venue-seat-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0.08" stdDeviation="0.08" floodOpacity="0.7" />
          </filter>
        </defs>
        <ellipse
          cx={bounds.minX + bounds.width / 2}
          cy={bounds.minY + bounds.height * 0.62}
          rx={bounds.width * 0.42}
          ry={bounds.height * 0.27}
          fill="#111114"
          stroke="#27272a"
          strokeWidth={radius * 0.35}
        />
        {projected
          .slice()
          .sort((a, b) => a.sy - b.sy)
          .map((seat) => (
            <circle
              key={seat.id}
              cx={seat.sx}
              cy={seat.sy}
              r={seat.decorative ? radius * 0.72 : radius}
              fill={seat.status === 'blocked' ? '#52525b' : seat.color || '#5b9fd4'}
              stroke={seat.decorative ? 'none' : 'rgba(255,255,255,0.5)'}
              strokeWidth={radius * 0.12}
              opacity={seat.decorative ? 0.45 : 1}
              filter="url(#venue-seat-shadow)"
            />
          ))}
      </svg>
      <div className={styles.compatibleNote}>{note}</div>
    </div>
  );
}
