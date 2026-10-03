import {
  arrayMetrics,
  contourStep,
  fieldAt,
  flatFootprint,
  gratingLimit,
  gratingLobes,
  refinePeak,
  sphericalFootprint,
  steerAxis,
  traceContour,
  weights,
  type ArrayParams,
  type Footprint,
  type Lobe,
  type SphericalFootprint,
  type Weighting,
} from './array-factor';
import type { Vec3 } from './frames';
import { linkBudget, type LinkResult } from './link-budget';
import { Lru } from './lru';
import { wattsToDbw } from './units';

/**
 * How RF power scales with the element count N_e = N².
 * - per-element-fixed: every element keeps P_el = paOutW → total RF = P_el · N_e
 *   (a bigger array gains directivity AND total power: EIRP grows ~ N_e²).
 * - total-rf-fixed: the total RF power is held → P_el = P_total / N_e
 *   (a bigger array only adds directivity: EIRP grows ~ N_e).
 */
export type ArrayPowerMode = 'per-element-fixed' | 'total-rf-fixed';

export interface BeamInput {
  array: ArrayParams;
  freqGHz: number;
  altitudeKm: number;
  powerMode: ArrayPowerMode;
  /** RF output per element (W), used in per-element-fixed mode */
  paOutW: number;
  /** total RF output (W), used in total-rf-fixed mode */
  totalRfW: number;
  radiationEff: number;
  rxGainDbi: number;
  rxNoiseTempK: number;
  otherLossesDb: number;
  dataRateBps: number;
  requiredEbN0Db: number;
}

export interface SecondaryFootprint {
  lobe: Lobe;
  /** −3 dB contour of the lobe relative to its own peak (ARRAY LOCAL directions) */
  directions: Vec3[];
  earth: SphericalFootprint;
}

/**
 * One calculation state → every representation. BEAM LAB, SATELLITE, COSMOS and
 * the HUD all read this object; none of them recompute pattern, footprint or link.
 */
export interface BeamSolution {
  input: {
    arrayN: number;
    spacingLambda: number;
    steerThetaDeg: number;
    steerPhiDeg: number;
    weighting: Weighting;
    freqGHz: number;
    altitudeKm: number;
    paOutW: number;
  };
  power: { mode: ArrayPowerMode; elements: number; perElementW: number; rfW: number; eirpDbw: number };
  pattern: {
    /** beam maximum, ARRAY LOCAL unit vector (includes element-pattern squint) */
    axis: Vec3;
    /** commanded steering direction θ0, φ0 */
    steerAxis: Vec3;
    peakField: number;
    directivityDbi: number;
    gainDbi: number;
    hpbwDeg: number;
    sidelobeDb: number;
    gratingLobe: boolean;
    /** d/λ above which a grating lobe enters visible space at this θ0 */
    gratingLimit: number;
    taperEfficiency: number;
    /** principal-plane cut through the steered beam */
    cut: { thetaDeg: number; db: number }[];
    /** element phase step (rad) along x and z: βx = −kd sinθ0 cosφ0, βy = −kd sinθ0 sinφ0 */
    phaseStepX: number;
    phaseStepY: number;
  };
  /** −3 dB contour directions (ARRAY LOCAL) shared by every footprint view */
  contour: Vec3[];
  /** grating lobes in visible space, strongest first */
  lobes: Lobe[];
  /** BEAM LAB: flat-ground projection (pedagogical) */
  flat: Footprint;
  /** COSMOS / SATELLITE: spherical-Earth intersection of the same contour */
  footprint: SphericalFootprint;
  /** grating lobes ≥ −10 dB whose maximum intersects the Earth */
  secondary: SecondaryFootprint[];
  /** link to a user at the footprint centre; null when the beam axis misses the Earth */
  link: (LinkResult & { elevationDeg: number }) | null;
}

/** Lobes weaker than this are listed but not projected. */
export const SECONDARY_MIN_DB = -10;

export function rfPower(mode: ArrayPowerMode, elements: number, paOutW: number, totalRfW: number): { rfW: number; perElementW: number } {
  return mode === 'per-element-fixed' ? { rfW: paOutW * elements, perElementW: paOutW } : { rfW: totalRfW, perElementW: totalRfW / elements };
}

/** Everything that depends only on the array state (N, d/λ, θ0, φ0, taper, element pattern). */
export interface PatternSolution {
  key: string;
  axis: Vec3;
  steerAxis: Vec3;
  peakField: number;
  directivityDbi: number;
  hpbwDeg: number;
  sidelobeDb: number;
  gratingLobe: boolean;
  gratingLimit: number;
  taperEfficiency: number;
  cut: { thetaDeg: number; db: number }[];
  phaseStepX: number;
  phaseStepY: number;
  /** −3 dB contour directions (ARRAY LOCAL) */
  contour: Vec3[];
  lobes: Lobe[];
  /** −3 dB contours of the grating lobes ≥ SECONDARY_MIN_DB (ARRAY LOCAL) */
  lobeContours: { lobe: Lobe; directions: Vec3[] }[];
}

/** Pattern projected for one orbit altitude. */
export interface FootprintSolution {
  flat: Footprint;
  footprint: SphericalFootprint;
  secondary: SecondaryFootprint[];
}

