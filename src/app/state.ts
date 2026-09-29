import type { Modulation } from '../models/modulation';
import type { Weighting } from '../models/array-factor';
import type { LevelId } from './navigation';

export type EngMode = 'structure' | 'signal' | 'power' | 'thermal' | 'radiation';
export type Quality = 'high' | 'balanced' | 'performance';
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
  paOutW: number;
  // link
  altitudeKm: number;
  elevationDeg: number;
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
  paOutW: 1,
  altitudeKm: 550,
  elevationDeg: 40,
  freqGHz: 19.7,
  rxGainDbi: 36,
};

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

  setParams(patch: Partial<Params>): void {
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
    quality: 'balanced',
    selected: null,
    theoryTab: 'intuition',
    labels: true,
    params: { ...DEFAULT_PARAMS },
  });
}
