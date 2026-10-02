import type { BeamSolution } from '../models/beam-solution';
import { evaluateSystem, type SystemInput, type SystemResult } from '../models/system-model';
import type { Params } from './state';

/** Maps UI parameters onto the cross-scale system model input. */
export function systemInput(p: Params): SystemInput {
  return {
    adcBits: p.adcBits,
    adcFsMsps: p.adcFsMsps,
    channels: 32,
    modulation: p.modulation,
    array: { n: p.arrayN, spacingLambda: p.spacingLambda, steerThetaDeg: p.steerDeg, steerPhiDeg: p.steerAzDeg, weighting: p.weighting },
    powerMode: p.powerMode,
    paOutW: p.paOutW,
    totalRfW: p.totalRfW,
    paPae: 0.25,
    altitudeKm: p.altitudeKm,
    freqGHz: p.freqGHz,
    rxGainDbi: p.rxGainDbi,
    rxNoiseTempK: 250,
  };
}

const cache = new WeakMap<Params, SystemResult>();

/**
 * The single evaluation of the system (and its BeamSolution) for a parameter
 * set. The store replaces `params` on every change, so object identity is the
 * cache key: every scene and panel that reads the same state shares one result.
 */
export function solveSystem(p: Params): SystemResult {
  let r = cache.get(p);
  if (!r) {
    r = evaluateSystem(systemInput(p));
    cache.set(p, r);
  }
  return r;
}

export function beamSolution(p: Params): BeamSolution {
  return solveSystem(p).beam;
}
