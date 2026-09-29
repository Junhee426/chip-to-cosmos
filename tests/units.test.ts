import { describe, expect, it } from 'vitest';
import { dbToRatio, dbmToWatts, dbwToDbm, erfc, formatSI, qFunc, ratioToDb, wattsToDbm, wattsToDbw } from '../src/models/units';

describe('unit conversions', () => {
  it('W ↔ dBW ↔ dBm', () => {
    expect(wattsToDbw(1)).toBeCloseTo(0, 10);
    expect(wattsToDbw(100)).toBeCloseTo(20, 10);
    expect(wattsToDbm(1)).toBeCloseTo(30, 10);
    expect(dbmToWatts(0)).toBeCloseTo(1e-3, 12);
    expect(dbwToDbm(-120)).toBe(-90);
  });
  it('dB ratios', () => {
    expect(dbToRatio(3)).toBeCloseTo(1.9953, 4);
    expect(ratioToDb(dbToRatio(17.3))).toBeCloseTo(17.3, 10);
  });
  it('erfc and Q-function', () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.157299, 6);
    expect(qFunc(0)).toBeCloseTo(0.5, 6);
    expect(qFunc(1)).toBeCloseTo(0.158655, 5);
    expect(qFunc(4.753)).toBeCloseTo(1e-6, 7);
  });
  it('SI formatting', () => {
    expect(formatSI(0.00123, 'A')).toBe('1.23 mA');
    expect(formatSI(2.5e9, 'Hz')).toBe('2.50 GHz');
  });
});
