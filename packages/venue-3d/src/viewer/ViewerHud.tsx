'use client';

import type { EgressOverlayScene3D } from '@boletera/venue-engine';
import type { LaidOutSeat } from '../bowlLayout';
import type { Venue3DHeatMode } from '../types';
import styles from '../Venue3DViewer.module.css';
import type { ResolvedHud } from './hud';

type SightlineMeta = {
  heatBySeat: Map<string, string>;
  gradeBySeat: Map<string, string>;
  summary: { premium: number };
};

type ViewerHudProps = {
  hud: ResolvedHud;
  levels: { id: string; name: string }[];
  levelFilter: string | 'ALL';
  onLevelFilterChange: (levelId: string | 'ALL') => void;
  interactiveCount: number;
  autoOrbit: boolean;
  heatMode: Venue3DHeatMode;
  onToggleHeat: (mode: Exclude<Venue3DHeatMode, 'off'>) => void;
  hasPricedSeats: boolean;
  hasMapData: boolean;
  priceRange: { min: number; max: number } | null;
  sightlineMeta: SightlineMeta | null;
  showEgress: boolean;
  onToggleEgress: () => void;
  egressOverlay: EgressOverlayScene3D | null;
  selectedCount: number;
  selectedIds: Set<string>;
  hover: LaidOutSeat | null;
  currency: string;
  sections: { name: string; color: string; count: number }[];
  fps: number;
};

