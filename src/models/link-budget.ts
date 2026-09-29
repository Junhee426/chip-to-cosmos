import type { ModelMeta } from './meta';
import { BOLTZMANN_DBW_PER_K_HZ, EARTH_RADIUS_M, wattsToDbw, wavelengthM } from './units';

/** Slant range from satellite altitude and ground elevation angle (spherical Earth). */
export function slantRangeM(altitudeM: number, elevationDeg: number): number {
  const re = EARTH_RADIUS_M;
  const el = (elevationDeg * Math.PI) / 180;
  const rs = re + altitudeM;
  return Math.sqrt(rs * rs - (re * Math.cos(el)) ** 2) - re * Math.sin(el);
}

/** FSPL = 20 log10(4πR/λ)  [dB] */
export function fsplDb(rangeM: number, freqHz: number): number {
  return 20 * Math.log10((4 * Math.PI * rangeM) / wavelengthM(freqHz));
}

export interface LinkInput {
  altitudeKm: number;
  elevationDeg: number;
  freqGHz: number;
  txPowerW: number; // total RF power into the antenna
  txGainDbi: number;
  rxGainDbi: number;
  rxNoiseTempK: number;
  otherLossesDb: number; // atmosphere, pointing, polarisation
  dataRateBps: number;
  requiredEbN0Db: number;
}

export interface LinkResult {
  rangeKm: number;
  fsplDb: number;
  txPowerDbw: number;
  eirpDbw: number;
  rxPowerDbw: number;
  rxPowerDbm: number;
  gOverTDbK: number;
  cn0DbHz: number;
  ebN0Db: number;
  marginDb: number;
}

export function linkBudget(i: LinkInput): LinkResult {
  const range = slantRangeM(i.altitudeKm * 1000, i.elevationDeg);
  const fspl = fsplDb(range, i.freqGHz * 1e9);
  const txPowerDbw = wattsToDbw(i.txPowerW);
  const eirpDbw = txPowerDbw + i.txGainDbi;
  const rxPowerDbw = eirpDbw + i.rxGainDbi - fspl - i.otherLossesDb; // Pr = Pt + Gt + Gr − L
  const gOverTDbK = i.rxGainDbi - 10 * Math.log10(i.rxNoiseTempK);
  const cn0DbHz = eirpDbw + gOverTDbK - fspl - i.otherLossesDb - BOLTZMANN_DBW_PER_K_HZ;
  const ebN0Db = cn0DbHz - 10 * Math.log10(i.dataRateBps);
  return {
    rangeKm: range / 1000,
    fsplDb: fspl,
    txPowerDbw,
    eirpDbw,
    rxPowerDbw,
    rxPowerDbm: rxPowerDbw + 30,
    gOverTDbK,
    cn0DbHz,
    ebN0Db,
    marginDb: ebN0Db - i.requiredEbN0Db,
  };
}

export const LINK_META: ModelMeta = {
  id: 'link-budget',
  title: 'Downlink budget',
  equations: [
    'R = √((Re+h)² − (Re·cos El)²) − Re·sin El',
    'FSPL = 20·log10(4πR/λ)',
    'EIRP = Pt + Gt',
    'Pr = Pt + Gt + Gr − FSPL − L',
    'C/N0 = EIRP + G/T − FSPL − L − 10log10(k)',
    'Eb/N0 = C/N0 − 10log10(Rb),  Margin = Eb/N0 − (Eb/N0)req',
  ],
  units: ['Pt: W → dBW', 'Gt, Gr: dBi', 'FSPL, L: dB', 'EIRP, Pr: dBW (dBm = dBW + 30)', 'G/T: dB/K', 'C/N0: dB-Hz', 'k = −228.6 dBW/(K·Hz)'],
  assumptions: ['Spherical Earth, free-space propagation', 'Lumped other losses (atmosphere, pointing, polarisation)', 'Receiver noise temperature constant'],
  validity: 'Line-of-sight LEO links, El ≥ 10°',
  limitations: ['No rain-fade statistics (ITU-R P.618), no interference (C/I), no Doppler', 'Required Eb/N0 is a single fixed value per modulation'],
  reference: 'Maral & Bousquet, Satellite Communications Systems; ITU-R P.525',
  kind: 'calculated',
};
