import type { LevelId } from './navigation';

/** Link-budget X-ray rows, top (transmitter) to bottom (decision). */
export type XrayKey = 'pa' | 'tx' | 'eirp' | 'path' | 'losses' | 'rx' | 'rxpower' | 'ebn0' | 'margin';

/**
 * Which physical component each X-ray row points at, per level. Hovering a row
 * emphasises that component in 3D (equation ↔ hardware ↔ propagation).
 */
export const XRAY_TARGETS: Partial<Record<LevelId, Record<XrayKey, string>>> = {
  satellite: { pa: 'payload', tx: 'phased-array', eirp: 'user-beam', path: 'user-beam', losses: 'user-beam', rx: 'terminal', rxpower: 'terminal', ebn0: 'terminal', margin: 'terminal' },
  cosmos: { pa: 'hero', tx: 'hero', eirp: 'hero', path: 'downlink', losses: 'downlink', rx: 'user', rxpower: 'user', ebn0: 'user', margin: 'user' },
};

/** Callouts allowed in presentation mode (the poster stays uncluttered). */
export const PRESENTATION_LABELS = new Set(['hero', 'footprint', 'user', 'grating-area', 'phased-array', 'user-beam', 'terminal', 'service-area', 'beam', 'panel']);
