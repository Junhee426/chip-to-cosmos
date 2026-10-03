import type { ModelMeta } from './meta';
import { ratioToDb } from './units';
import { EARTH_RADIUS_KM, canonicalOrbit, cross, dot, earthIntersection, elevationDeg, greatCircleKm, len, normalize, sub, arrayDirToWorld, type Vec3 } from './frames';

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

/**
 * |Σ wᵢ e^{j i ψ}| / Σ wᵢ. The phasor e^{j i ψ} is advanced by one complex
 * multiplication per element instead of a cos/sin pair (same sum; rounding
 * error ~ n·1e-16, far below anything displayed). This is the hot loop of the
 * directivity integration and of the BEAM LAB surface.
 */
function sum1d(w: number[], psi: number): number {
  const c = Math.cos(psi);
  const sn = Math.sin(psi);
  let pr = 1;
  let pi = 0;
  let re = 0;
  let im = 0;
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    const wi = w[i];
    re += wi * pr;
    im += wi * pi;
    s += wi;
    const t = pr * c - pi * sn;
    pi = pr * sn + pi * c;
    pr = t;
  }
  return Math.hypot(re, im) / s;
}

/** Element pattern: cos^q θ in the forward hemisphere, a small back-lobe floor behind the ground plane. */
export function elementPattern(theta: number, q: number): number {
  return elementPatternCos(Math.cos(theta), q);
}

/** Element field pattern from cos θ (= the boresight component of a unit direction). */
export function elementPatternCos(c: number, q: number): number {
  return c > 0 ? Math.pow(c, q / 2) /* field */ : 0.003;
}

/**
 * |AF · EP| for a unit direction in the ARRAY LOCAL frame (+Y boresight).
 * Identical to planarAF(θ, φ) · elementPattern(θ), written with direction
 * cosines u = d.x = sinθ cosφ, v = d.z = sinθ sinφ.
 */
