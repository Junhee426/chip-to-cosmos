import { describe, expect, it } from 'vitest';
import { fsplDb, linkBudget, slantRangeM } from '../src/models/link-budget';

describe('link budget', () => {
  it('slant range: zenith = altitude, lower elevation = longer', () => {
    expect(slantRangeM(550e3, 90)).toBeCloseTo(550e3, 0);
    expect(slantRangeM(550e3, 25)).toBeGreaterThan(1.1e6);
    expect(slantRangeM(550e3, 25)).toBeLessThan(1.2e6);
  });
  it('FSPL', () => {
    expect(fsplDb(1e6, 20e9)).toBeCloseTo(178.47, 1);
    expect(fsplDb(2e6, 20e9) - fsplDb(1e6, 20e9)).toBeCloseTo(6.02, 2);
  });
  it('Pr = Pt + Gt + Gr − FSPL − L and consistent units', () => {
    const r = linkBudget({ altitudeKm: 550, elevationDeg: 40, freqGHz: 19.7, txPowerW: 100, txGainDbi: 30, rxGainDbi: 36, rxNoiseTempK: 250, otherLossesDb: 3, dataRateBps: 1e8, requiredEbN0Db: 4 });
    expect(r.txPowerDbw).toBeCloseTo(20, 9);
    expect(r.eirpDbw).toBeCloseTo(50, 9);
    expect(r.rxPowerDbw).toBeCloseTo(20 + 30 + 36 - r.fsplDb - 3, 9);
    expect(r.rxPowerDbm).toBeCloseTo(r.rxPowerDbw + 30, 9);
    expect(r.cn0DbHz).toBeCloseTo(r.rxPowerDbw - 10 * Math.log10(250) + 228.6, 1);
    expect(r.ebN0Db).toBeCloseTo(r.cn0DbHz - 80, 9);
    expect(r.marginDb).toBeCloseTo(r.ebN0Db - 4, 9);
  });
});
