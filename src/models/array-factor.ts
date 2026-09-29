import type { ModelMeta } from './meta';
import { ratioToDb } from './units';

export type Weighting = 'uniform' | 'hann' | 'hamming' | 'cosine';

export interface ArrayParams {
  n: number; // elements per side (planar n × n)
  spacingLambda: number; // d/λ
  steerThetaDeg: number; // steering elevation from boresight
  steerPhiDeg: number; // steering azimuth
  weighting: Weighting;
  /** element-pattern exponent q in cos^q(θ); 0 = isotropic */
  elementQ?: number;
}

export function weights(n: number, w: Weighting): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0.5 : i / (n - 1);
    switch (w) {
      case 'uniform': out.push(1); break;
      case 'hann': out.push(0.08 + 0.92 * Math.sin(Math.PI * x) ** 2); break; // pedestal avoids zero edge weights
      case 'hamming': out.push(0.54 - 0.46 * Math.cos(2 * Math.PI * x)); break;
      case 'cosine': out.push(0.2 + 0.8 * Math.sin(Math.PI * x)); break;
    }
  }
  return out;
}

/** Progressive phase per element (rad) that steers the beam to θ0: φn = −n·k·d·sinθ0 */
export function progressivePhase(spacingLambda: number, steerDeg: number): number {
  return -2 * Math.PI * spacingLambda * Math.sin((steerDeg * Math.PI) / 180);
}

/**
 * Linear array factor magnitude (normalised to 1 at its peak weight sum):
 * AF(θ) = |Σ wₙ exp[j n (k d sinθ + φ)]| / Σ wₙ
 */
export function linearAF(n: number, spacingLambda: number, phaseStep: number, w: number[], thetaRad: number): number {
  const psi = 2 * Math.PI * spacingLambda * Math.sin(thetaRad) + phaseStep;
  let re = 0;
  let im = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    re += w[i] * Math.cos(i * psi);
    im += w[i] * Math.sin(i * psi);
    sum += w[i];
  }
  return Math.hypot(re, im) / sum;
}

/**
 * Planar (separable) array factor for direction (θ, φ), with the element spacing
 * the same in x and y. Returns |AF| normalised to 1.
 */
export function planarAF(p: ArrayParams, w: number[], theta: number, phi: number): number {
  const t0 = (p.steerThetaDeg * Math.PI) / 180;
  const p0 = (p.steerPhiDeg * Math.PI) / 180;
  const kd = 2 * Math.PI * p.spacingLambda;
  const bx = -kd * Math.sin(t0) * Math.cos(p0);
  const by = -kd * Math.sin(t0) * Math.sin(p0);
  const psiX = kd * Math.sin(theta) * Math.cos(phi) + bx;
  const psiY = kd * Math.sin(theta) * Math.sin(phi) + by;
  return sum1d(w, psiX) * sum1d(w, psiY);
}

function sum1d(w: number[], psi: number): number {
  let re = 0;
  let im = 0;
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    re += w[i] * Math.cos(i * psi);
    im += w[i] * Math.sin(i * psi);
    s += w[i];
  }
  return Math.hypot(re, im) / s;
}

/** Element pattern: cos^q θ in the forward hemisphere, a small back-lobe floor behind the ground plane. */
export function elementPattern(theta: number, q: number): number {
  const c = Math.cos(theta);
  return c > 0 ? Math.pow(c, q / 2) /* field */ : 0.003;
}

export interface ArrayMetrics {
  directivityDbi: number;
  hpbwDeg: number;
  sidelobeDb: number;
  gratingLobe: boolean;
  taperEfficiency: number;
  /** principal-plane cut through the steered beam, θ from −90..90° */
  cut: { thetaDeg: number; db: number }[];
}

/**
 * Directivity by numerical integration of |AF·EP|² over the sphere:
 * D = 4π · U_max / ∫∫ U sinθ dθ dφ.
 */
