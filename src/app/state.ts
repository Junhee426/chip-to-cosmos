import type { Modulation } from '../models/modulation';
import type { Weighting } from '../models/array-factor';
import type { ArrayPowerMode } from '../models/beam-solution';
import type { LevelId } from './navigation';

export type EngMode = 'structure' | 'signal' | 'power' | 'thermal' | 'radiation';
export type Quality = 'auto' | 'high' | 'balanced' | 'performance';
export type TheoryTab = 'intuition' | 'engineering' | 'theory';

export interface Params {
  // MOSFET
  vgs: number;
  vds: number;
  wOverL: number;
  tempK: number;
  // diode / junction
  vd: number;
  // ADC
  adcBits: number;
  adcFsMsps: number;
  signalMHz: number;
  // modulation
  modulation: Modulation;
  ebN0Db: number;
  // array
  arrayN: number;
  spacingLambda: number;
  steerDeg: number;
  steerAzDeg: number;
  weighting: Weighting;
  powerMode: ArrayPowerMode;
  paOutW: number;
  totalRfW: number;
  // link (the user terminal sits at the beam centre: elevation follows from steering + altitude)
  altitudeKm: number;
  freqGHz: number;
  rxGainDbi: number;
}

export interface AppState {
  level: LevelId;
  transitioning: boolean;
  mode: EngMode;
  explode: number;
  cutaway: boolean;
  quality: Quality;
  selected: string | null;
  theoryTab: TheoryTab;
  labels: boolean;
  /** screenshot-first presentation: app chrome hidden, poster overlay shown */
  presentation: boolean;
  /** link-budget X-ray: hardware/propagation element to emphasise in 3D (null = none) */
  emphasis: string | null;
  params: Params;
}

export const DEFAULT_PARAMS: Params = {
  vgs: 1.6,
  vds: 1.2,
  wOverL: 10,
  tempK: 300,
  vd: 0.3,
  adcBits: 8,
  adcFsMsps: 1000,
  signalMHz: 180,
  modulation: 'QPSK',
  ebN0Db: 8,
  arrayN: 16,
  spacingLambda: 0.5,
  steerDeg: 20,
  steerAzDeg: 0,
  weighting: 'uniform',
  powerMode: 'per-element-fixed',
  paOutW: 1,
  totalRfW: 256,
  altitudeKm: 550,
  freqGHz: 19.7,
  rxGainDbi: 36,
};

type NumericParam = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];

/**
 * Single source of truth for the scientific parameter domains. Sliders read
 * their ranges from here and the store clamps every write, so models never see
 * NaN, Infinity or out-of-domain values (e.g. arrayN = 0, elevation > 90°).
 * Model functions keep their own physics; this only bounds the UI inputs.
 */
export const PARAM_LIMITS: Record<NumericParam, { min: number; max: number; step: number; integer?: boolean }> = {
  vgs: { min: 0, max: 3, step: 0.02 },
  vds: { min: 0, max: 3, step: 0.02 },
  wOverL: { min: 1, max: 50, step: 1, integer: true },
  tempK: { min: 200, max: 600, step: 5 },
  vd: { min: -2, max: 0.8, step: 0.01 },
  adcBits: { min: 4, max: 12, step: 2, integer: true },
  adcFsMsps: { min: 100, max: 2000, step: 10 },
  signalMHz: { min: 10, max: 1500, step: 5 },
  ebN0Db: { min: -2, max: 24, step: 0.5 },
  arrayN: { min: 4, max: 32, step: 1, integer: true },
  spacingLambda: { min: 0.25, max: 1.2, step: 0.01 },
  steerDeg: { min: -60, max: 60, step: 1 },
  steerAzDeg: { min: 0, max: 180, step: 5 },
  paOutW: { min: 0.1, max: 4, step: 0.05 },
  totalRfW: { min: 16, max: 2048, step: 8 },
  altitudeKm: { min: 340, max: 1200, step: 10 },
  freqGHz: { min: 10.7, max: 30, step: 0.1 },
  rxGainDbi: { min: 28, max: 45, step: 0.5 },
};

const MODULATIONS = new Set(['BPSK', 'QPSK', '16QAM', '64QAM']);
const WEIGHTINGS = new Set(['uniform', 'hann', 'hamming', 'cosine']);
const POWER_MODES = new Set(['per-element-fixed', 'total-rf-fixed']);

/** Clamp/reject a parameter patch. Unknown or invalid values are dropped, numbers are clamped. */
export function sanitizeParams(patch: Partial<Params>): Partial<Params> {
  const out: Partial<Params> = {};
  for (const [k, v] of Object.entries(patch) as [keyof Params, unknown][]) {
    if (k === 'modulation') {
      if (typeof v === 'string' && MODULATIONS.has(v)) out.modulation = v as Params['modulation'];
      continue;
    }
    if (k === 'powerMode') {
      if (typeof v === 'string' && POWER_MODES.has(v)) out.powerMode = v as Params['powerMode'];
      continue;
    }
    if (k === 'weighting') {
      if (typeof v === 'string' && WEIGHTINGS.has(v)) out.weighting = v as Params['weighting'];
      continue;
    }
    const lim = PARAM_LIMITS[k as NumericParam];
    if (!lim || typeof v !== 'number' || !Number.isFinite(v)) continue;
    let x = Math.min(lim.max, Math.max(lim.min, v));
    if (lim.integer) x = Math.round(x);
    (out as Record<string, number>)[k] = x;
  }
  return out;
}

type Listener = (s: AppState, changed: Set<string>) => void;

/** Tiny observable store. `changed` holds top-level keys and `params.<key>` paths. */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<Omit<AppState, 'params'>>): void {
    const changed = new Set<string>();
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (this.state[k] !== patch[k]) changed.add(k);
    }
    if (!changed.size) return;
    this.state = { ...this.state, ...patch };
    this.emit(changed);
  }

  setParams(input: Partial<Params>): void {
    const patch = sanitizeParams(input);
    const changed = new Set<string>();
    for (const k of Object.keys(patch) as (keyof Params)[]) {
      if (this.state.params[k] !== patch[k]) changed.add(`params.${k}`);
    }
    if (!changed.size) return;
    changed.add('params');
    this.state = { ...this.state, params: { ...this.state.params, ...patch } };
    this.emit(changed);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: Set<string>): void {
    for (const l of this.listeners) l(this.state, changed);
  }
}

export function createStore(): Store {
  return new Store({
    level: 'cosmos',
    transitioning: false,
    mode: 'structure',
    explode: 0,
    cutaway: false,
    quality: 'auto',
    selected: null,
    theoryTab: 'intuition',
    labels: true,
    presentation: false,
    emphasis: null,
    params: { ...DEFAULT_PARAMS },
  });
}
