import { gratingLimit } from '../models/array-factor';
import type { Params } from './state';

export interface BeamPreset {
  id: 'nadir' | 'steered' | 'low-sidelobes' | 'grating';
  label: string;
  /** what the preset demonstrates (shown as the button title) */
  why: string;
  params: Partial<Params>;
}

const GL_STEER = 25;
/** Spacing for the grating-lobe experiment: well past the model's own threshold at this scan angle. */
const GL_SPACING = Math.min(1.2, Math.round((gratingLimit(GL_STEER) + 0.3) * 100) / 100);

/** A few validated starting points; tests assert each produces the effect it is named after. */
export const BEAM_PRESETS: BeamPreset[] = [
  { id: 'nadir', label: 'Nadir', why: '16×16 · 0.50λ · uniform · 0° — clean pencil beam straight down', params: { arrayN: 16, spacingLambda: 0.5, weighting: 'uniform', steerDeg: 0, steerAzDeg: 0 } },
  { id: 'steered', label: 'Steered', why: '16×16 · 0.50λ · uniform · 25° — phase gradient tilts the beam', params: { arrayN: 16, spacingLambda: 0.5, weighting: 'uniform', steerDeg: GL_STEER, steerAzDeg: 0 } },
  { id: 'low-sidelobes', label: 'Low sidelobes', why: '16×16 · 0.50λ · Hann · 25° — lower sidelobes, wider beam', params: { arrayN: 16, spacingLambda: 0.5, weighting: 'hann', steerDeg: GL_STEER, steerAzDeg: 0 } },
  { id: 'grating', label: 'Grating lobe', why: `16×16 · ${GL_SPACING.toFixed(2)}λ · uniform · 25° — spacing beyond d/λ = ${gratingLimit(GL_STEER).toFixed(2)}`, params: { arrayN: 16, spacingLambda: GL_SPACING, weighting: 'uniform', steerDeg: GL_STEER, steerAzDeg: 0 } },
];

/** Spacing used by the grating-lobe experiment (derived from the model's own threshold). */
export const GRATING_SPACING = GL_SPACING;

/**
 * The reproducible poster state (`?view=poster`, end of the Quick Demo).
 * Total RF fixed, so the frame shows the aperture effect without hidden power scaling;
 * 256 W total = 1 W per element at 16 × 16, i.e. the same numbers as the default design.
 */
export const POSTER_STATE: Partial<Params> = {
  arrayN: 16,
  spacingLambda: 0.5,
  steerDeg: GL_STEER,
  steerAzDeg: 0,
  weighting: 'uniform',
  powerMode: 'total-rf-fixed',
  totalRfW: 256,
  altitudeKm: 550,
  freqGHz: 19.7,
  rxGainDbi: 36,
};

/** Try-it slider range on the poster (inside PARAM_LIMITS.steerDeg). */
export const POSTER_STEER = { min: 0, max: 50 };
