import { describe, expect, it } from 'vitest';
import { arrayMetrics, linearAF, planarAF, progressivePhase, weights } from '../src/models/array-factor';

describe('array factor', () => {
  it('uniform linear array is 1 at broadside', () => {
    expect(linearAF(8, 0.5, 0, weights(8, 'uniform'), 0)).toBeCloseTo(1, 12);
  });
  it('progressive phase steers the peak to θ0', () => {
    const w = weights(16, 'uniform');
    const phi = progressivePhase(0.5, 30);
    expect(linearAF(16, 0.5, phi, w, (30 * Math.PI) / 180)).toBeCloseTo(1, 9);
    expect(linearAF(16, 0.5, phi, w, 0)).toBeLessThan(0.3);
  });
  it('planar AF is unity in the steering direction', () => {
    const p = { n: 12, spacingLambda: 0.5, steerThetaDeg: 25, steerPhiDeg: 40, weighting: 'hamming' as const };
    expect(planarAF(p, weights(12, 'hamming'), (25 * Math.PI) / 180, (40 * Math.PI) / 180)).toBeCloseTo(1, 9);
  });
  it('16×16, λ/2, uniform: D ≈ 4πA/λ², HPBW ≈ 6.3°, SLL ≈ −13 dB', () => {
    const m = arrayMetrics({ n: 16, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' });
    expect(m.directivityDbi).toBeGreaterThan(27.5);
    expect(m.directivityDbi).toBeLessThan(30.5);
    expect(m.hpbwDeg).toBeGreaterThan(5.6);
    expect(m.hpbwDeg).toBeLessThan(7.2);
    expect(m.sidelobeDb).toBeGreaterThan(-14.5);
    expect(m.sidelobeDb).toBeLessThan(-12.5);
    expect(m.gratingLobe).toBe(false);
  });
  it('tapering lowers sidelobes and widens the beam', () => {
    const u = arrayMetrics({ n: 16, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' });
    const h = arrayMetrics({ n: 16, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'hann' });
    expect(h.sidelobeDb).toBeLessThan(u.sidelobeDb - 6);
    expect(h.hpbwDeg).toBeGreaterThan(u.hpbwDeg);
    expect(h.taperEfficiency).toBeLessThan(1);
  });
  it('gain grows ~6 dB per doubling of N (4× elements)', () => {
    const a = arrayMetrics({ n: 8, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' }).directivityDbi;
    const b = arrayMetrics({ n: 16, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' }).directivityDbi;
    expect(b - a).toBeGreaterThan(5.2);
    expect(b - a).toBeLessThan(6.6);
  });
  it('grating-lobe criterion', () => {
    expect(arrayMetrics({ n: 8, spacingLambda: 1.0, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' }).gratingLobe).toBe(true);
    expect(arrayMetrics({ n: 8, spacingLambda: 0.6, steerThetaDeg: 45, steerPhiDeg: 0, weighting: 'uniform' }).gratingLobe).toBe(true);
    expect(arrayMetrics({ n: 8, spacingLambda: 0.5, steerThetaDeg: 45, steerPhiDeg: 0, weighting: 'uniform' }).gratingLobe).toBe(false);
  });
});

import { beamFootprint } from '../src/models/array-factor';

describe('beam footprint (−3 dB, flat-Earth)', () => {
  const base = { n: 16, spacingLambda: 0.5, steerThetaDeg: 0, steerPhiDeg: 0, weighting: 'uniform' as const };
  it('broadside: a near-circle of diameter 2·h·tan(HPBW/2)', () => {
    const m = arrayMetrics(base);
    const f = beamFootprint(base, 550);
    const expected = 2 * 550 * Math.tan(((m.hpbwDeg / 2) * Math.PI) / 180);
    expect(f.alongKm).toBeGreaterThan(expected * 0.9);
    expect(f.alongKm).toBeLessThan(expected * 1.1);
    expect(f.acrossKm / f.alongKm).toBeGreaterThan(0.9);
    expect(Math.hypot(...f.centerKm)).toBeLessThan(1e-6);
  });
  it('steering moves the footprint and stretches it along the scan plane', () => {
    const f0 = beamFootprint(base, 550);
    const f = beamFootprint({ ...base, steerThetaDeg: 40 }, 550);
    expect(f.centerKm[0]).toBeCloseTo(550 * Math.tan((40 * Math.PI) / 180), 3);
    expect(f.alongKm).toBeGreaterThan(f0.alongKm * 1.5);
    expect(f.areaKm2).toBeGreaterThan(f0.areaKm2);
  });
  it('more elements → smaller footprint; higher orbit → larger footprint', () => {
    const a = beamFootprint(base, 550);
    expect(beamFootprint({ ...base, n: 32 }, 550).areaKm2).toBeLessThan(a.areaKm2 / 3);
    expect(beamFootprint(base, 1100).alongKm).toBeCloseTo(a.alongKm * 2, 0);
  });
});
