import type { Venue3DQuality, Venue3DQualityPreset, Venue3DQualitySettings } from '../types';

/**
 * `balanced` reproduces the renderer settings the viewer shipped with, so
 * omitting `quality` is a no-op for existing embeds.
 */
export const QUALITY_PRESETS: Record<
  Exclude<Venue3DQualityPreset, 'auto'>,
  Venue3DQualitySettings
> = {
  low: {
    dpr: [1, 1],
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    powerPreference: 'low-power',
    instancingThreshold: 80,
    lodDistance: 22,
    maxDecorativeSeats: 1200,
  },
  balanced: {
    dpr: [1, 1.25],
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
    powerPreference: 'low-power',
    instancingThreshold: 180,
    lodDistance: 38,
    maxDecorativeSeats: 6000,
  },
  high: {
    dpr: [1, 2],
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    powerPreference: 'high-performance',
    instancingThreshold: 400,
    lodDistance: Number.POSITIVE_INFINITY,
    maxDecorativeSeats: 20000,
  },
};

function detectPreset(): Exclude<Venue3DQualityPreset, 'auto'> {
  if (typeof window === 'undefined') return 'balanced';
  const cores = window.navigator?.hardwareConcurrency ?? 4;
  const dpr = window.devicePixelRatio ?? 1;
  if (cores <= 4 || dpr < 1) return 'low';
  if (cores >= 8 && dpr >= 2) return 'high';
  return 'balanced';
}

/** Merges a named preset or partial override set into full renderer settings. */
export function resolveQuality(quality?: Venue3DQuality): Venue3DQualitySettings {
  if (!quality) return QUALITY_PRESETS.balanced;
  if (typeof quality === 'string') {
    if (quality === 'auto') return QUALITY_PRESETS[detectPreset()];
    return QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.balanced;
  }
  return { ...QUALITY_PRESETS.balanced, ...quality };
}
