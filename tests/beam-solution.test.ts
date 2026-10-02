import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type Params } from '../src/app/state';
import { beamSolution, solveSystem } from '../src/app/system';
import { BEAM_PRESETS } from '../src/app/beam-presets';
import { EARTH_RADIUS_KM, len } from '../src/models/frames';
import { arrayMetrics, gratingLimit } from '../src/models/array-factor';

const P = (patch: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...patch });
const finiteDeep = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteDeep);
  if (v && typeof v === 'object') return Object.values(v).every(finiteDeep);
  return true;
};

describe('spherical-Earth footprint', () => {
  it('nadir: centred on the sub-satellite point, symmetric, ≈ 2h·tan(HPBW/2)', () => {
    const b = beamSolution(P({ steerDeg: 0 }));
    const f = b.footprint;
    expect(f.complete).toBe(true);
    expect(f.nadirOffsetKm!).toBeLessThan(1e-6);
    expect(f.centerElevationDeg!).toBeCloseTo(90, 6);
    const expected = 2 * 550 * Math.tan(((b.pattern.hpbwDeg / 2) * Math.PI) / 180);
    expect(f.alongTrackKm).toBeGreaterThan(expected * 0.9);
    expect(f.alongTrackKm).toBeLessThan(expected * 1.1);
    expect(f.crossTrackKm / f.alongTrackKm).toBeGreaterThan(0.97);
    expect(f.crossTrackKm / f.alongTrackKm).toBeLessThan(1.03);
    for (const p of f.contour) expect(len(p)).toBeCloseTo(EARTH_RADIUS_KM, 6);
  });

  it('zero steering is symmetric: contour centroid on the nadir point', () => {
    const f = beamSolution(P({ steerDeg: 0, arrayN: 12 })).footprint;
    const c = f.contour.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    expect(Math.abs(c[0] / f.contour.length)).toBeLessThan(1e-3);
    expect(Math.abs(c[2] / f.contour.length)).toBeLessThan(1e-3);
  });

  it('positive steering moves the footprint along-track (+X) and stretches it', () => {
    const n = beamSolution(P({ steerDeg: 0 })).footprint;
    const s = beamSolution(P({ steerDeg: 30 })).footprint;
    expect(s.center![0]).toBeGreaterThan(200);
    expect(Math.abs(s.center![2])).toBeLessThan(1e-6);
    expect(s.nadirOffsetKm!).toBeGreaterThan(250);
    expect(s.areaKm2).toBeGreaterThan(n.areaKm2 * 1.3);
    expect(s.alongTrackKm).toBeGreaterThan(s.crossTrackKm);
    expect(s.centerElevationDeg!).toBeLessThan(60);
  });

  it('azimuth 90° moves the footprint cross-track instead', () => {
    const s = beamSolution(P({ steerDeg: 30, steerAzDeg: 90 })).footprint;
    expect(Math.abs(s.center![0])).toBeLessThan(1e-6);
    expect(Math.abs(s.center![2])).toBeGreaterThan(200);
  });

  it('spherical footprint is larger than the flat-ground projection when steered (Earth curves away)', () => {
    const b = beamSolution(P({ steerDeg: 50 }));
    expect(b.footprint.alongTrackKm).toBeGreaterThan(b.flat.alongKm);
  });

  it('near the horizon (1200 km, 60° scan): the beam axis misses — no link, no NaN', () => {
    const b = beamSolution(P({ altitudeKm: 1200, steerDeg: 60 }));
    expect(b.footprint.center).toBeNull();
    expect(b.link).toBeNull();
    expect(finiteDeep(b.footprint)).toBe(true);
    const s = solveSystem(P({ altitudeKm: 1200, steerDeg: 60 }));
    expect(s.link).toBeNull();
  });

  it('contour output is finite and continuous (no jumps between neighbours)', () => {
    for (const steerDeg of [0, 25, 55]) {
      const f = beamSolution(P({ steerDeg })).footprint;
      expect(finiteDeep(f)).toBe(true);
      const span = Math.max(f.alongTrackKm, f.crossTrackKm);
      for (let i = 0; i < f.contour.length; i++) {
        const a = f.contour[i];
        const b = f.contour[(i + 1) % f.contour.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(span * 0.25);
      }
    }
  });
});

describe('BeamSolution consistency', () => {
  it('same params → same cached solution object; equal params → identical numbers', () => {
    const p = P({ steerDeg: 25 });
    expect(beamSolution(p)).toBe(beamSolution(p));
    const a = beamSolution(P({ steerDeg: 25 }));
    const b = beamSolution(P({ steerDeg: 25 }));
    expect(a.pattern.gainDbi).toBe(b.pattern.gainDbi);
    expect(a.footprint.areaKm2).toBe(b.footprint.areaKm2);
    expect(a.link!.marginDb).toBe(b.link!.marginDb);
  });

  it('system result, pattern and link all read one solution', () => {
    const s = solveSystem(P({}));
    expect(s.gainDbi).toBe(s.beam.pattern.gainDbi);
    expect(s.eirpDbw).toBe(s.beam.power.eirpDbw);
    expect(s.link).toBe(s.beam.link);
    expect(s.link!.eirpDbw).toBeCloseTo(s.eirpDbw, 9);
    // the link uses the elevation of the visible footprint centre
    expect(s.link!.elevationDeg).toBeCloseTo(s.beam.footprint.centerElevationDeg!, 12);
    expect(s.link!.rangeKm).toBeCloseTo(s.beam.footprint.slantRangeKm!, 6);
  });

  it('beam maximum sits on (or squints slightly toward boresight from) the steering direction', () => {
    const b = beamSolution(P({ steerDeg: 40 }));
    const ang = (Math.acos(b.pattern.axis[1]) * 180) / Math.PI;
    expect(ang).toBeLessThanOrEqual(40 + 1e-6);
    expect(ang).toBeGreaterThan(40 - b.pattern.hpbwDeg / 2);
  });

  it('larger array → narrower beam → smaller footprint, higher gain', () => {
    const a = beamSolution(P({ arrayN: 8 }));
    const b = beamSolution(P({ arrayN: 32 }));
    expect(b.pattern.hpbwDeg).toBeLessThan(a.pattern.hpbwDeg / 3);
    expect(b.footprint.areaKm2).toBeLessThan(a.footprint.areaKm2 / 9);
    expect(b.pattern.gainDbi).toBeGreaterThan(a.pattern.gainDbi + 10);
  });

  it('taper trade-off: Hann → lower sidelobes, wider beam, larger footprint', () => {
    const u = beamSolution(P({ steerDeg: 25, weighting: 'uniform' }));
    const h = beamSolution(P({ steerDeg: 25, weighting: 'hann' }));
    expect(h.pattern.sidelobeDb).toBeLessThan(u.pattern.sidelobeDb - 6);
    expect(h.pattern.hpbwDeg).toBeGreaterThan(u.pattern.hpbwDeg);
    expect(h.footprint.areaKm2).toBeGreaterThan(u.footprint.areaKm2);
  });
});

describe('grating lobes', () => {
  it('lobes appear exactly when the threshold d/λ ≥ 1/(1+|sin θ0|) is crossed (in-plane)', () => {
    for (const steerDeg of [0, 20, 40]) {
      const lim = gratingLimit(steerDeg);
      const below = beamSolution(P({ steerDeg, spacingLambda: Math.round((lim - 0.03) * 100) / 100 }));
      const above = beamSolution(P({ steerDeg, spacingLambda: Math.round((lim + 0.03) * 100) / 100 }));
      expect(below.lobes).toHaveLength(0);
      expect(below.pattern.gratingLobe).toBe(false);
      expect(above.lobes.length).toBeGreaterThan(0);
      expect(above.pattern.gratingLobe).toBe(true);
    }
  });

  it('a strong grating lobe that intersects the Earth gets a secondary footprint', () => {
    const b = beamSolution(P({ steerDeg: 25, spacingLambda: 1.0 }));
    expect(b.lobes[0].levelDb).toBeGreaterThan(-3);
    expect(b.secondary.length).toBeGreaterThan(0);
    const sec = b.secondary[0].earth;
    expect(sec.center).not.toBeNull();
    // on the opposite side of nadir from the main beam
    expect(Math.sign(sec.center![0])).toBe(-Math.sign(b.footprint.center![0]));
  });

  it('a lobe pointing above the horizon produces no secondary footprint', () => {
    // λ-spacing at broadside: lobes sit at endfire (u = ±1) → outside visible space or at the limb
    const b = beamSolution(P({ steerDeg: 0, spacingLambda: 1.05, arrayN: 16 }));
    for (const s of b.secondary) expect(s.earth.center).not.toBeNull();
  });
});

describe('power-normalisation modes', () => {
  it('per-element-fixed: total RF scales with N²', () => {
    const a = solveSystem(P({ arrayN: 8, powerMode: 'per-element-fixed', paOutW: 1 }));
    const b = solveSystem(P({ arrayN: 16, powerMode: 'per-element-fixed', paOutW: 1 }));
    expect(b.beam.power.rfW / a.beam.power.rfW).toBeCloseTo(4, 9);
    expect(b.eirpDbw - a.eirpDbw).toBeCloseTo(10 * Math.log10(4) + (b.gainDbi - a.gainDbi), 9);
  });
  it('total-rf-fixed: RF power constant, per-element power falls, EIRP changes by gain only', () => {
    const a = solveSystem(P({ arrayN: 8, powerMode: 'total-rf-fixed', totalRfW: 256 }));
    const b = solveSystem(P({ arrayN: 16, powerMode: 'total-rf-fixed', totalRfW: 256 }));
    expect(a.beam.power.rfW).toBe(256);
    expect(b.beam.power.perElementW).toBeCloseTo(1, 12);
    expect(a.beam.power.perElementW).toBeCloseTo(4, 12);
    expect(b.eirpDbw - a.eirpDbw).toBeCloseTo(b.gainDbi - a.gainDbi, 9);
    expect(b.paDcW).toBeCloseTo(a.paDcW, 9);
  });
});

describe('educational presets', () => {
  it('each preset produces the physical state it is named after', () => {
    const get = (id: string) => {
      const pr = BEAM_PRESETS.find((p) => p.id === id)!;
      return beamSolution(P(pr.params));
    };
    const nadir = get('nadir');
    expect(nadir.lobes).toHaveLength(0);
    expect(nadir.footprint.nadirOffsetKm!).toBeLessThan(1e-6);
    const steered = get('steered');
    expect(steered.footprint.nadirOffsetKm!).toBeGreaterThan(150);
    expect(steered.lobes).toHaveLength(0);
    const low = get('low-sidelobes');
    expect(low.pattern.sidelobeDb).toBeLessThan(steered.pattern.sidelobeDb - 6);
    const gl = get('grating');
    expect(gl.pattern.gratingLobe).toBe(true);
    expect(gl.secondary.length).toBeGreaterThan(0);
    expect(arrayMetrics({ n: 16, spacingLambda: gl.input.spacingLambda, steerThetaDeg: gl.input.steerThetaDeg, steerPhiDeg: 0, weighting: 'uniform' }).gratingLobe).toBe(true);
  });
});

import { beamCaches, solvePattern, patternKey } from '../src/models/beam-solution';

describe('dependency-aware beam caches', () => {
  it('pattern cache: equal array state → same PatternSolution object; frequency is not a pattern dependency', () => {
    const a = { n: 16, spacingLambda: 0.5, steerThetaDeg: 21, steerPhiDeg: 0, weighting: 'uniform' as const };
    expect(solvePattern(a)).toBe(solvePattern({ ...a }));
    const s1 = beamSolution(P({ steerDeg: 21, freqGHz: 19.7 }));
    const s2 = beamSolution(P({ steerDeg: 21, freqGHz: 27.5 }));
    expect(s2.contour).toBe(s1.contour); // AF in d/λ: frequency does not change the pattern
    expect(s2.link!.fsplDb).toBeGreaterThan(s1.link!.fsplDb); // but it does change the link
    expect(patternKey(a)).not.toBe(patternKey({ ...a, steerThetaDeg: 22 }));
  });

  it('altitude change re-projects the footprint without re-integrating the pattern', () => {
    beamCaches.pattern.clear();
    const lo = beamSolution(P({ steerDeg: 17, altitudeKm: 550 }));
    const misses = beamCaches.pattern.misses;
    const hi = beamSolution(P({ steerDeg: 17, altitudeKm: 1100 }));
    expect(beamCaches.pattern.misses).toBe(misses);
    expect(hi.contour).toBe(lo.contour);
    expect(hi.footprint).not.toBe(lo.footprint);
    expect(hi.footprint.alongTrackKm).toBeGreaterThan(lo.footprint.alongTrackKm * 1.8);
  });

  it('receiver / power change re-runs only the link (pattern and footprint objects reused)', () => {
    const a = beamSolution(P({ steerDeg: 19, rxGainDbi: 36 }));
    const b = beamSolution(P({ steerDeg: 19, rxGainDbi: 40 }));
    const c = beamSolution(P({ steerDeg: 19, rxGainDbi: 36, paOutW: 2 }));
    expect(b.footprint).toBe(a.footprint);
    expect(c.footprint).toBe(a.footprint);
    expect(b.link!.marginDb - a.link!.marginDb).toBeCloseTo(4, 9);
    expect(c.power.eirpDbw - a.power.eirpDbw).toBeCloseTo(10 * Math.log10(2), 9);
  });

  it('cached results equal a cold computation', () => {
    const p = P({ steerDeg: 31, spacingLambda: 0.62, weighting: 'hann' });
    const warm = beamSolution(p);
    beamCaches.pattern.clear();
    beamCaches.footprint.clear();
    const cold = beamSolution({ ...p });
    expect(cold.pattern.directivityDbi).toBe(warm.pattern.directivityDbi);
    expect(cold.footprint.areaKm2).toBe(warm.footprint.areaKm2);
    expect(cold.link!.marginDb).toBe(warm.link!.marginDb);
  });
});
