import type { ModelMeta } from './meta';
import { K_BOLTZMANN_EV, thermalVoltage } from './units';

/**
 * Intrinsic silicon carrier model.
 * Parameter set: Sze (2nd ed.) effective densities of states at 300 K and
 * Varshni band-gap temperature dependence (Thurmond parameters).
 */
export const SI = {
  nc300: 2.8e19, // cm^-3
  nv300: 1.04e19, // cm^-3
  eg0: 1.17, // eV at 0 K
  alpha: 4.73e-4, // eV/K
  beta: 636, // K
  epsR: 11.7,
  latticeConstantNm: 0.5431,
} as const;

/** Varshni: Eg(T) = Eg0 − αT²/(T+β)  [eV] */
export function bandGapEv(tempK: number): number {
  return SI.eg0 - (SI.alpha * tempK * tempK) / (tempK + SI.beta);
}

export function effectiveDos(tempK: number): { nc: number; nv: number } {
  const s = Math.pow(tempK / 300, 1.5);
  return { nc: SI.nc300 * s, nv: SI.nv300 * s };
}

/** ni = √(Nc Nv) · exp(−Eg / 2kT)  [cm^-3] */
export function intrinsicCarrierDensity(tempK: number, egEv = bandGapEv(tempK)): number {
  const { nc, nv } = effectiveDos(tempK);
  return Math.sqrt(nc * nv) * Math.exp(-egEv / (2 * K_BOLTZMANN_EV * tempK));
}

export interface CarrierState {
  n: number; // electrons cm^-3
  p: number; // holes cm^-3
  ni: number;
  /** Ef − Ei in eV (positive for n-type) */
  fermiOffsetEv: number;
}

/**
 * Carrier densities for a (fully ionised) doped sample using charge neutrality:
 * n = (Nd−Na)/2 + √(((Nd−Na)/2)² + ni²),  p = ni²/n.
 */
export function carriers(tempK: number, ndCm3: number, naCm3: number): CarrierState {
  const ni = intrinsicCarrierDensity(tempK);
  const half = (ndCm3 - naCm3) / 2;
  let n: number;
  let p: number;
  if (half >= 0) {
    n = half + Math.sqrt(half * half + ni * ni);
    p = (ni * ni) / n;
  } else {
    p = -half + Math.sqrt(half * half + ni * ni);
    n = (ni * ni) / p;
  }
  const fermiOffsetEv = K_BOLTZMANN_EV * tempK * Math.log(n / ni);
  return { n, p, ni, fermiOffsetEv };
}

/** Built-in potential of an abrupt PN junction: Vbi = Vt ln(NaNd/ni²) [V] */
export function builtInPotential(tempK: number, naCm3: number, ndCm3: number): number {
  const ni = intrinsicCarrierDensity(tempK);
  return thermalVoltage(tempK) * Math.log((naCm3 * ndCm3) / (ni * ni));
}

/**
 * Depletion-approximation band profile of an abrupt PN junction under bias Vd.
 * Returns potential ψ(x) (V) across [-L, L] µm; the band edges bend by −qψ.
 */
export function junctionProfile(
  tempK: number,
  naCm3: number,
  ndCm3: number,
  vd: number,
  samples = 121,
): { xUm: number[]; psi: number[]; wUm: number; xpUm: number; xnUm: number; vbi: number } {
  const EPS_SI = 11.7 * 8.8541878128e-14; // F/cm
  const q = 1.602176634e-19;
  const vbi = builtInPotential(tempK, naCm3, ndCm3);
  const vj = Math.max(vbi - vd, 0.02); // clamp: depletion approx fails near flat-band
  const wCm = Math.sqrt(((2 * EPS_SI * vj) / q) * (1 / naCm3 + 1 / ndCm3));
  const xp = (wCm * ndCm3) / (naCm3 + ndCm3);
  const xn = (wCm * naCm3) / (naCm3 + ndCm3);
  const span = Math.max(3 * wCm, 1e-5);
  const xUm: number[] = [];
  const psi: number[] = [];
  for (let i = 0; i < samples; i++) {
    const x = -span + (2 * span * i) / (samples - 1);
    let v: number;
    if (x <= -xp) v = 0;
    else if (x <= 0) v = ((q * naCm3) / (2 * EPS_SI)) * (x + xp) ** 2;
    else if (x < xn) v = vj - ((q * ndCm3) / (2 * EPS_SI)) * (xn - x) ** 2;
    else v = vj;
    xUm.push(x * 1e4);
    psi.push(v);
  }
  return { xUm, psi, wUm: wCm * 1e4, xpUm: xp * 1e4, xnUm: xn * 1e4, vbi };
}

/** Shockley diode: I = Is [exp(Vd / nVt) − 1]  [A] */
export function diodeCurrent(vd: number, isA: number, n: number, tempK: number): number {
  return isA * (Math.exp(vd / (n * thermalVoltage(tempK))) - 1);
}

/** Saturation current scaled with ni² relative to a 300 K reference value. */
export function saturationCurrentAtTemp(is300: number, tempK: number): number {
  const r = intrinsicCarrierDensity(tempK) / intrinsicCarrierDensity(300);
  return is300 * r * r;
}

export const SEMICONDUCTOR_META: ModelMeta = {
  id: 'semiconductor',
  title: 'Intrinsic carriers & PN junction',
  equations: [
    'ni = √(Nc·Nv) · exp(−Eg / 2kT)',
    'Eg(T) = Eg0 − αT² / (T + β)',
    'Vbi = (kT/q) · ln(Na·Nd / ni²)',
    'I = Is · [exp(Vd / nVt) − 1]',
  ],
  units: ['ni, Nc, Nv: cm⁻³', 'Eg: eV', 'T: K', 'Vd, Vbi: V', 'I, Is: A'],
  assumptions: [
    'Non-degenerate statistics (Boltzmann approximation)',
    'Nc, Nv ∝ T^1.5 from Sze 300 K values',
    'Complete dopant ionisation',
    'Abrupt junction, depletion approximation',
  ],
  validity: '≈ 200–500 K, doping ≪ 10¹⁸ cm⁻³',
  limitations: [
    'This Nc/Nv set gives ni(300 K) ≈ 6–7×10⁹ cm⁻³; modern accepted value is ≈ 9.7×10⁹ cm⁻³ (different DOS masses). Order of magnitude and T-trend are correct.',
    'No band-gap narrowing, no incomplete ionisation, no high-injection or series resistance in the diode.',
  ],
  reference: 'S. M. Sze, Physics of Semiconductor Devices; Varshni (1967); Thurmond (1975)',
  kind: 'calculated',
};
