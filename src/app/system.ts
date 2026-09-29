import type { SystemInput } from '../models/system-model';
import type { Params } from './state';

/** Maps UI parameters onto the cross-scale system model input. */
export function systemInput(p: Params): SystemInput {
  return {
    adcBits: p.adcBits,
    adcFsMsps: p.adcFsMsps,
    channels: 32,
    modulation: p.modulation,
    array: { n: p.arrayN, spacingLambda: p.spacingLambda, steerThetaDeg: p.steerDeg, steerPhiDeg: p.steerAzDeg, weighting: p.weighting },
    paOutW: p.paOutW,
    paPae: 0.25,
    altitudeKm: p.altitudeKm,
    elevationDeg: p.elevationDeg,
    freqGHz: p.freqGHz,
    rxGainDbi: p.rxGainDbi,
    rxNoiseTempK: 250,
  };
}
