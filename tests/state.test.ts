import { describe, expect, it } from 'vitest';
import src from '../src/ui/analysis.ts?raw';
import { DEFAULT_PARAMS, PARAM_LIMITS, createStore, sanitizeParams } from '../src/app/state';

describe('parameter domains', () => {
  it('defaults are inside their limits', () => {
    for (const [k, lim] of Object.entries(PARAM_LIMITS)) {
      const v = DEFAULT_PARAMS[k as keyof typeof DEFAULT_PARAMS] as number;
      expect(v, k).toBeGreaterThanOrEqual(lim.min);
      expect(v, k).toBeLessThanOrEqual(lim.max);
    }
  });
  it('clamps, rounds integers and rejects non-finite / invalid values', () => {
    expect(sanitizeParams({ arrayN: 0 })).toEqual({ arrayN: 4 });
    expect(sanitizeParams({ arrayN: 17.6 })).toEqual({ arrayN: 18 });
    expect(sanitizeParams({ elevationDeg: 120 })).toEqual({ elevationDeg: 90 });
    expect(sanitizeParams({ freqGHz: NaN })).toEqual({});
    expect(sanitizeParams({ altitudeKm: Infinity })).toEqual({});
    expect(sanitizeParams({ modulation: 'FSK' as never })).toEqual({});
    expect(sanitizeParams({ weighting: 'hann' })).toEqual({ weighting: 'hann' });
  });
  it('the store never holds an out-of-domain value', () => {
    const s = createStore();
    s.setParams({ spacingLambda: -1, adcBits: 99, tempK: 0 });
    expect(s.get().params.spacingLambda).toBe(0.25);
    expect(s.get().params.adcBits).toBe(12);
    expect(s.get().params.tempK).toBe(200);
  });
  it('every UI slider range lies inside PARAM_LIMITS', () => {
    const re = /slider\(\{[^}]*?min: (-?[\d.]+), max: (-?[\d.]+)[^}]*?value: (?:p0|p|q|store\.get\(\)\.params)\.(\w+)/g;
    let n = 0;
    for (const m of src.matchAll(re)) {
      const lim = PARAM_LIMITS[m[3] as keyof typeof PARAM_LIMITS];
      expect(lim, m[3]).toBeDefined();
      expect(Number(m[1]), m[3]).toBeGreaterThanOrEqual(lim.min);
      expect(Number(m[2]), m[3]).toBeLessThanOrEqual(lim.max);
      n++;
    }
    expect(n).toBeGreaterThan(15);
  });
});