export function fieldAt(p: ArrayParams, w: number[], d: Vec3): number {
  const q = p.elementQ ?? 1.3;
  const t0 = (p.steerThetaDeg * Math.PI) / 180;
  const p0 = (p.steerPhiDeg * Math.PI) / 180;
  const kd = 2 * Math.PI * p.spacingLambda;
  const psiX = kd * d[0] - kd * Math.sin(t0) * Math.cos(p0);
  const psiY = kd * d[2] - kd * Math.sin(t0) * Math.sin(p0);
  return sum1d(w, psiX) * sum1d(w, psiY) * elementPatternCos(d[1], q);
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


/** Smallest d/λ that lets a grating lobe enter visible space for steering θ0 (in-plane lobe). */
export function gratingLimit(steerThetaDeg: number): number {
  return 1 / (1 + Math.abs(Math.sin((steerThetaDeg * Math.PI) / 180)));
}

/** Unit vector rotated from `axis` by angle `a` toward `side` (side ⟂ axis). */
function tilt(axis: Vec3, side: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [axis[0] * c + side[0] * s, axis[1] * c + side[1] * s, axis[2] * c + side[2] * s];
}

/**
 * Locate the true lobe maximum near a nominal direction. The element pattern
 * pulls a scanned lobe slightly toward boresight, so the maximum is searched
 * (golden section) along the great circle through boresight and `nominal`.
 */
export function refinePeak(f: (d: Vec3) => number, nominal: Vec3, halfWidthRad: number): Vec3 {
  const sinA = Math.hypot(nominal[0], nominal[2]);
  if (sinA < 1e-9) return nominal;
  const e2: Vec3 = [nominal[0] / sinA, 0, nominal[2] / sinA];
  const a0 = Math.atan2(sinA, nominal[1]);
  const at = (a: number): Vec3 => [e2[0] * Math.sin(a), Math.cos(a), e2[2] * Math.sin(a)];
  let lo = Math.max(0, a0 - halfWidthRad);
  let hi = Math.min(Math.PI / 2, a0 + halfWidthRad);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = f(at(x1));
  let f2 = f(at(x2));
  for (let i = 0; i < 40; i++) {
    if (f1 < f2) {
      lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(at(x2));
    } else {
      hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(at(x1));
    }
  }
  const best = at((lo + hi) / 2);
  return f(best) >= f(nominal) ? best : nominal;
}

/**
 * Directions where |AF·EP| falls to `level` around `axis`, one per azimuth step
 * (ordered, so consecutive points form a closed contour). Each ray is marched
 * outward with step `step` (rad) and then bisected to 1e-5 rad.
 */
export function traceContour(f: (d: Vec3) => number, axis: Vec3, level: number, nAz: number, step: number, maxAngle = 1.4): Vec3[] {
  const ref: Vec3 = Math.abs(axis[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(axis, ref));
  const v = normalize(cross(axis, u));
  const out: Vec3[] = [];
  for (let k = 0; k < nAz; k++) {
    const psi = (2 * Math.PI * k) / nAz;
    const side: Vec3 = [u[0] * Math.cos(psi) + v[0] * Math.sin(psi), u[1] * Math.cos(psi) + v[1] * Math.sin(psi), u[2] * Math.cos(psi) + v[2] * Math.sin(psi)];
    let hi = -1;
    for (let a = step; a <= maxAngle; a += step) {
      if (f(tilt(axis, side, a)) < level) {
        hi = a;
        break;
      }
    }
    if (hi < 0) continue;
    let lo = hi - step;
    while (hi - lo > 1e-5) {
      const m = (lo + hi) / 2;
      if (f(tilt(axis, side, m)) < level) hi = m;
      else lo = m;
    }
    out.push(normalize(tilt(axis, side, (lo + hi) / 2)));
  }
  return out;
}

export interface Lobe {
  /** lobe maximum, ARRAY LOCAL unit vector */
  axis: Vec3;
  /** peak level relative to the main beam (dB) */
  levelDb: number;
  /** grating order (m, n) — (0, 0) is the main beam */
  order: [number, number];
}

/**
 * Grating lobes in visible space. AF maxima repeat at direction cosines
 * u = u0 + m/(d/λ), v = v0 + n/(d/λ); a lobe exists where u² + v² < 1.
 */
export function gratingLobes(p: ArrayParams, w: number[], mainPeak: number, hpbwRad: number): Lobe[] {
  const t0 = (p.steerThetaDeg * Math.PI) / 180;
  const p0 = (p.steerPhiDeg * Math.PI) / 180;
  const u0 = Math.sin(t0) * Math.cos(p0);
  const v0 = Math.sin(t0) * Math.sin(p0);
  const f = (d: Vec3) => fieldAt(p, w, d);
  const out: Lobe[] = [];
  const M = Math.ceil(2 * p.spacingLambda) + 1;
  for (let m = -M; m <= M; m++) for (let n = -M; n <= M; n++) {
    if (m === 0 && n === 0) continue;
    const u = u0 + m / p.spacingLambda;
    const v = v0 + n / p.spacingLambda;
    const r2 = u * u + v * v;
    if (r2 >= 1 - 1e-6) continue;
    const nominal: Vec3 = [u, Math.sqrt(1 - r2), v];
    const axis = refinePeak(f, nominal, hpbwRad);
    out.push({ axis, levelDb: 20 * Math.log10(Math.max(f(axis), 1e-9) / mainPeak), order: [m, n] });
  }
  return out.sort((a, b) => b.levelDb - a.levelDb);
}

export interface Footprint {
  /** −3 dB contour on a flat ground plane at `altitudeKm` along boresight: (x, z) in km */
  contourKm: [number, number][];
  /** unit directions of the contour (array frame, +Y = boresight) */
  directions: [number, number, number][];
  /** ground point of the beam peak (km) */
  centerKm: [number, number];
  /** extent along the steering plane and across it (km) */
  alongKm: number;
  acrossKm: number;
  areaKm2: number;
}

/** Contour-tracing step: a fraction of the half-power width, bounded for narrow and broad beams. */
export function contourStep(hpbwDeg: number): number {
  return Math.min(0.01, Math.max(0.0008, (hpbwDeg * Math.PI) / 180 / 12));
}

/**
 * −3 dB beam footprint, traced numerically from the same |AF·EP| used for the
 * radiation surface: around the beam maximum, step away until the pattern is
 * 3 dB below the peak, then intersect that direction with a flat ground plane
 * at the orbit altitude (flat-Earth; BEAM LAB pedagogy — see sphericalFootprint).
 */
export function beamFootprint(p: ArrayParams, altitudeKm: number, nAz = 72, hpbwDeg?: number): Footprint {
  const w = weights(p.n, p.weighting);
  const f = (d: Vec3) => fieldAt(p, w, d);
  const hp = hpbwDeg ?? estimateHpbwDeg(p);
  const axis = refinePeak(f, steerAxis(p), ((hp / 2) * Math.PI) / 180);
  const directions = traceContour(f, axis, f(axis) / Math.SQRT2, nAz, contourStep(hp));
  return flatFootprint(directions, axis, p.steerPhiDeg, altitudeKm);
}

/** Nominal steering direction (ARRAY LOCAL). */
export function steerAxis(p: ArrayParams): Vec3 {
  const t0 = (p.steerThetaDeg * Math.PI) / 180;
  const p0 = (p.steerPhiDeg * Math.PI) / 180;
  return [Math.sin(t0) * Math.cos(p0), Math.cos(t0), Math.sin(t0) * Math.sin(p0)];
}

/** Uniform-array HPBW estimate (only seeds the contour step when metrics are not at hand). */
function estimateHpbwDeg(p: ArrayParams): number {
  const c = Math.max(0.2, Math.cos((p.steerThetaDeg * Math.PI) / 180));
  return Math.min(60, (50.8 / (p.n * p.spacingLambda)) / c);
}

/** Project contour directions onto a flat plane at `altitudeKm` below the array (along boresight). */
export function flatFootprint(directions: Vec3[], axis: Vec3, steerPhiDeg: number, altitudeKm: number): Footprint {
  const contourKm: [number, number][] = [];
  for (const d of directions) if (d[1] > 1e-3) contourKm.push([(d[0] / d[1]) * altitudeKm, (d[2] / d[1]) * altitudeKm]);
  const centerKm: [number, number] = axis[1] > 1e-3 ? [(axis[0] / axis[1]) * altitudeKm, (axis[2] / axis[1]) * altitudeKm] : [0, 0];
  const p0 = (steerPhiDeg * Math.PI) / 180;
  const ca = Math.cos(p0);
  const sa = Math.sin(p0);
  let minA = Infinity, maxA = -Infinity, minC = Infinity, maxC = -Infinity, area = 0;
  contourKm.forEach(([x, z], i) => {
    const a = x * ca + z * sa;
    const c = -x * sa + z * ca;
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    const [x2, z2] = contourKm[(i + 1) % contourKm.length];
    area += x * z2 - x2 * z;
  });
  const ok = contourKm.length >= 3;
  return { contourKm, directions: directions as [number, number, number][], centerKm, alongKm: ok ? maxA - minA : 0, acrossKm: ok ? maxC - minC : 0, areaKm2: ok ? Math.abs(area) / 2 : 0 };
}

export interface SphericalFootprint {
  /** −3 dB contour on the Earth sphere, Earth-centred km in the CANONICAL orbit frame */
  contour: Vec3[];
  /** false when part of the contour points above the horizon (those rays miss the Earth) */
  complete: boolean;
  /** ground point of the beam maximum, or null when the beam axis misses the Earth */
  center: Vec3 | null;
  /** elevation of the satellite seen from `center` (deg) */
  centerElevationDeg: number | null;
  slantRangeKm: number | null;
  /** great-circle distance from the sub-satellite point to `center` */
  nadirOffsetKm: number | null;
  /** extents in the local tangent plane at the centre, along and across the ground track */
  alongTrackKm: number;
  crossTrackKm: number;
  areaKm2: number;
}

/**
 * Spherical-Earth footprint: every contour direction is taken
 * ARRAY LOCAL → SATELLITE BODY → EARTH/WORLD (canonical orbit) and the ray from
 * the spacecraft is intersected with the Earth sphere. Rays that miss
 * (above the horizon) are dropped and reported via `complete = false`.
 */
export function sphericalFootprint(directions: Vec3[], axis: Vec3, altitudeKm: number): SphericalFootprint {
  const orbit = canonicalOrbit(altitudeKm);
  const contour: Vec3[] = [];
  for (const d of directions) {
    const g = earthIntersection(orbit, arrayDirToWorld(d, orbit));
    if (g) contour.push(g);
  }
  const center = earthIntersection(orbit, arrayDirToWorld(axis, orbit));
  const nadir: Vec3 = [0, EARTH_RADIUS_KM, 0];
  const ref = center ?? (contour.length ? normalizeTo(contour.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3, [0, 0, 0] as Vec3), EARTH_RADIUS_KM) : null);
  let alongTrackKm = 0, crossTrackKm = 0, areaKm2 = 0;
  if (ref && contour.length >= 3) {
    let minA = Infinity, maxA = -Infinity, minC = Infinity, maxC = -Infinity, area = 0;
    const loc = tangentPlaneKm(contour, ref, orbit.x);
    loc.forEach(([x, y], i) => {
      minA = Math.min(minA, x); maxA = Math.max(maxA, x);
      minC = Math.min(minC, y); maxC = Math.max(maxC, y);
      const [x2, y2] = loc[(i + 1) % loc.length];
      area += x * y2 - x2 * y;
    });
    alongTrackKm = maxA - minA;
    crossTrackKm = maxC - minC;
    areaKm2 = Math.abs(area) / 2;
  }
  return {
    contour,
    complete: contour.length === directions.length && directions.length > 0,
    center,
    centerElevationDeg: center ? elevationDeg(center, orbit.posKm) : null,
    slantRangeKm: center ? len(sub(orbit.posKm, center)) : null,
    nadirOffsetKm: center ? greatCircleKm(nadir, center) : null,
    alongTrackKm: finite(alongTrackKm),
    crossTrackKm: finite(crossTrackKm),
    areaKm2: finite(areaKm2),
  };
}

/**
 * Local tangent plane at `ref` (Earth-centred km): x along the ground track
 * (`alongTrack` projected into the plane), y = n × x across it. Equal km on both axes.
 * The footprint extents above are measured in exactly this plane.
 */
export function tangentPlaneKm(points: Vec3[], ref: Vec3, alongTrack: Vec3): [number, number][] {
  const n = normalize(ref);
  let a = sub(alongTrack, [n[0] * dot(alongTrack, n), n[1] * dot(alongTrack, n), n[2] * dot(alongTrack, n)]);
  if (len(a) < 1e-6) a = [0, 0, 1];
  a = normalize(a);
  const c = cross(n, a);
  return points.map((p) => {
    const r = sub(p, ref);
    return [dot(r, a), dot(r, c)] as [number, number];
  });
}

function normalizeTo(a: Vec3, r: number): Vec3 {
  const n = normalize(a);
  return [n[0] * r, n[1] * r, n[2] * r];
}
const finite = (x: number): number => (Number.isFinite(x) ? x : 0);
