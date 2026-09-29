import { describe, expect, it } from 'vitest';
import { logTicks, makeScale, niceTicks } from '../src/charts/scale';

describe('chart scales', () => {
  it('nice ticks', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-90, 90, 6)).toEqual([-80, -60, -40, -20, 0, 20, 40, 60, 80]);
  });
  it('log ticks', () => {
    expect(logTicks(1e-8, 1)).toContain(1e-4);
  });
  it('linear & log scales invert', () => {
    const s = makeScale([0, 10], [0, 100]);
    expect(s(2.5)).toBe(25);
    expect(s.invert(75)).toBe(7.5);
    const l = makeScale([1e-6, 1], [100, 0], true);
    expect(l(1e-3)).toBeCloseTo(50, 9);
    expect(l.invert(50)).toBeCloseTo(1e-3, 12);
  });
});
