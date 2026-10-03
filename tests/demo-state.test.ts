import { describe, expect, it } from 'vitest';
import { createStore, PARAM_LIMITS, sanitizeParams, type Params } from '../src/app/state';
import { restorePatch, snapshotDemoState } from '../src/app/demo-state';
import { BEAM_PRESETS, GRATING_SPACING, POSTER_STATE, POSTER_STEER } from '../src/app/beam-presets';
import { beamSolution } from '../src/app/system';
import { DEFAULT_PARAMS } from '../src/app/state';
import { XRAY_TARGETS } from '../src/app/xray';

describe('demo state restoration (skip)', () => {
  it('a skipped demo gives back mode, presentation, labels and every parameter it changed', () => {
    const store = createStore();
    store.set({ mode: 'thermal', labels: false });
    store.setParams({ arrayN: 24, steerDeg: -12, weighting: 'hamming', powerMode: 'per-element-fixed', paOutW: 2.5, altitudeKm: 800 });
    const before = store.get();
    const snap = snapshotDemoState(before);
    // what the quick demo does
    store.set({ mode: 'signal', presentation: true, labels: true });
    store.setParams({ ...POSTER_STATE, steerDeg: 17 });
    const r = restorePatch(snap);
    store.set(r.state);
    store.setParams(r.params);
    const after = store.get();
    expect(after.mode).toBe('thermal');
    expect(after.presentation).toBe(false);
    expect(after.labels).toBe(false);
    for (const k of Object.keys(snap.params) as (keyof Params)[]) expect(after.params[k], k).toBe(before.params[k]);
  });
});

describe('poster state', () => {
  it('is a valid, in-domain parameter set (sanitize leaves it unchanged)', () => {
    expect(sanitizeParams(POSTER_STATE)).toEqual(POSTER_STATE);
    expect(POSTER_STEER.min).toBeGreaterThanOrEqual(PARAM_LIMITS.steerDeg.min);
    expect(POSTER_STEER.max).toBeLessThanOrEqual(PARAM_LIMITS.steerDeg.max);
  });

  it('produces a steered beam with an Earth footprint, a link and no grating lobe', () => {
    const b = beamSolution({ ...DEFAULT_PARAMS, ...POSTER_STATE });
    expect(b.power.mode).toBe('total-rf-fixed');
    expect(b.lobes).toHaveLength(0);
    expect(b.footprint.center).not.toBeNull();
    expect(b.footprint.nadirOffsetKm!).toBeGreaterThan(150);
    expect(b.link).not.toBeNull();
  });

  it('the Try-it range keeps a footprint and a link at both ends (550 km)', () => {
    for (const steerDeg of [POSTER_STEER.min, POSTER_STEER.max]) {
      const b = beamSolution({ ...DEFAULT_PARAMS, ...POSTER_STATE, steerDeg });
      expect(b.footprint.center, String(steerDeg)).not.toBeNull();
      expect(b.link, String(steerDeg)).not.toBeNull();
    }
  });

  it('the grating demo spacing really crosses the threshold and lights a second Earth area', () => {
    const steered = BEAM_PRESETS.find((p) => p.id === 'steered')!.params;
    const lim = beamSolution({ ...DEFAULT_PARAMS, ...steered }).pattern.gratingLimit;
    expect(GRATING_SPACING).toBeGreaterThan(lim);
    expect(GRATING_SPACING).toBeLessThanOrEqual(PARAM_LIMITS.spacingLambda.max);
    const g = beamSolution({ ...DEFAULT_PARAMS, ...steered, spacingLambda: GRATING_SPACING });
    expect(g.secondary.length).toBeGreaterThan(0);
  });

  it('every X-ray row maps to a component on the levels that offer the X-ray', () => {
    for (const [level, map] of Object.entries(XRAY_TARGETS)) {
      expect(Object.keys(map!).sort(), level).toEqual(['ebn0', 'eirp', 'losses', 'margin', 'pa', 'path', 'rx', 'rxpower', 'tx']);
    }
  });
});
