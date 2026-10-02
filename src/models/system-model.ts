import { adcPowerW, idealSnrDb } from './adc';
import type { ArrayParams } from './array-factor';
import { rfPower, solveBeam, type ArrayPowerMode, type BeamSolution } from './beam-solution';
import { BITS_PER_SYMBOL, type Modulation } from './modulation';
import { eclipseFraction, radiatorAreaM2, solarArrayPowerW } from './power';

/**
 * Cross-scale causality model. Every quantity is derived from the one before it,
 * so a change at chip level propagates to the spacecraft and the link:
 *
 *   ADC bits, fs ─▶ ADC power + DSP load ─▶ payload DC ─▶ heat ─▶ radiator area
 *   array size, taper ─▶ gain ─▶ EIRP ─▶ Pr, Eb/N0 ─▶ link margin
 *   steering ─▶ footprint centre ─▶ elevation, slant range ─▶ FSPL ─▶ link margin
 *   PA count ─▶ DC power ─▶ power balance / heat
 */
export interface SystemInput {
  adcBits: number;
  adcFsMsps: number;
  channels: number; // parallel ADC/DSP channels (sub-arrays)
  modulation: Modulation;
  array: ArrayParams;
  powerMode: ArrayPowerMode;
  paOutW: number; // RF output per element (per-element-fixed)
  totalRfW: number; // total RF output (total-rf-fixed)
  paPae: number; // power-added efficiency 0..1
  altitudeKm: number;
  freqGHz: number;
  rxGainDbi: number;
  rxNoiseTempK: number;
}

export interface SystemResult {
  quantSnrDb: number;
  adcPowerW: number;
  dspPowerW: number;
  paDcW: number;
  payloadDcW: number;
  busW: number;
  totalLoadW: number;
  solarW: number;
  powerMarginW: number;
  rfRadiatedW: number;
  heatW: number;
  radiatorM2: number;
  gainDbi: number;
  directivityDbi: number;
  hpbwDeg: number;
  sidelobeDb: number;
  gratingLobe: boolean;
  eirpDbw: number;
  dataRateBps: number;
  /** shared beam state: pattern, footprints and the link to the footprint centre */
  beam: BeamSolution;
  /** link to a user at the beam centre (null when the beam axis misses the Earth) */
  link: BeamSolution['link'];
}

const REQUIRED_EBN0: Record<Modulation, number> = { BPSK: 4.4, QPSK: 4.4, '16QAM': 8.4, '64QAM': 12.8 }; // ≈ Pb=1e-6 with ~6 dB LDPC coding gain
const RADIATION_EFF = 0.7;
const SYMBOL_RATE = 250e6; // Bd, 250 MHz channel

export const DSP_ENERGY_PER_BIT_SAMPLE_J = 1.2e-10; // J per (bit·sample) of processing, illustrative
export const BUS_BASELINE_W = 420; // OBC, ADCS, TT&C, heaters, propulsion idle

export function evaluateSystem(s: SystemInput): SystemResult {
  const fs = s.adcFsMsps * 1e6;
  const adcW = adcPowerW(s.adcBits, fs) * s.channels * 2; // I + Q
  const dspW = DSP_ENERGY_PER_BIT_SAMPLE_J * s.adcBits * fs * s.channels;
  const elements = s.array.n * s.array.n;
  const { rfW } = rfPower(s.powerMode, elements, s.paOutW, s.totalRfW);
  const paDcW = rfW / s.paPae;
  const payloadDcW = adcW + dspW + paDcW + 60 /* LO, LNAs, control */;
  const busW = BUS_BASELINE_W;
  const totalLoadW = payloadDcW + busW;
  const fEcl = eclipseFraction(s.altitudeKm);
  const solarW = solarArrayPowerW(2 * 3 * 2.8, 0.3, 1 - fEcl); // orbit average; two wings × 3 panels × 2.8 m²
  const rfRadiatedW = rfW * RADIATION_EFF;
  const heatW = totalLoadW - rfRadiatedW;
  const dataRateBps = SYMBOL_RATE * BITS_PER_SYMBOL[s.modulation] * 0.75; // rate-3/4 code
  const beam = solveBeam({
    array: s.array,
    freqGHz: s.freqGHz,
    altitudeKm: s.altitudeKm,
    powerMode: s.powerMode,
    paOutW: s.paOutW,
    totalRfW: s.totalRfW,
    radiationEff: RADIATION_EFF,
    rxGainDbi: s.rxGainDbi,
    rxNoiseTempK: s.rxNoiseTempK,
    otherLossesDb: 3,
    dataRateBps,
    requiredEbN0Db: REQUIRED_EBN0[s.modulation],
  });
  const m = beam.pattern;
  const gainDbi = m.gainDbi;
  const eirpDbw = beam.power.eirpDbw;
  const link = beam.link;
  return {
    quantSnrDb: idealSnrDb(s.adcBits),
    adcPowerW: adcW,
    dspPowerW: dspW,
    paDcW,
    payloadDcW,
    busW,
    totalLoadW,
    solarW,
    powerMarginW: solarW - totalLoadW,
    rfRadiatedW,
    heatW,
    radiatorM2: radiatorAreaM2(heatW, 300),
    gainDbi,
    directivityDbi: m.directivityDbi,
    hpbwDeg: m.hpbwDeg,
    sidelobeDb: m.sidelobeDb,
    gratingLobe: m.gratingLobe,
    eirpDbw,
    dataRateBps,
    beam,
    link,
  };
}

export { REQUIRED_EBN0 };
