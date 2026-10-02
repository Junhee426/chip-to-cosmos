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

export function solveBeam(i: BeamInput): BeamSolution {
  const a = i.array;
  const w = weights(a.n, a.weighting);
  const f = (d: Vec3) => fieldAt(a, w, d);
  const m = arrayMetrics(a);
  const hpRad = (m.hpbwDeg * Math.PI) / 180;
  const nominal = steerAxis(a);
  const axis = refinePeak(f, nominal, hpRad / 2);
  const peakField = f(axis);
  const step = contourStep(m.hpbwDeg);
  const contour = traceContour(f, axis, peakField / Math.SQRT2, 72, step);
  const flat = flatFootprint(contour, axis, a.steerPhiDeg, i.altitudeKm);
  const footprint = sphericalFootprint(contour, axis, i.altitudeKm);
  const lobes = gratingLobes(a, w, peakField, hpRad / 2);
  const secondary: SecondaryFootprint[] = [];
  for (const lobe of lobes) {
    if (lobe.levelDb < SECONDARY_MIN_DB) continue;
    const lp = f(lobe.axis);
    const dirs = traceContour(f, lobe.axis, lp / Math.SQRT2, 48, step);
    const earth = sphericalFootprint(dirs, lobe.axis, i.altitudeKm);
    if (earth.center) secondary.push({ lobe, directions: dirs, earth });
  }

  const elements = a.n * a.n;
  const { rfW, perElementW } = rfPower(i.powerMode, elements, i.paOutW, i.totalRfW);
  const gainDbi = m.directivityDbi + 10 * Math.log10(i.radiationEff);
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
  const t0 = (a.steerThetaDeg * Math.PI) / 180;
  const p0 = (a.steerPhiDeg * Math.PI) / 180;
  const kd = 2 * Math.PI * a.spacingLambda;
  return {
    input: { arrayN: a.n, spacingLambda: a.spacingLambda, steerThetaDeg: a.steerThetaDeg, steerPhiDeg: a.steerPhiDeg, weighting: a.weighting, freqGHz: i.freqGHz, altitudeKm: i.altitudeKm, paOutW: perElementW },
    power: { mode: i.powerMode, elements, perElementW, rfW, eirpDbw },
    pattern: {
      axis,
      steerAxis: nominal,
      peakField,
      directivityDbi: m.directivityDbi,
      gainDbi,
      hpbwDeg: m.hpbwDeg,
      sidelobeDb: m.sidelobeDb,
      gratingLobe: m.gratingLobe,
      gratingLimit: gratingLimit(a.steerThetaDeg),
      taperEfficiency: m.taperEfficiency,
      cut: m.cut,
      phaseStepX: -kd * Math.sin(t0) * Math.cos(p0),
      phaseStepY: -kd * Math.sin(t0) * Math.sin(p0),
    },
    contour,
    lobes,
    flat,
    footprint,
    secondary,
    link,
  };
}
