import type {
  Venue3DLayerKey,
  Venue3DLayerOpacity,
  Venue3DLayerVisibility,
  Venue3DOpacityKey,
} from '../types';

export type ResolvedLayers = Record<Venue3DLayerKey, boolean>;
export type ResolvedOpacity = Record<Venue3DOpacityKey, number>;

const ALL_VISIBLE: ResolvedLayers = {
  seats: true,
  decorativeSeats: true,
  plates: true,
  aisles: true,
  obstacles: true,
  stairs: true,
  exits: true,
  furniture: true,
  focusPoints: true,
  stage: true,
  shell: true,
  egress: true,
};

const FULL_OPACITY: ResolvedOpacity = {
  seats: 1,
  furniture: 1,
  structure: 1,
  plates: 1,
};

/** Unspecified layers stay visible, so partial overrides are additive. */
export function resolveLayers(layers?: Venue3DLayerVisibility): ResolvedLayers {
  if (!layers) return ALL_VISIBLE;
  return { ...ALL_VISIBLE, ...layers };
}

export function resolveOpacity(opacity?: Venue3DLayerOpacity): ResolvedOpacity {
  if (!opacity) return FULL_OPACITY;
  const merged = { ...FULL_OPACITY, ...opacity };
  for (const key of Object.keys(merged) as Venue3DOpacityKey[]) {
    const value = merged[key];
    merged[key] = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
  }
  return merged;
}
