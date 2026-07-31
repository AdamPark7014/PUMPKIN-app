export * from './map-utils';
export * from './seatmap-canvas';
export * from './layout-templates';
export * from './geometry';
// Browser render engine is a separate entry — keep Node/API consumers DOM-free.
// import from '@boletera/venue-engine/render' in client apps.
