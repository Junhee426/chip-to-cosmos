import { describe, expect, it } from 'vitest';
import { bandGapEv, builtInPotential, carriers, diodeCurrent, intrinsicCarrierDensity, junctionProfile } from '../src/models/semiconductor';

describe('silicon carrier model', () => {
  it('band gap at 300 K ≈ 1.12 eV and decreases with T', () => {
    expect(bandGapEv(300)).toBeCloseTo(1.1245, 3);
    expect(bandGapEv(400)).toBeLessThan(bandGapEv(300));
  });
  it('ni(300 K) has the right order of magnitude (10^10 cm^-3 class)', () => {
    const ni = intrinsicCarrierDensity(300);
    expect(ni).toBeGreaterThan(5e9);
    expect(ni).toBeLessThan(1.2e10);
  });
  it('ni rises steeply with temperature', () => {
    expect(intrinsicCarrierDensity(400) / intrinsicCarrierDensity(300)).toBeGreaterThan(100);
  });
  it('n-type doping: n ≈ Nd and n·p = ni²', () => {
    const c = carriers(300, 1e16, 0);
    expect(c.n / 1e16).toBeCloseTo(1, 6);
    expect((c.n * c.p) / (c.ni * c.ni)).toBeCloseTo(1, 9);
    expect(c.fermiOffsetEv).toBeGreaterThan(0.3);
  });
  it('built-in potential of a 1e17/1e17 junction ≈ 0.85 V', () => {
    const v = builtInPotential(300, 1e17, 1e17);
    expect(v).toBeGreaterThan(0.8);
    expect(v).toBeLessThan(0.9);
  });
  it('depletion width ≈ 0.15 µm at zero bias and shrinks under forward bias', () => {
    const w0 = junctionProfile(300, 1e17, 1e17, 0).wUm;
    expect(w0).toBeCloseTo(0.149, 2);
    expect(junctionProfile(300, 1e17, 1e17, 0.5).wUm).toBeLessThan(w0);
    expect(junctionProfile(300, 1e17, 1e17, -2).wUm).toBeGreaterThan(w0);
  });
  it('potential profile spans exactly Vbi − Vd', () => {
    const p = junctionProfile(300, 1e17, 1e16, 0.2);
    expect(p.psi[p.psi.length - 1] - p.psi[0]).toBeCloseTo(p.vbi - 0.2, 6);
  });
  it('Shockley diode', () => {
    expect(diodeCurrent(0, 1e-14, 1, 300)).toBe(0);
    expect(diodeCurrent(0.6, 1e-14, 1, 300)).toBeCloseTo(1.2e-4, 5);
    expect(diodeCurrent(-1, 1e-14, 1, 300)).toBeCloseTo(-1e-14, 20);
  });
});
