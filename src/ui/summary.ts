import type { LevelId } from '../app/navigation';
import type { Params } from '../app/state';
import { solveSystem } from '../app/system';
import { mosfet } from '../models/mosfet';
import { friisCascade, DEFAULT_RX_CHAIN } from '../models/rf';
import { junctionTemperatures } from '../models/power';
import { diodeCurrent, intrinsicCarrierDensity } from '../models/semiconductor';
import { formatSI } from '../models/units';

const sign = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

/** One key, calculated parameter per level for the collapsed mobile inspector. */
export const LEVEL_KEY_PARAM: Record<LevelId, (p: Params) => string> = {
  cosmos: (p) => {
    const L = solveSystem(p).link;
    return L ? `Link margin ${sign(L.marginDb)} dB @ El ${L.elevationDeg.toFixed(0)}° (beam centre)` : 'Beam centre above the horizon — no link';
  },
  satellite: (p) => {
    const s = solveSystem(p);
    return `Power margin ${sign(s.powerMarginW, 0)} W · radiator ${s.radiatorM2.toFixed(2)} m²`;
  },
  array: (p) => {
    const s = solveSystem(p);
    const f = s.beam.footprint;
    return `Gain ${s.gainDbi.toFixed(1)} dBi · HPBW ${s.hpbwDeg.toFixed(1)}° · footprint ${f.center ? `${Math.round(f.alongTrackKm)}×${Math.round(f.crossTrackKm)} km` : 'off Earth'}`;
  },
  payload: () => `Cascade NF ${friisCascade(DEFAULT_RX_CHAIN).totalNfDb.toFixed(2)} dB`,
  pcb: (p) => {
    const s = solveSystem(p);
    return `SoC power ${((s.adcPowerW + s.dspPowerW) / 8 + 6).toFixed(1)} W`;
  },
  package: () => `Tj ≈ ${junctionTemperatures(25, 40).tj.toFixed(0)} °C at 25 W`,
  die: (p) => `ADC ${p.adcBits} bit · ${p.adcFsMsps} MS/s`,
  mosfet: (p) => {
    const r = mosfet({ vgs: p.vgs, vds: p.vds, wOverL: p.wOverL, tempK: p.tempK });
    return `Id = ${formatSI(r.id, 'A')} · ${r.region}`;
  },
  silicon: (p) => `ni = ${intrinsicCarrierDensity(p.tempK).toExponential(2)} cm⁻³ at ${p.tempK} K`,
  energy: (p) => `Vd = ${p.vd.toFixed(2)} V · I = ${formatSI(diodeCurrent(p.vd, 1e-14, 1, p.tempK), 'A')}`,
};
