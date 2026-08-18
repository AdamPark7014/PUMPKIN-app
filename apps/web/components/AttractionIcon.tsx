import type { Attraction } from '@/lib/event-config';

type Props = { name: Attraction['icon']; className?: string };

/**
 * Íconos de línea dibujados a mano, 24×24, `currentColor`.
 * Inline y no una fuente de íconos: son ocho, pesan menos que la petición
 * que costaría traerlos, y así heredan el color del tema sin trucos.
 */
export function AttractionIcon({ name, className }: Props) {
  const common = {
    className,
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'pumpkin':
      return (
        <svg {...common}>
          <path d="M12 6.5c-1-1.6-.4-3.2 1.4-3.9" />
          <path d="M12 21c-3.6 0-5.6-2.6-5.6-6.2S8.4 6.5 12 6.5s5.6 4.7 5.6 8.3S15.6 21 12 21Z" />
          <path d="M12 6.6v14.3M8.6 7.6c-1 2-1.3 4.4-1.1 6.9M15.4 7.6c1 2 1.3 4.4 1.1 6.9" />
        </svg>
      );
    case 'ghost':
      return (
        <svg {...common}>
          <path d="M5 20V10a7 7 0 0 1 14 0v10l-2.3-1.8L14.4 20l-2.4-1.8L9.6 20l-2.3-1.8L5 20Z" />
          <path d="M9.5 10.5h.01M14.5 10.5h.01" />
        </svg>
      );
    case 'film':
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
          <path d="M2.5 9.5h19M2.5 14.5h19M7 5.5v13M17 5.5v13" />
        </svg>
      );
    case 'axe':
      return (
        <svg {...common}>
          <path d="M14 3.5c3 .6 5.5 2.6 6.4 5.4-2.4 1.4-5.2 1.3-7.6-.2" />
          <path d="M12.8 8.7 4 17.5 6.5 20l8.8-8.8" />
        </svg>
      );
    case 'ferris':
      return (
        <svg {...common}>
          <circle cx="12" cy="10" r="6.5" />
          <path d="M12 3.5v13M5.5 10h13M7.4 5.4l9.2 9.2M16.6 5.4l-9.2 9.2M9 20.5h6L12 16.5 9 20.5Z" />
        </svg>
      );
    case 'market':
      return (
        <svg {...common}>
          <path d="M3.5 8.5h17l-1 3a2.5 2.5 0 0 1-2.4 1.8H6.9A2.5 2.5 0 0 1 4.5 11.5l-1-3Z" />
          <path d="M5 8.5 7 4h10l2 4.5M6 13.3V20h12v-6.7" />
        </svg>
      );
    case 'paw':
      return (
        <svg {...common}>
          <path d="M12 13.5c2.2 0 4 1.7 4 3.6 0 1.5-1.2 2.4-2.6 2.4h-2.8c-1.4 0-2.6-.9-2.6-2.4 0-1.9 1.8-3.6 4-3.6Z" />
          <path d="M7.5 8.5c.8 0 1.4.9 1.4 2s-.6 2-1.4 2-1.4-.9-1.4-2 .6-2 1.4-2ZM16.5 8.5c.8 0 1.4.9 1.4 2s-.6 2-1.4 2-1.4-.9-1.4-2 .6-2 1.4-2ZM11 5c.8 0 1.4.9 1.4 2s-.6 2-1.4 2-1.4-.9-1.4-2 .6-2 1.4-2Z" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 21c3.3 0 5.5-2.1 5.5-5.1 0-3.6-3.2-5.4-3.9-9.4-2 1.2-2.8 3.1-2.6 5.1-1-.5-1.6-1.5-1.7-2.7C7.6 10.3 6.5 12.4 6.5 15c0 3.3 2.2 6 5.5 6Z" />
        </svg>
      );
  }
}
