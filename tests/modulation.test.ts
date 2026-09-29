import { describe, expect, it } from 'vitest';
import { berTheory, constellation, esN0FromEbN0, simulateConstellation } from '../src/models/modulation';

describe('digital modulation', () => {
  it('constellations are normalised to Es = 1', () => {
    for (const m of ['BPSK', 'QPSK', '16QAM', '64QAM'] as const) {
      const pts = constellation(m);
      const es = pts.reduce((s, p) => s + p.i * p.i + p.q * p.q, 0) / pts.length;
      expect(es).toBeCloseTo(1, 9);
    }
    expect(constellation('64QAM')).toHaveLength(64);
  });
  it('BPSK reaches 1e-5 at ≈ 9.6 dB', () => {
    expect(berTheory('BPSK', 9.59)).toBeGreaterThan(0.8e-5);
    expect(berTheory('BPSK', 9.59)).toBeLessThan(1.2e-5);
  });
  it('QPSK has the same Pb as BPSK per Eb/N0; QAM needs more Eb/N0', () => {
    expect(berTheory('QPSK', 7)).toBeCloseTo(berTheory('BPSK', 7), 12);
    expect(berTheory('16QAM', 10)).toBeGreaterThan(berTheory('QPSK', 10));
    expect(berTheory('64QAM', 10)).toBeGreaterThan(berTheory('16QAM', 10));
  });
  it('BER falls monotonically with Eb/N0', () => {
    let prev = 1;
    for (let e = 0; e <= 20; e++) {
      const b = berTheory('16QAM', e);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
  });
  it('Es/N0 = Eb/N0 + 10log10(k)', () => {
    expect(esN0FromEbN0('16QAM', 10)).toBeCloseTo(10 + 10 * Math.log10(4), 9);
  });
  it('simulation: error-free at high SNR, EVM ≈ √(N0)', () => {
    const hi = simulateConstellation('QPSK', 25);
    expect(hi.ser).toBe(0);
    const s = simulateConstellation('16QAM', 20, 4000);
    expect(s.evmPct).toBeGreaterThan(8.5);
    expect(s.evmPct).toBeLessThan(11.5);
  });
  it('simulation SER is consistent with theory order of magnitude', () => {
    const s = simulateConstellation('QPSK', esN0FromEbN0('QPSK', 4), 20000, 3);
    const pb = berTheory('QPSK', 4); // ≈ 1.25e-2
    const ser = 2 * pb - pb * pb;
    expect(s.ser).toBeGreaterThan(ser * 0.7);
    expect(s.ser).toBeLessThan(ser * 1.3);
  });
});
