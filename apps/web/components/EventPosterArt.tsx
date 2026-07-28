import type { CSSProperties } from 'react';
import styles from './EventPosterArt.module.scss';

export type PosterEvent = {
  id: string;
  slug: string;
  title: string;
  category?: string | null;
  image?: string | null;
  bannerImage?: string | null;
  startsAt?: string;
  /** CSS aspect-ratio from DB metadata, e.g. "3/4", "16/9", "1/1" */
  posterAspect?: string | null;
};

function defaultAspect(category: string | null | undefined): string {
  switch (category) {
    case 'FESTIVAL':
      return '16/9';
    case 'SPORTS':
      return '1/1';
    case 'THEATER':
      return '2/3';
    case 'COMEDY':
      return '4/5';
    default:
      return '3/4';
  }
}

function hash(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function palette(category: string | null | undefined, seed: string) {
  const h = hash(seed) % 360;
  switch (category) {
    case 'SPORTS':
      return { a: '#0c4a6e', b: '#0284c7', c: '#e11d48', glow: 'rgba(2,132,199,0.45)' };
    case 'THEATER':
      return { a: '#1c1917', b: '#a16207', c: '#e11d48', glow: 'rgba(161,98,7,0.4)' };
    case 'COMEDY':
      return { a: '#431407', b: '#c2410c', c: '#fb923c', glow: 'rgba(194,65,12,0.4)' };
    case 'FESTIVAL':
      return { a: '#4c0519', b: '#be123c', c: '#fb7185', glow: 'rgba(225,29,72,0.5)' };
    default:
      return {
        a: `hsl(${h} 42% 12%)`,
        b: `hsl(${(h + 24) % 360} 55% 22%)`,
        c: '#e11d48',
        glow: 'rgba(225,29,72,0.45)',
      };
  }
}

function initials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function EventPosterArt({
  event,
  size = 'md',
  showDate,
}: {
  event: PosterEvent;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  showDate?: boolean;
}) {
  const colors = palette(event.category, event.slug || event.id);
  const src = event.bannerImage || event.image;
  const d = event.startsAt ? new Date(event.startsAt) : null;
  const aspect = event.posterAspect || defaultAspect(event.category);
  const style = {
    ['--pa']: colors.a,
    ['--pb']: colors.b,
    ['--pc']: colors.c,
    ['--glow']: colors.glow,
    ['--poster-aspect']: aspect,
  } as CSSProperties;

  return (
    <div
      className={`${styles.poster} ${styles[size]}`}
      style={style}
      data-aspect={aspect}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={styles.photo} />
      ) : (
        <div className={styles.art}>
          <svg className={styles.rings} viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice">
            <defs>
              <radialGradient id={`g-${event.id}`} cx="35%" cy="30%" r="70%">
                <stop offset="0%" stopColor={colors.c} stopOpacity="0.55" />
                <stop offset="55%" stopColor={colors.b} stopOpacity="0.35" />
                <stop offset="100%" stopColor={colors.a} stopOpacity="1" />
              </radialGradient>
            </defs>
            <rect width="200" height="260" fill={`url(#g-${event.id})`} />
            <circle cx="100" cy="118" r="78" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" />
            <circle cx="100" cy="118" r="54" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
            <circle cx="100" cy="118" r="28" fill="none" stroke={colors.c} strokeWidth="2" opacity="0.85" />
            <path
              d="M20 220 Q100 180 180 220"
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="1.5"
            />
            <path
              d="M30 235 Q100 200 170 235"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1.5"
            />
          </svg>
          <span className={styles.mark}>{initials(event.title)}</span>
          <span className={styles.brand}>BOLETERA</span>
        </div>
      )}
      {showDate && d && (
        <div className={styles.date}>
          <strong>{d.toLocaleDateString('es-MX', { day: '2-digit' })}</strong>
          <span>{d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')}</span>
        </div>
      )}
    </div>
  );
}
