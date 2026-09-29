import type { ModelMeta } from './meta';
import { SIGMA_SB, SOLAR_CONSTANT_W_M2 } from './units';

/** Orbit-average solar array output. */
export function solarArrayPowerW(areaM2: number, cellEfficiency: number, sunlitFraction: number, cosineLoss = 0.9, degradation = 0.92): number {
  return SOLAR_CONSTANT_W_M2 * areaM2 * cellEfficiency * cosineLoss * degradation * sunlitFraction;
}

/** Radiator area to reject Q at temperature T (single-sided, sink temperature Tsink). */
export function radiatorAreaM2(heatW: number, tempK: number, emissivity = 0.85, sinkK = 200): number {
  return heatW / (emissivity * SIGMA_SB * (tempK ** 4 - sinkK ** 4));
}

/** Eclipse fraction of a circular orbit with β = 0 (worst case): asin(Re / (Re+h)) / π. */
export function eclipseFraction(altitudeKm: number): number {
  const re = 6371;
  return Math.asin(re / (re + altitudeKm)) / Math.PI;
}

export const POWER_META: ModelMeta = {
  id: 'power',
  title: 'Spacecraft power & thermal balance',
  equations: [
    'P_SA = S·A·η·cos·D·f_sun  (S = 1361 W/m²)',
    'f_ecl = asin(Re/(Re+h)) / π   (β = 0)',
    'Q = P_DC − P_RF,radiated',
    'A_rad = Q / (ε σ (T⁴ − T_sink⁴))',
  ],
  units: ['P, Q: W', 'A: m²', 'T: K', 'σ = 5.67×10⁻⁸ W/(m²K⁴)'],
  assumptions: ['Orbit-average quantities', 'Single-node thermal model, radiator at 300 K, effective sink 200 K', 'All non-radiated DC power becomes heat'],
  validity: 'Conceptual sizing (phase-0 level)',
  limitations: ['No transient battery DoD, no Earth IR/albedo breakdown, no conduction network', 'Numbers are educational, not a real spacecraft datasheet'],
  reference: 'Wertz & Larson, Space Mission Analysis and Design; Gilmore, Spacecraft Thermal Control Handbook',
  kind: 'calculated',
};

/**
 * 1D series thermal-resistance stack from the cold plate up to the junction:
 * Tj = T_cp + P · (θ_IHS→cp + θ_TIM + θ_die). Resistances are typical values for
 * a 35 mm lidded flip-chip package (K/W).
 */
export function junctionTemperatures(powerW: number, coldPlateC: number, theta: [number, number, number] = [0.3, 0.15, 0.05]): { nodes: number[]; tj: number; theta: number[] } {
  const nodes = [coldPlateC];
  for (const t of theta) nodes.push(nodes[nodes.length - 1] + powerW * t);
  return { nodes, tj: nodes[nodes.length - 1], theta };
}
