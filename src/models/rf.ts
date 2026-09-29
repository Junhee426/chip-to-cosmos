import type { ModelMeta } from './meta';
import { T0_NOISE_K, dbToRatio, ratioToDb } from './units';

export interface RfStage {
  id: string;
  name: string;
  gainDb: number; // dB (negative for loss)
  nfDb: number; // dB
}

export interface CascadeResult {
  totalGainDb: number;
  totalNf: number; // linear noise factor
  totalNfDb: number;
  noiseTempK: number;
  /** cumulative NF (dB) after each stage */
  cumulativeNfDb: number[];
  /** each stage's added term in the Friis sum (linear) */
  contributions: number[];
}

/** Friis: F = F1 + (F2−1)/G1 + (F3−1)/(G1G2) + … */
export function friisCascade(stages: RfStage[]): CascadeResult {
  let gProd = 1;
  let f = 0;
  const cumulativeNfDb: number[] = [];
  const contributions: number[] = [];
  stages.forEach((s, i) => {
    const Fi = dbToRatio(s.nfDb);
    const term = i === 0 ? Fi : (Fi - 1) / gProd;
    contributions.push(term);
    f += term;
    cumulativeNfDb.push(ratioToDb(f));
    gProd *= dbToRatio(s.gainDb);
  });
  return {
    totalGainDb: ratioToDb(gProd),
    totalNf: f,
    totalNfDb: ratioToDb(f),
    noiseTempK: T0_NOISE_K * (f - 1),
    cumulativeNfDb,
    contributions,
  };
}

/** Receiver noise floor: −174 dBm/Hz + 10log10(B) + NF  [dBm] */
export function noiseFloorDbm(bandwidthHz: number, nfDb: number): number {
  return -173.975 + 10 * Math.log10(bandwidthHz) + nfDb;
}

export const DEFAULT_RX_CHAIN: RfStage[] = [
  { id: 'feed', name: 'Feed / cable loss', gainDb: -0.5, nfDb: 0.5 },
  { id: 'lna', name: 'LNA', gainDb: 22, nfDb: 1.2 },
  { id: 'filter', name: 'BPF', gainDb: -2, nfDb: 2 },
  { id: 'mixer', name: 'Mixer', gainDb: -7, nfDb: 8 },
  { id: 'ifamp', name: 'IF amplifier', gainDb: 20, nfDb: 4 },
  { id: 'adc', name: 'ADC (equiv.)', gainDb: 0, nfDb: 25 },
];

export interface ChainBlock {
  id: string;
  name: string;
  func: string;
  input: string;
  output: string;
  params: string[];
  equation: string;
}

/** Transmit/receive payload signal chain used for the payload scene & info panels. */
export const SIGNAL_CHAIN: ChainBlock[] = [
  { id: 'antenna', name: 'Antenna (Rx)', func: 'Converts incident EM wave to a guided RF signal', input: 'Plane wave, ~ −120 dBW', output: 'RF voltage on feed', params: ['Gain 35 dBi (array)', 'G/T ≈ 10 dB/K', 'Ka-band 17.7–20.2 GHz'], equation: 'G = η·4πA/λ²' },
  { id: 'lna', name: 'LNA', func: 'Amplifies the weak signal while adding minimal noise', input: 'RF, ~ −100 dBm', output: 'RF, +22 dB', params: ['NF 1.2 dB', 'G 22 dB', 'IP3 −5 dBm'], equation: 'F_total ≈ F1 + (F2−1)/G1 + …' },
  { id: 'filter', name: 'Band-pass filter', func: 'Rejects out-of-band interference and image', input: 'Wideband RF', output: 'In-band RF', params: ['IL 2 dB', 'Rejection 60 dB', 'BW 500 MHz'], equation: 'NF_passive = Loss (dB) at T0' },
  { id: 'mixer', name: 'Mixer + LO', func: 'Translates RF to IF/baseband by multiplication with LO', input: 'RF f_RF', output: 'IF f_RF − f_LO', params: ['Conv. loss 7 dB', 'NF 8 dB', 'LO phase noise'], equation: 'cos a·cos b = ½[cos(a−b)+cos(a+b)]' },
  { id: 'adc', name: 'ADC', func: 'Samples and quantises the analog IF into digital words', input: 'Analog IF', output: 'N-bit samples at fs', params: ['N = 8–12 bit', 'fs ≥ 2·f_max', 'ENOB'], equation: 'SNR ≈ 6.02N + 1.76 dB' },
  { id: 'dsp', name: 'DSP / Channeliser', func: 'Digital filtering, channelisation, down-conversion', input: 'Raw samples', output: 'Channel streams', params: ['FFT/polyphase', 'GOPS load ∝ fs·N'], equation: 'P_dyn ≈ α·C·V²·f' },
  { id: 'modem', name: 'Modem', func: 'Demodulates / decodes symbols to bits (and back)', input: 'Channel samples', output: 'Bit stream', params: ['BPSK…64QAM', 'LDPC FEC', 'Eb/N0 req.'], equation: 'Pb(BPSK) = Q(√(2Eb/N0))' },
  { id: 'beamformer', name: 'Beamformer / OBP', func: 'Applies per-element phase/amplitude weights; routes packets', input: 'Bits / baseband', output: 'Per-element weighted signals', params: ['256 elements', 'Phase res. 6 bit', 'Steer ±60°'], equation: 'AF(θ) = Σ wₙ e^{jn(kd sinθ + φₙ)}' },
  { id: 'pa', name: 'Power amplifier', func: 'Raises the signal to transmit power at each element', input: 'RF, ~ 0 dBm', output: 'RF, ~ +27 dBm per element', params: ['PAE 25 %', 'P1dB', 'Back-off 3 dB'], equation: 'PAE = (Pout − Pin)/P_DC' },
  { id: 'antenna_tx', name: 'Antenna (Tx)', func: 'Radiates the combined beam toward users', input: 'N element signals', output: 'Steered beam, EIRP', params: ['EIRP ≈ 45 dBW', 'Beamwidth ~3°'], equation: 'EIRP = Pt + Gt' },
];

export const RF_META: ModelMeta = {
  id: 'rf',
  title: 'Receiver cascade noise (Friis)',
  equations: ['F_total = F1 + (F2−1)/G1 + (F3−1)/(G1G2) + …', 'Te = T0 (F − 1)', 'N_floor = −174 dBm/Hz + 10log10 B + NF'],
  units: ['G, NF: dB (ratio)', 'F, G in the sum: linear', 'Te, T0: K (T0 = 290 K)', 'N_floor: dBm'],
  assumptions: ['Stages impedance-matched', 'Noise factors defined at T0 = 290 K', 'Linear operation (no compression)'],
  validity: 'Small-signal, matched cascades',
  limitations: ['ADC represented by an equivalent NF', 'Mismatch, image noise and LO phase noise ignored'],
  reference: 'H. T. Friis, "Noise Figures of Radio Receivers", Proc. IRE, 1944; Pozar, Microwave Engineering',
  kind: 'calculated',
};
