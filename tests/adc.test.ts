import { describe, expect, it } from 'vitest';
import { adcPowerW, adcTrace, aliasFrequency, idealSnrDb, nyquistOk, quantize } from '../src/models/adc';

describe('ADC', () => {
  it('ideal quantisation SNR', () => {
    expect(idealSnrDb(8)).toBeCloseTo(49.92, 2);
    expect(idealSnrDb(12)).toBeCloseTo(74.0, 1);
  });
  it('Nyquist criterion', () => {
    expect(nyquistOk(400e6, 1e9)).toBe(true);
    expect(nyquistOk(600e6, 1e9)).toBe(false);
  });
  it('alias folding', () => {
    expect(aliasFrequency(900e6, 1e9)).toBeCloseTo(100e6, 0);
    expect(aliasFrequency(1.3e9, 1e9)).toBeCloseTo(300e6, 0);
    expect(aliasFrequency(200e6, 1e9)).toBeCloseTo(200e6, 0);
  });
  it('quantiser produces 2^N levels', () => {
    const levels = new Set<number>();
    for (let x = -1; x <= 1; x += 0.001) levels.add(Number(quantize(x, 4).toFixed(9)));
    expect(levels.size).toBe(16);
  });
  it('simulated SNR tracks 6.02N + 1.76 dB', () => {
    for (const bits of [8, 10, 12]) {
      const tr = adcTrace({ signalHz: 97.3e6, fsHz: 1e9, bits, amplitude: 0.999 });
      expect(Math.abs(tr.measuredSnrDb - idealSnrDb(bits))).toBeLessThan(1.5);
    }
  });
  it('aliased reconstruction matches the samples', () => {
    const tr = adcTrace({ signalHz: 900e6, fsHz: 1e9, bits: 12 });
    const k = 7;
    const [t, v] = tr.samples[k];
    const fA = tr.aliasHz;
    const recon = -0.95 * Math.sin(2 * Math.PI * fA * t);
    expect(recon).toBeCloseTo(v, 6);
  });
  it('ADC power doubles per extra bit (Walden FOM)', () => {
    expect(adcPowerW(9, 1e9) / adcPowerW(8, 1e9)).toBeCloseTo(2, 9);
  });
});
