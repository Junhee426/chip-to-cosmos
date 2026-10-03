// Stage-by-stage cost of the beam calculation. Skipped in `npm test`; run with `npm run profile:beam`.
// Pure TypeScript on the CPU (no GPU involved); absolute numbers depend on the machine.
import { describe, it } from 'vitest';
import { arrayMetrics, contourStep, elementPattern, fieldAt, gratingLobes, planarAF, refinePeak, sphericalFootprint, steerAxis, traceContour, weights, type ArrayParams } from '../src/models/array-factor';
import { solveBeam } from '../src/models/beam-solution';
import type { Vec3 } from '../src/models/frames';

const CASES: [string, ArrayParams][] = [
  ['8×8 θ25', { n: 8, spacingLambda: 0.5, steerThetaDeg: 25, steerPhiDeg: 0, weighting: 'uniform' }],
  ['16×16 θ25', { n: 16, spacingLambda: 0.5, steerThetaDeg: 25, steerPhiDeg: 0, weighting: 'uniform' }],
  ['32×32 θ25', { n: 32, spacingLambda: 0.5, steerThetaDeg: 25, steerPhiDeg: 0, weighting: 'uniform' }],
  ['16×16 d1.0 grating', { n: 16, spacingLambda: 1.0, steerThetaDeg: 25, steerPhiDeg: 0, weighting: 'uniform' }],
];
const input = (array: ArrayParams) => ({ array, freqGHz: 19.7, altitudeKm: 550, powerMode: 'per-element-fixed' as const, paOutW: 1, totalRfW: 256, radiationEff: 0.7, rxGainDbi: 36, rxNoiseTempK: 250, otherLossesDb: 3, dataRateBps: 375e6, requiredEbN0Db: 4.4 });

/** BEAM LAB radiation surface: |AF·EP| at 73 × 145 directions (same loop as scenes/array.ts) */
function surface(a: ArrayParams, w: number[]): number {
  let s = 0;
  for (let i = 0; i <= 72; i++) {
    const th = (i / 72) * (Math.PI / 2);
    const ep = elementPattern(th, 1.3);
    for (let j = 0; j <= 144; j++) s += planarAF(a, w, th, (j / 144) * Math.PI * 2) * ep;
  }
  return s;
}
const time = (fn: () => void, n = 20): number => {
  fn();
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t) / n;
};
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

describe.skipIf(!env.VITE_PROFILE)('beam profile (ms per call)', () => {
  it('stages', () => {
    const rows: Record<string, Record<string, string>> = {};
    for (const [name, a] of CASES) {
      const w = weights(a.n, a.weighting);
      const f = (d: Vec3) => fieldAt(a, w, d);
      const m = arrayMetrics(a);
      const hp = (m.hpbwDeg * Math.PI) / 180;
      const axis = refinePeak(f, steerAxis(a), hp / 2);
      const contour = traceContour(f, axis, f(axis) / Math.SQRT2, 72, contourStep(m.hpbwDeg));
      rows[name] = Object.fromEntries(
        Object.entries({
          solveBeam: () => solveBeam(input(a)),
          arrayMetrics: () => arrayMetrics(a),
          refinePeak: () => refinePeak(f, steerAxis(a), hp / 2),
          traceContour: () => traceContour(f, axis, f(axis) / Math.SQRT2, 72, contourStep(m.hpbwDeg)),
          sphericalFootprint: () => sphericalFootprint(contour, axis, 550),
          gratingLobes: () => gratingLobes(a, w, f(axis), hp / 2),
          labSurface: () => surface(a, w),
        }).map(([k, fn]) => [k, time(fn as () => void).toFixed(2)]),
      );
    }
    console.table(rows);
  });
});