/**
 * Dependency-aware caches. The array factor does not depend on frequency (spacing is
 * in wavelengths) nor on altitude, power or receiver; the footprints do not depend on
 * power or receiver. So an altitude change re-projects without re-integrating the
 * pattern, and a receiver-gain or power change only re-runs the (cheap) link budget.
 */
const patternCache = new Lru<string, PatternSolution>(32);
const footprintCache = new Lru<string, FootprintSolution>(32);

export const beamCaches = { pattern: patternCache, footprint: footprintCache };

export function patternKey(a: ArrayParams): string {
  return [a.n, a.spacingLambda, a.steerThetaDeg, a.steerPhiDeg, a.weighting, a.elementQ ?? 1.3].join('|');
}

export function solvePattern(a: ArrayParams): PatternSolution {
  const key = patternKey(a);
  return patternCache.get(key, () => {
    const w = weights(a.n, a.weighting);
    const f = (d: Vec3) => fieldAt(a, w, d);
    const m = arrayMetrics(a);
    const hpRad = (m.hpbwDeg * Math.PI) / 180;
    const nominal = steerAxis(a);
    const axis = refinePeak(f, nominal, hpRad / 2);
    const peakField = f(axis);
    const step = contourStep(m.hpbwDeg);
    const contour = traceContour(f, axis, peakField / Math.SQRT2, 72, step);
    const lobes = gratingLobes(a, w, peakField, hpRad / 2);
    const lobeContours = lobes.filter((l) => l.levelDb >= SECONDARY_MIN_DB).map((lobe) => ({ lobe, directions: traceContour(f, lobe.axis, f(lobe.axis) / Math.SQRT2, 48, step) }));
    const t0 = (a.steerThetaDeg * Math.PI) / 180;
    const p0 = (a.steerPhiDeg * Math.PI) / 180;
    const kd = 2 * Math.PI * a.spacingLambda;
    return {
      key,
      axis,
      steerAxis: nominal,
      peakField,
      directivityDbi: m.directivityDbi,
      hpbwDeg: m.hpbwDeg,
      sidelobeDb: m.sidelobeDb,
      gratingLobe: m.gratingLobe,
      gratingLimit: gratingLimit(a.steerThetaDeg),
      taperEfficiency: m.taperEfficiency,
      cut: m.cut,
      phaseStepX: -kd * Math.sin(t0) * Math.cos(p0),
      phaseStepY: -kd * Math.sin(t0) * Math.sin(p0),
      contour,
      lobes,
      lobeContours,
    };
  });
}

export function solveFootprint(p: PatternSolution, steerPhiDeg: number, altitudeKm: number): FootprintSolution {
  return footprintCache.get(`${p.key}|${altitudeKm}`, () => {
    const secondary: SecondaryFootprint[] = [];
    for (const { lobe, directions } of p.lobeContours) {
      const earth = sphericalFootprint(directions, lobe.axis, altitudeKm);
      if (earth.center) secondary.push({ lobe, directions, earth });
    }
    return { flat: flatFootprint(p.contour, p.axis, steerPhiDeg, altitudeKm), footprint: sphericalFootprint(p.contour, p.axis, altitudeKm), secondary };
  });
}

/** Orchestration: pattern (cached) → footprint (cached) → power and link (always, cheap). */
export function solveBeam(i: BeamInput): BeamSolution {
  const a = i.array;
  const P = solvePattern(a);
  const { flat, footprint, secondary } = solveFootprint(P, a.steerPhiDeg, i.altitudeKm);
  const elements = a.n * a.n;
  const { rfW, perElementW } = rfPower(i.powerMode, elements, i.paOutW, i.totalRfW);
  const gainDbi = P.directivityDbi + 10 * Math.log10(i.radiationEff);
  const eirpDbw = wattsToDbw(rfW) + gainDbi;
  const el = footprint.centerElevationDeg;
  const link =
    el === null
      ? null
      : {
          ...linkBudget({
            altitudeKm: i.altitudeKm,
            elevationDeg: el,
            freqGHz: i.freqGHz,
            txPowerW: rfW,
            txGainDbi: gainDbi,
            rxGainDbi: i.rxGainDbi,
            rxNoiseTempK: i.rxNoiseTempK,
            otherLossesDb: i.otherLossesDb,
            dataRateBps: i.dataRateBps,
            requiredEbN0Db: i.requiredEbN0Db,
          }),
          elevationDeg: el,
        };
  return {
    input: { arrayN: a.n, spacingLambda: a.spacingLambda, steerThetaDeg: a.steerThetaDeg, steerPhiDeg: a.steerPhiDeg, weighting: a.weighting, freqGHz: i.freqGHz, altitudeKm: i.altitudeKm, paOutW: perElementW },
    power: { mode: i.powerMode, elements, perElementW, rfW, eirpDbw },
    pattern: {
      axis: P.axis,
      steerAxis: P.steerAxis,
      peakField: P.peakField,
      directivityDbi: P.directivityDbi,
      gainDbi,
      hpbwDeg: P.hpbwDeg,
      sidelobeDb: P.sidelobeDb,
      gratingLobe: P.gratingLobe,
      gratingLimit: P.gratingLimit,
      taperEfficiency: P.taperEfficiency,
      cut: P.cut,
      phaseStepX: P.phaseStepX,
      phaseStepY: P.phaseStepY,
    },
    contour: P.contour,
    lobes: P.lobes,
    flat,
    footprint,
    secondary,
    link,
  };
}
