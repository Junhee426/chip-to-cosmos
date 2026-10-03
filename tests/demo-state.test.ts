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

describe('demo end policy (V4 follow-up)', () => {
  it('maps every mode × reason × starting screen to one end action', async () => {
    const { endAction } = await import('../src/app/demo-state');
    // completion
    expect(endAction('quick', 'complete', 'landing')).toEqual({ kind: 'poster' });
    expect(endAction('engineering', 'complete', 'poster')).toEqual({ kind: 'overview' });
    expect(endAction('grating', 'complete', 'hidden')).toEqual({ kind: 'overview' });
    // skip / error go back to where the demo started
    expect(endAction('quick', 'skip', 'landing')).toEqual({ kind: 'restore', screen: 'landing' });
    expect(endAction('quick', 'skip', 'poster')).toEqual({ kind: 'restore', screen: 'poster' });
    expect(endAction('grating', 'skip', 'poster')).toEqual({ kind: 'restore', screen: 'poster' });
    expect(endAction('quick', 'skip', 'hidden')).toEqual({ kind: 'restore', screen: 'stay' });
    expect(endAction('quick', 'error', 'poster')).toEqual({ kind: 'restore', screen: 'poster' });
    // explicit user intents are never overridden by a restore
    for (const start of ['landing', 'poster', 'hidden'] as const) {
      expect(endAction('quick', 'navigate', start)).toEqual({ kind: 'release' });
      expect(endAction('quick', 'explore', start)).toEqual({ kind: 'explore' });
    }
  });

  it('screen snapshots clone the camera and orbit (no live references)', async () => {
    const THREE = await import('three');
    const { snapshotScreen, sameViewport } = await import('../src/app/demo-state');
    const cam = { pos: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 1, 0) };
    const orbit = { time: 12.5, paused: true };
    const snap = snapshotScreen('poster', 'cosmos', cam, { width: 390, height: 844 }, orbit);
    cam.pos.set(9, 9, 9);
    cam.up!.set(1, 0, 0);
    orbit.time = 0;
    expect(snap.camera!.pos.toArray()).toEqual([1, 2, 3]);
    expect(snap.camera!.up!.toArray()).toEqual([0, 1, 0]);
    expect(snap.orbit).toEqual({ time: 12.5, paused: true });
    expect(sameViewport(snap.viewport, { width: 390, height: 844 })).toBe(true);
    expect(sameViewport(snap.viewport, { width: 1440, height: 900 })).toBe(false);
  });
});

describe('footprint tangent plane (inset source)', () => {
  it('the exported projection reproduces the solver extents exactly, with equal km on both axes', async () => {
    const { tangentPlaneKm } = await import('../src/models/array-factor');
    const { canonicalOrbit } = await import('../src/models/frames');
    for (const steerDeg of [0, 25, 50]) {
      const p = sanitizeParams({ ...DEFAULT_PARAMS, ...POSTER_STATE, steerDeg });
      const f = beamSolution(p).footprint;
      const pts = tangentPlaneKm(f.contour, f.center!, canonicalOrbit(p.altitudeKm).x);
      const span = (i: 0 | 1) => Math.max(...pts.map((q) => q[i])) - Math.min(...pts.map((q) => q[i]));
      expect(span(0)).toBeCloseTo(f.alongTrackKm, 9);
      expect(span(1)).toBeCloseTo(f.crossTrackKm, 9);
      // the centre is the origin of the plane
      expect(tangentPlaneKm([f.center!], f.center!, [1, 0, 0])[0]).toEqual([0, 0]);
    }
  });
});
