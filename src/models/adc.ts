import type { ModelMeta } from './meta';

export interface AdcParams {
  signalHz: number;
  fsHz: number;
  bits: number;
  amplitude?: number; // fraction of full scale (0..1]
}

/** Ideal quantisation-noise-limited SNR for a full-scale sine: 6.02N + 1.76 dB */
export const idealSnrDb = (bits: number): number => 6.02 * bits + 1.76;

export const nyquistOk = (signalHz: number, fsHz: number): boolean => fsHz > 2 * signalHz;

/** Apparent frequency after sampling (folding into [0, fs/2]). */
export function aliasFrequency(signalHz: number, fsHz: number): number {
  const f = Math.abs(signalHz - fsHz * Math.round(signalHz / fsHz));
  return f;
}

/** Mid-rise uniform quantiser on [−1, 1]. */
export function quantize(x: number, bits: number): number {
  const levels = Math.pow(2, bits);
  const step = 2 / levels;
  const clipped = Math.max(-1, Math.min(1 - 1e-12, x));
  return (Math.floor(clipped / step) + 0.5) * step;
}

export interface AdcTrace {
  continuous: [number, number][]; // (t, v)
  samples: [number, number][]; // sampled instants (t, v)
  quantized: [number, number][]; // (t, q)
  alias: [number, number][]; // reconstructed sine at the alias frequency
  aliasHz: number;
  measuredSnrDb: number;
}

/** Generates plot traces for `periods` cycles of the input signal. */
export function adcTrace(p: AdcParams, periods = 3): AdcTrace {
  const A = p.amplitude ?? 0.95;
  const aliasHz0 = aliasFrequency(p.signalHz, p.fsHz);
  // Long enough to show several samples and at least 1.5 cycles of any alias.
  const tEnd = Math.min(Math.max(periods / p.signalHz, 16 / p.fsHz, aliasHz0 > 0 ? 1.5 / aliasHz0 : 0), 400 / p.fsHz);
  const dense = Math.min(4000, Math.max(400, Math.ceil(tEnd * p.signalHz * 24)));
  const continuous: [number, number][] = [];
  for (let i = 0; i <= dense; i++) {
    const t = (tEnd * i) / dense;
    continuous.push([t, A * Math.sin(2 * Math.PI * p.signalHz * t)]);
  }
  const samples: [number, number][] = [];
  const quantized: [number, number][] = [];
  const nS = Math.floor(tEnd * p.fsHz);
  let sigPow = 0;
  let errPow = 0;
  for (let k = 0; k <= nS; k++) {
    const t = k / p.fsHz;
    const v = A * Math.sin(2 * Math.PI * p.signalHz * t);
    const q = quantize(v, p.bits);
    samples.push([t, v]);
    quantized.push([t, q]);
  }
  // Measured SNR on a long, non-coherent record so the error is spread over codes.
  const nLong = 4096;
  const fsLong = p.fsHz;
  for (let k = 0; k < nLong; k++) {
    const v = A * Math.sin(2 * Math.PI * p.signalHz * (k / fsLong) + 0.1234);
    const e = quantize(v, p.bits) - v;
    sigPow += v * v;
    errPow += e * e;
  }
  const aliasHz = aliasHz0;
  const alias: [number, number][] = [];
  // Reconstructed (lowest-frequency) sinusoid consistent with the samples.
  const sgn = Math.sin(2 * Math.PI * p.signalHz / p.fsHz) >= 0 ? 1 : -1;
  for (let i = 0; i <= dense; i++) {
    const t = (tEnd * i) / dense;
    alias.push([t, sgn * A * Math.sin(2 * Math.PI * aliasHz * t)]);
  }
  return { continuous, samples, quantized, alias, aliasHz, measuredSnrDb: 10 * Math.log10(sigPow / Math.max(errPow, 1e-30)) };
}

/**
 * Illustrative ADC power from the Walden figure of merit:
 * P = FOM · 2^ENOB · fs  (FOM ≈ 0.5 pJ/conversion-step, typical of GS/s
 * radiation-tolerant converters; state-of-the-art CMOS reaches ~10–50 fJ).
 */
export function adcPowerW(bits: number, fsHz: number, fomJ = 500e-15): number {
  const enob = bits - 1; // assume ~1 bit lost to non-idealities
  return fomJ * Math.pow(2, enob) * fsHz;
}

export const ADC_META: ModelMeta = {
  id: 'adc',
  title: 'Sampling & quantisation',
  equations: ['fs > 2·f_max (Nyquist)', 'f_alias = |f − fs·round(f/fs)|', 'SNR_q ≈ 6.02N + 1.76 dB', 'P_ADC ≈ FOM · 2^ENOB · fs'],
  units: ['f, fs: Hz', 'N: bits', 'SNR: dB', 'P: W', 'FOM: J/conv-step (0.5 pJ assumed)'],
  assumptions: ['Ideal uniform mid-rise quantiser, full-scale sine', 'No jitter, no thermal noise, ENOB = N − 1 for power estimate'],
  validity: 'Quantisation-limited ideal converter',
  limitations: ['Real ADCs are limited by jitter, DNL/INL and thermal noise (ENOB < N)', 'Walden-FOM power is an order-of-magnitude trend, not a datasheet value'],
  reference: 'W. Kester (Analog Devices) MT-001; R. H. Walden, IEEE JSAC 1999; B. Murmann ADC survey',
  kind: 'calculated',
};