export function arrayMetrics(p: ArrayParams, nTheta = 90, nPhi = 120): ArrayMetrics {
  const q = p.elementQ ?? 1.3;
  const w = weights(p.n, p.weighting);
  let total = 0;
  let uMax = 0;
  const dT = Math.PI / nTheta;
  const dP = (2 * Math.PI) / nPhi;
  for (let i = 0; i < nTheta; i++) {
    const th = (i + 0.5) * dT;
    const st = Math.sin(th);
    const ep = elementPattern(th, q);
    for (let j = 0; j < nPhi; j++) {
      const ph = (j + 0.5) * dP;
      const f = planarAF(p, w, th, ph) * ep;
      const u = f * f;
      total += u * st * dT * dP;
      if (u > uMax) uMax = u;
    }
  }
  // Peak may fall between grid points → evaluate at the exact steering direction too.
  const t0 = (p.steerThetaDeg * Math.PI) / 180;
  const p0 = (p.steerPhiDeg * Math.PI) / 180;
  const fPeak = planarAF(p, w, Math.abs(t0), t0 >= 0 ? p0 : p0 + Math.PI) * elementPattern(Math.abs(t0), q);
  uMax = Math.max(uMax, fPeak * fPeak);
  const directivityDbi = ratioToDb((4 * Math.PI * uMax) / total);

  // Principal cut in the steering plane.
  const cut: { thetaDeg: number; db: number }[] = [];
  for (let k = -900; k <= 900; k += 2) {
    const tdeg = k / 10;
    const th = (tdeg * Math.PI) / 180;
    const f = planarAF(p, w, Math.abs(th), th >= 0 ? p0 : p0 + Math.PI) * elementPattern(Math.abs(th), q);
    cut.push({ thetaDeg: tdeg, db: 20 * Math.log10(Math.max(f, 1e-6)) });
  }
  const peak = cut.reduce((a, b) => (b.db > a.db ? b : a));
  // HPBW: walk outward from peak until −3 dB.
  const pi = cut.indexOf(peak);
  let l = pi;
  while (l > 0 && cut[l].db > peak.db - 3) l--;
  let r = pi;
  while (r < cut.length - 1 && cut[r].db > peak.db - 3) r++;
  const hpbwDeg = cut[r].thetaDeg - cut[l].thetaDeg;
  // Sidelobe: highest local maximum outside the main lobe nulls.
  let ln = pi;
  while (ln > 0 && cut[ln - 1].db < cut[ln].db) ln--;
  let rn = pi;
  while (rn < cut.length - 1 && cut[rn + 1].db < cut[rn].db) rn++;
  let sll = -80;
  for (let k = 1; k < cut.length - 1; k++) {
    if (k >= ln && k <= rn) continue;
    if (cut[k].db >= cut[k - 1].db && cut[k].db >= cut[k + 1].db) sll = Math.max(sll, cut[k].db - peak.db);
  }
  const sw = w.reduce((a, b) => a + b, 0);
  const sw2 = w.reduce((a, b) => a + b * b, 0);
  const taperEfficiency = ((sw * sw) / (w.length * sw2)) ** 2; // separable → squared
  const gratingLobe = p.spacingLambda >= 1 / (1 + Math.abs(Math.sin(t0)));
  return { directivityDbi, hpbwDeg, sidelobeDb: sll, gratingLobe, taperEfficiency, cut };
}

export const ARRAY_META: ModelMeta = {
  id: 'array-factor',
  title: 'Planar phased-array factor',
  equations: [
    'AF(θ) = Σ wₙ · exp[j n (k d sinθ + φₙ)]',
    'Steering: φₙ = −k d sinθ₀ (progressive phase)',
    'AF_planar(θ,φ) = AFx(ψx) · AFy(ψy),  ψx = kd sinθ cosφ + βx',
    'D = 4π U_max / ∯ U dΩ,  U = |AF · EP|²',
    'Grating-lobe free if d/λ < 1 / (1 + |sin θ₀|)',
  ],
  units: ['θ, φ: deg', 'd: wavelengths', 'D, G: dBi', 'SLL: dB relative to peak'],
  assumptions: ['Identical, isolated elements with cos^q(θ) pattern (q = 1.3)', 'No mutual coupling, ideal (continuous) phase shifters', 'Far field'],
  validity: 'Far-field, d/λ ≲ 1, |θ₀| ≲ 60°',
  limitations: ['Mutual coupling, scan blindness, phase quantisation and element failures ignored', 'Gain = directivity × assumed 70 % radiation efficiency'],
  reference: 'C. A. Balanis, Antenna Theory; R. J. Mailloux, Phased Array Antenna Handbook',
  kind: 'calculated',
};
