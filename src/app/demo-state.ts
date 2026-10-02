import type { AppState, EngMode, Params } from './state';

/** What a demo may change and must give back when the user skips it. */
export interface DemoSnapshot {
  mode: EngMode;
  presentation: boolean;
  labels: boolean;
  params: Partial<Params>;
}

const DEMO_PARAMS: (keyof Params)[] = ['arrayN', 'spacingLambda', 'steerDeg', 'steerAzDeg', 'weighting', 'powerMode', 'paOutW', 'totalRfW', 'altitudeKm', 'freqGHz', 'rxGainDbi'];

export function snapshotDemoState(s: AppState): DemoSnapshot {
  const params: Partial<Params> = {};
  for (const k of DEMO_PARAMS) (params as Record<string, unknown>)[k] = s.params[k];
  return { mode: s.mode, presentation: s.presentation, labels: s.labels, params };
}

/** The store patch that restores a snapshot (parameters go through setParams/sanitize). */
export function restorePatch(snap: DemoSnapshot): { state: Pick<AppState, 'mode' | 'presentation' | 'labels'>; params: Partial<Params> } {
  return { state: { mode: snap.mode, presentation: snap.presentation, labels: snap.labels }, params: { ...snap.params } };
}
