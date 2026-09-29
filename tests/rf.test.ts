import { describe, expect, it } from 'vitest';
import { DEFAULT_RX_CHAIN, friisCascade, noiseFloorDbm } from '../src/models/rf';
import { ratioToDb } from '../src/models/units';

describe('Friis cascade', () => {
  it('single stage returns its own NF', () => {
    expect(friisCascade([{ id: 'a', name: 'a', gainDb: 20, nfDb: 2 }]).totalNfDb).toBeCloseTo(2, 10);
  });
  it('two-stage textbook example: F = F1 + (F2−1)/G1', () => {
    const r = friisCascade([
      { id: 'a', name: 'a', gainDb: 10, nfDb: ratioToDb(2) },
      { id: 'b', name: 'b', gainDb: 0, nfDb: 10 },
    ]);
    expect(r.totalNf).toBeCloseTo(2 + 9 / 10, 9);
  });
  it('a good LNA dominates the default chain', () => {
    const r = friisCascade(DEFAULT_RX_CHAIN);
    expect(r.totalNfDb).toBeGreaterThan(1.7);
    expect(r.totalNfDb).toBeLessThan(3);
    expect(r.noiseTempK).toBeCloseTo(290 * (r.totalNf - 1), 9);
    expect(r.cumulativeNfDb[r.cumulativeNfDb.length - 1]).toBeCloseTo(r.totalNfDb, 9);
  });
  it('loss before the LNA adds dB-for-dB', () => {
    const a = friisCascade(DEFAULT_RX_CHAIN.slice(1)).totalNfDb;
    const b = friisCascade(DEFAULT_RX_CHAIN).totalNfDb;
    expect(b - a).toBeCloseTo(0.5, 1);
  });
  it('thermal noise floor', () => {
    expect(noiseFloorDbm(1, 0)).toBeCloseTo(-174, 0);
    expect(noiseFloorDbm(1e6, 3)).toBeCloseTo(-111, 0);
  });
});
