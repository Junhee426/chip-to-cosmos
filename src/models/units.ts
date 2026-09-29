/**
 * Physical constants and strict unit conversions.
 * Convention: every function name states its unit, e.g. wattsToDbw().
 * dB is a ratio; dBW / dBm are absolute powers referenced to 1 W / 1 mW;
 * dBi is antenna gain relative to an isotropic radiator.
 */
export const C0 = 299_792_458; // m/s
export const K_BOLTZMANN_J = 1.380649e-23; // J/K
export const K_BOLTZMANN_EV = 8.617333262e-5; // eV/K
export const Q_E = 1.602176634e-19; // C
export const EPS0_F_PER_CM = 8.8541878128e-14; // F/cm
export const EPS0_F_PER_M = 8.8541878128e-12; // F/m
export const SIGMA_SB = 5.670374419e-8; // W/(m^2 K^4)
export const T0_NOISE_K = 290; // K, IEEE standard noise temperature
/** 10·log10(k) with k in J/K → −228.6 dBW/(K·Hz) */
export const BOLTZMANN_DBW_PER_K_HZ = 10 * Math.log10(K_BOLTZMANN_J);
export const EARTH_RADIUS_M = 6_371_000;
export const SOLAR_CONSTANT_W_M2 = 1361;

export const log10 = (x: number): number => Math.log(x) / Math.LN10;

export const ratioToDb = (ratio: number): number => 10 * log10(ratio);
export const dbToRatio = (db: number): number => Math.pow(10, db / 10);
export const wattsToDbw = (w: number): number => 10 * log10(w);
export const dbwToWatts = (dbw: number): number => Math.pow(10, dbw / 10);
export const wattsToDbm = (w: number): number => 10 * log10(w * 1000);
export const dbmToWatts = (dbm: number): number => Math.pow(10, dbm / 10) / 1000;
export const dbwToDbm = (dbw: number): number => dbw + 30;
export const dbmToDbw = (dbm: number): number => dbm - 30;

export const wavelengthM = (freqHz: number): number => C0 / freqHz;
export const thermalVoltage = (tempK: number): number => (K_BOLTZMANN_J * tempK) / Q_E;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Engineering formatting with SI prefix, e.g. 0.00123 A → "1.23 mA". */
export function formatSI(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const prefixes: [number, string][] = [
    [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
  ];
  const abs = Math.abs(value);
  for (const [scale, p] of prefixes) {
    if (abs >= scale * 0.9995) return `${(value / scale).toPrecision(digits)} ${p}${unit}`;
  }
  return `${value.toExponential(digits - 1)} ${unit}`;
}

export function formatSci(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const [m, e] = value.toExponential(digits - 1).split('e');
  return `${m}×10^${Number(e)}`;
}

/** Complementary error function (Abramowitz–Stegun 7.1.26 refined via Numerical Recipes erfcc, |ε| < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Gaussian Q-function Q(x) = ½ erfc(x/√2). */
export const qFunc = (x: number): number => 0.5 * erfc(x / Math.SQRT2);

/** Deterministic PRNG (mulberry32) so visualizations and tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box–Muller. */
export function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
