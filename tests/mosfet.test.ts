import { describe, expect, it } from 'vitest';
import { mosfet, oxideCapacitance, sweepVds } from '../src/models/mosfet';
import { channelProfile } from '../src/scenes/mosfet';

const base = { vgs: 1.7, vds: 2, wOverL: 10, tempK: 300 };

describe('long-channel MOSFET (educational)', () => {
  it('Cox for 5 nm SiO2', () => {
    expect(oxideCapacitance(5)).toBeCloseTo(6.906e-7, 9);
  });
  it('saturation current matches ½ µCox W/L Vov² (1+λΔV)', () => {
    const r = mosfet(base);
    expect(r.region).toBe('saturation');
    expect(r.vov).toBeCloseTo(1.0, 6);
    expect(r.id).toBeCloseTo(0.5 * 400 * oxideCapacitance(5) * 10 * 1 * 1.04, 9);
  });
  it('cut-off below threshold', () => {
    const r = mosfet({ ...base, vgs: 0.5 });
    expect(r.region).toBe('cutoff');
    expect(r.id).toBe(0);
  });
  it('triode region below Vds,sat and continuous at the boundary', () => {
    expect(mosfet({ ...base, vds: 0.3 }).region).toBe('triode');
    const edge = mosfet({ ...base, vds: 1.0 - 1e-9 }).id;
    const sat = mosfet({ ...base, vds: 1.0 + 1e-9 }).id;
    expect(Math.abs(edge - sat) / sat).toBeLessThan(1e-6);
  });
  it('Id is monotonic in Vds', () => {
    const pts = sweepVds(base);
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeGreaterThanOrEqual(pts[i - 1][1]);
  });
  it('mobility degradation dominates at high overdrive → Id falls with T', () => {
    const hot = mosfet({ ...base, vgs: 2.5, tempK: 400 }).id;
    const cold = mosfet({ ...base, vgs: 2.5, tempK: 300 }).id;
    expect(hot).toBeLessThan(cold);
  });
  it('channel charge pinches off at the drain in saturation', () => {
    expect(channelProfile(1, 2, 0)).toBeCloseTo(1, 9);
    expect(channelProfile(1, 2, 1)).toBeCloseTo(0, 9);
    expect(channelProfile(1, 0.3, 1)).toBeGreaterThan(0.5);
    expect(channelProfile(0, 1, 0.5)).toBe(0);
  });
});