/** All DOM chrome drawn on top of the canvas. Fully suppressible via `hud={false}`. */
export function ViewerHud({
  hud,
  levels,
  levelFilter,
  onLevelFilterChange,
  interactiveCount,
  autoOrbit,
  heatMode,
  onToggleHeat,
  hasPricedSeats,
  hasMapData,
  priceRange,
  sightlineMeta,
  showEgress,
  onToggleEgress,
  egressOverlay,
  selectedCount,
  selectedIds,
  hover,
  currency,
  sections,
  fps,
}: ViewerHudProps) {
  const showHeatToolbar = hud.heat && (hasPricedSeats || hasMapData);
  const showEgressToolbar = hud.egress && hasMapData;
  const showLevels = hud.levels && levels.length > 0;
  const showTopBar =
    hud.badge || hud.meta || showLevels || showHeatToolbar || showEgressToolbar || hud.fps;
  const showBottomBar = hud.legend || (hud.sections && sections.length > 0);

  return (
    <>
      {showTopBar && (
        <div className={styles.overlayTop}>
          <div className={styles.topLeft}>
            {hud.badge && <span className={styles.badge}>Venue 3D</span>}
            {hud.meta && (
              <span className={styles.meta}>
                {interactiveCount} asientos
                {levelFilter !== 'ALL'
                  ? ` · ${levels.find((l) => l.id === levelFilter)?.name ?? 'nivel'}`
                  : ''}
                {' · '}
                {autoOrbit ? 'rotación auto' : 'órbita libre'}
                {hud.fps && fps > 0 ? ` · ${fps} FPS` : ''}
              </span>
            )}
            {!hud.meta && hud.fps && fps > 0 && (
              <span className={styles.meta}>{fps} FPS</span>
            )}
            {showLevels && (
              <div className={styles.levelBar} role="toolbar" aria-label="Niveles">
                <button
                  type="button"
                  className={levelFilter === 'ALL' ? styles.levelActive : styles.levelBtn}
                  onClick={() => onLevelFilterChange('ALL')}
                >
                  Todos
                </button>
                {levels.map((lv) => (
                  <button
                    key={lv.id}
                    type="button"
                    className={levelFilter === lv.id ? styles.levelActive : styles.levelBtn}
                    onClick={() => onLevelFilterChange(lv.id)}
                  >
                    {lv.name}
                  </button>
                ))}
              </div>
            )}
            {(showHeatToolbar || showEgressToolbar) && (
              <div className={styles.levelBar} role="toolbar" aria-label="Heat y salidas">
                {showHeatToolbar && hasPricedSeats && (
                  <button
                    type="button"
                    className={heatMode === 'price' ? styles.levelActive : styles.levelBtn}
                    aria-pressed={heatMode === 'price'}
                    onClick={() => onToggleHeat('price')}
                  >
                    Precio
                  </button>
                )}
                {showHeatToolbar && hasMapData && (
                  <button
                    type="button"
                    className={heatMode === 'view' ? styles.levelActive : styles.levelBtn}
                    aria-pressed={heatMode === 'view'}
                    onClick={() => onToggleHeat('view')}
                  >
                    Vistas
                  </button>
                )}
                {showEgressToolbar && (
                  <button
                    type="button"
                    className={showEgress ? styles.levelActive : styles.levelBtn}
                    aria-pressed={showEgress}
                    onClick={onToggleEgress}
                  >
                    Salidas
                  </button>
                )}
              </div>
            )}
            {hud.heat && heatMode === 'price' && priceRange && (
              <div className={styles.viewHeatBar} aria-hidden>
                <span>
                  ${priceRange.min.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                </span>
                <div className={styles.priceHeatScale} />
                <span>
                  ${priceRange.max.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
            {hud.heat && heatMode === 'view' && sightlineMeta && (
              <>
                <div className={styles.viewHeatBar} aria-hidden>
                  <span>Mala</span>
                  <div className={styles.viewHeatScale} />
                  <span>Buena</span>
                </div>
                <p className={styles.egressHint} role="status" aria-live="polite">
                  Heat de vista · {sightlineMeta.heatBySeat.size} asientos
                  {sightlineMeta.summary.premium
                    ? ` · ${sightlineMeta.summary.premium} premium`
                    : ''}
                </p>
              </>
            )}
            {hud.egress && showEgress && egressOverlay && (
              <p
                className={styles.egressHint}
                id="egress-3d-status"
                role="status"
                aria-live="polite"
              >
                {egressOverlay.hasNetwork
                  ? `Rutas · ${egressOverlay.paths.length} sección(es)${
                      egressOverlay.clearanceMinutes != null
                        ? ` · ~${egressOverlay.clearanceMinutes.toFixed(1)} min`
                        : ''
                    }`
                  : 'Sin red de pasillos/salidas'}
              </p>
            )}
            {hud.egress && showEgress && (
              <ul
                className={styles.egressLegend}
                id="egress-3d-legend"
                aria-label="Leyenda de salidas"
              >
                <li>
                  <i className={styles.swatchRoute} aria-hidden /> Ruta
                </li>
                <li>
                  <i className={styles.swatchRouteActive} aria-hidden /> Activa
                </li>
                <li>
                  <i className={styles.swatchBottleneck} aria-hidden /> Cuello
                </li>
              </ul>
            )}
          </div>
          {hud.selection && selectedCount > 0 && (
            <span className={styles.selBadge}>{selectedCount} elegidos</span>
          )}
        </div>
      )}

      {hud.tooltip && hover && !hover.decorative && (
        <div className={styles.tooltip}>
          <strong>{hover.label || 'Asiento'}</strong>
          <span>
            {hover.section || 'Zona'}
            {typeof hover.price === 'number' && hover.price > 0
              ? ` · $${hover.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ${currency}`
              : ''}
            {heatMode === 'view' && sightlineMeta?.gradeBySeat.has(hover.id)
              ? ` · vista ${sightlineMeta.gradeBySeat.get(hover.id)}`
              : ''}
          </span>
          <em>Click para {selectedIds.has(hover.id) ? 'quitar' : 'elegir'}</em>
        </div>
      )}

      {showBottomBar && (
        <div className={styles.overlayBottom}>
          {hud.legend && (
            <ul className={styles.legend}>
              <li>
                <i
                  className={
                    heatMode === 'view'
                      ? styles.legHeat
                      : heatMode === 'price'
                        ? styles.legPrice
                        : styles.legAvail
                  }
                />{' '}
                {heatMode === 'view'
                  ? 'Color = vista'
                  : heatMode === 'price'
                    ? 'Color = precio'
                    : 'Color = zona'}
              </li>
              <li>
                <i className={styles.legSel} /> Elegido
              </li>
              <li>
                <i className={styles.legSold} /> No disponible
              </li>
            </ul>
          )}
          {hud.sections && sections.length > 0 && (
            <ul className={styles.sections}>
              {sections.slice(0, 6).map((s) => (
                <li key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name}
                  <em>{s.count}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
