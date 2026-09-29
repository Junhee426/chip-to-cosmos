import type { ModelMeta } from './meta';
import { EPS0_F_PER_CM, Q_E } from './units';

/**
 * Simplified educational long-channel NMOS (square-law) model.
 * NOT a TCAD result. Subthreshold conduction, velocity saturation,
 * mobility degradation and short-channel effects are deliberately omitted.
 */
export interface MosfetParams {
  vgs: number; // V
  vds: number; // V
  wOverL: number; // dimensionless
  tempK: number; // K
  toxNm?: number; // gate oxide thickness
  mu300?: number; // cm²/(V·s) effective electron mobility at 300 K
  vth300?: number; // V
  lambda?: number; // 1/V channel-length modulation
}

export type MosfetRegion = 'cutoff' | 'triode' | 'saturation';

export interface MosfetResult {
  id: number; // A
  region: MosfetRegion;
  vth: number; // V
  vov: number; // V (overdrive, ≥ 0)
  mu: number; // cm²/(V·s)
  cox: number; // F/cm²
  kPrime: number; // µn·Cox  [A/V²]
  /** inversion charge at source end, electrons per cm² */
  nsSource: number;
  /** inversion charge at drain end, electrons per cm² (0 when pinched off) */
  nsDrain: number;
  /** vertical oxide field magnitude, V/cm (simplified Vgs/tox) */
  eOxVPerCm: number;
  gm: number; // A/V
  vdsat: number; // V
}

export const MOSFET_DEFAULTS = {
  toxNm: 5,
  mu300: 400,
  vth300: 0.7,
  lambda: 0.04,
  vthTempCoeff: -2e-3, // V/K
  muTempExp: -1.5,
} as const;

export function oxideCapacitance(toxNm: number): number {
  return (3.9 * EPS0_F_PER_CM) / (toxNm * 1e-7);
}

export function mosfet(p: MosfetParams): MosfetResult {
  const toxNm = p.toxNm ?? MOSFET_DEFAULTS.toxNm;
  const mu = (p.mu300 ?? MOSFET_DEFAULTS.mu300) * Math.pow(p.tempK / 300, MOSFET_DEFAULTS.muTempExp);
  const vth = (p.vth300 ?? MOSFET_DEFAULTS.vth300) + MOSFET_DEFAULTS.vthTempCoeff * (p.tempK - 300);
  const lambda = p.lambda ?? MOSFET_DEFAULTS.lambda;
  const cox = oxideCapacitance(toxNm);
  const kPrime = mu * cox; // (cm²/Vs)(F/cm²) = A/V²
  const beta = kPrime * p.wOverL;
  const vov = Math.max(p.vgs - vth, 0);
  const vds = Math.max(p.vds, 0);
  let id = 0;
  let region: MosfetRegion = 'cutoff';
  let gm = 0;
  if (vov > 0) {
    if (vds < vov) {
      region = 'triode';
      id = beta * (vov * vds - 0.5 * vds * vds);
      gm = beta * vds;
    } else {
      region = 'saturation';
      id = 0.5 * beta * vov * vov * (1 + lambda * (vds - vov));
      gm = beta * vov * (1 + lambda * (vds - vov));
    }
  }
  const nsSource = (cox * vov) / Q_E;
  const nsDrain = (cox * Math.max(vov - vds, 0)) / Q_E;
  const eOxVPerCm = Math.abs(p.vgs) / (toxNm * 1e-7);
  return { id, region, vth, vov, mu, cox, kPrime, nsSource, nsDrain, eOxVPerCm, gm, vdsat: vov };
}

/** Sweep helper returning [x, Id] pairs. */
export function sweepVgs(base: MosfetParams, vMax = 3, n = 121): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const v = (vMax * i) / (n - 1);
    out.push([v, mosfet({ ...base, vgs: v }).id]);
  }
  return out;
}

export function sweepVds(base: MosfetParams, vMax = 3, n = 121): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const v = (vMax * i) / (n - 1);
    out.push([v, mosfet({ ...base, vds: v }).id]);
  }
  return out;
}

export const MOSFET_META: ModelMeta = {
  id: 'mosfet',
  title: 'Long-channel NMOS — Simplified Educational Model',
  equations: [
    'Cox = εox / tox',
    'Triode (Vds < Vgs−Vth): Id = µnCox(W/L)[(Vgs−Vth)Vds − Vds²/2]',
    'Saturation: Id ≈ ½ µnCox(W/L)(Vgs−Vth)² (1 + λ(Vds − Vds,sat))',
    'Qinv(x) = Cox (Vgs − Vth − V(x))',
    'µn(T) = µn,300 (T/300)^−1.5,  Vth(T) = Vth,300 − 2 mV/K·(T−300)',
  ],
  units: ['Id: A', 'V: V', 'Cox: F/cm²', 'µn: cm²/(V·s)', 'tox: nm'],
  assumptions: [
    'Gradual-channel approximation, long channel (L ≫ depletion widths)',
    'Constant effective mobility (µn,300 = 400 cm²/V·s), tox = 5 nm',
    'Oxide field shown as Vgs/tox (flat-band & surface potential neglected)',
  ],
  validity: 'Qualitative trends for L ≳ 1 µm devices at moderate fields',
  limitations: [
    'No subthreshold current (Id = 0 below Vth) — real devices conduct exponentially',
    'No velocity saturation, DIBL, mobility degradation or quantum confinement',
    'Not a TCAD simulation; geometry in the 3D view is not to scale',
  ],
  reference: 'Sedra & Smith, Microelectronic Circuits; Taur & Ning, Fundamentals of Modern VLSI Devices',
  kind: 'calculated',
};
