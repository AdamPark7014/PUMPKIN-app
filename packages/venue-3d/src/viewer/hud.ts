import type { Venue3DHud, Venue3DHudOptions } from '../types';

export type ResolvedHud = Required<Venue3DHudOptions>;

/** Legacy chrome: everything on except the FPS readout, which is opt-in. */
const HUD_ON: ResolvedHud = {
  badge: true,
  meta: true,
  levels: true,
  heat: true,
  egress: true,
  legend: true,
  sections: true,
  tooltip: true,
  selection: true,
  fps: false,
};

const HUD_OFF: ResolvedHud = {
  badge: false,
  meta: false,
  levels: false,
  heat: false,
  egress: false,
  legend: false,
  sections: false,
  tooltip: false,
  selection: false,
  fps: false,
};

export function resolveHud(hud?: Venue3DHud): ResolvedHud {
  if (hud === undefined || hud === true) return HUD_ON;
  if (hud === false) return HUD_OFF;
  return { ...HUD_ON, ...hud };
}

/** `true` when no overlay at all should be mounted. */
export function isHudEmpty(hud: ResolvedHud): boolean {
  return !Object.values(hud).some(Boolean);
}
