import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & {
  /** Lado en px. El símbolo es cuadrado. */
  size?: number;
  /** Cara tallada iluminada (true) o calabaza lisa (false). */
  lit?: boolean;
};

/**
 * Marca de Pumpkin Zone: calabaza tallada, dibujada para leerse desde 18px
 * (favicon, sidebar compacto) hasta 96px (login). Sin dependencias de tema:
 * los colores son los de la marca, no los del contexto, para que la calabaza
 * sea la calabaza sobre fondo claro u oscuro.
 */
export function PumpkinMark({ size = 32, lit = true, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Pumpkin Zone"
      {...rest}
    >
      <defs>
        <radialGradient id="pzmFlesh" cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor="#ff9a3c" />
          <stop offset="55%" stopColor="#ff6a13" />
          <stop offset="100%" stopColor="#9a3412" />
        </radialGradient>
        <radialGradient id="pzmGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd9a0" />
          <stop offset="100%" stopColor="#ffb454" />
        </radialGradient>
      </defs>

      {/* Tallo */}
      <path
        d="M32 17c-1.8-4.4.6-7.8 5.2-8.8"
        stroke="#4f7a2a"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      {/* Cuerpo con gajos */}
      <ellipse cx="32" cy="38" rx="26" ry="20" fill="url(#pzmFlesh)" />
      <ellipse cx="32" cy="38" rx="16" ry="20" fill="#000" opacity=".12" />
      <ellipse cx="32" cy="38" rx="7" ry="20" fill="#000" opacity=".1" />
      <ellipse cx="32" cy="38" rx="26" ry="20" stroke="#7a2d0a" strokeOpacity=".35" strokeWidth="1" />

      {lit && (
        <g fill="url(#pzmGlow)">
          {/* Ojos */}
          <path d="M19.5 35.5l7.5-4.5 1 6.5-8.5 1z" />
          <path d="M44.5 35.5l-7.5-4.5-1 6.5 8.5 1z" />
          {/* Sonrisa dentada */}
          <path d="M20.5 43.5c3.6 5 19.4 5 23 0-1.9 1-4.7.7-6-.9-1.5 1.8-4.2 1.8-5.7.2-1.5 1.6-4.2 1.6-5.7-.2-1.3 1.6-4.1 1.9-5.6.9z" />
        </g>
      )}
    </svg>
  );
}
