/**
 * Graphics quality tiers, device-class detection, the adaptive degradation
 * ladder and the hysteresis controller. Pure logic (no DOM / Three.js) so the
 * policy is unit-tested; main.ts applies the resulting GraphicsConfig.
 */
export type GraphicsQuality = 'high' | 'balanced' | 'performance';
export type QualityMode = 'auto' | GraphicsQuality;

export interface GraphicsConfig {
  maxDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  /** reserved: no SSAO pass is implemented (cost > benefit for this art style) */
  ssao: boolean;
  /** multiplier on decorative particle counts (flows, radiation tracks, stars) */
  particles: number;
  environmentResolution: number;
  /** 0 = full, 1 = reduced scatter detail, 2 = coarse repeated micro-geometry */
  modelLod: number;
  /** MSAA on the post-processing target (canvas AA is fixed at start-up) */
  antialias: boolean;
  /** vignette/grain, flicker/pulse and other purely decorative motion */
  cinematicEffects: boolean;
  /** fraction of callouts shown (selected + essential ones always win) */
  labelDensity: number;
}

export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsConfig> = {
  high: { maxDpr: 2, shadows: true, shadowMapSize: 2048, bloom: true, ssao: false, particles: 1, environmentResolution: 256, modelLod: 0, antialias: true, cinematicEffects: true, labelDensity: 1 },
  balanced: { maxDpr: 1.5, shadows: true, shadowMapSize: 1024, bloom: true, ssao: false, particles: 0.6, environmentResolution: 128, modelLod: 1, antialias: true, cinematicEffects: true, labelDensity: 0.8 },
  performance: { maxDpr: 1, shadows: false, shadowMapSize: 512, bloom: false, ssao: false, particles: 0.3, environmentResolution: 64, modelLod: 2, antialias: false, cinematicEffects: false, labelDensity: 0.5 },
};

export const TIER_ORDER: GraphicsQuality[] = ['performance', 'balanced', 'high'];

export interface DeviceSignals {
  width: number;
  dpr: number;
  cores?: number;
  memoryGb?: number;
  coarsePointer: boolean;
}

export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    width: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  };
}

/** Initial estimate only — runtime frame performance can lower it later. Never UA-sniffing. */
export function detectInitialQuality(s: DeviceSignals): GraphicsQuality {
  const cores = s.cores ?? 4;
  if (s.width <= 768 || s.coarsePointer || cores <= 4 || (s.memoryGb !== undefined && s.memoryGb <= 4)) return 'performance';
  if (s.width <= 1280 || s.dpr > 2 || cores <= 8) return 'balanced';
  return 'high';
}

/** Highest tier auto mode may climb to on this device class. */
export function tierCeiling(s: DeviceSignals): GraphicsQuality {
  return s.coarsePointer || s.width <= 768 ? 'balanced' : 'high';
}

/** DPR is the primary cost control: never render at raw device DPR (3× DPR ≈ 9× pixels). */
export function getRenderDpr(cfg: GraphicsConfig, deviceDpr: number): number {
  return Math.min(deviceDpr || 1, cfg.maxDpr);
}

/**
 * Adaptive degradation order — decoration goes first, meaning last.
 * Step n applies the first n entries cumulatively.
 */
export const DEGRADATION_ORDER: { id: string; apply: (c: GraphicsConfig) => void }[] = [
  { id: 'particles', apply: (c) => (c.particles *= 0.6) },
  { id: 'labels', apply: (c) => (c.labelDensity *= 0.75) },
  { id: 'bloom', apply: (c) => (c.bloom = false) },
  { id: 'ssao', apply: (c) => (c.ssao = false) },
  { id: 'shadow-resolution', apply: (c) => (c.shadowMapSize = Math.max(512, c.shadowMapSize / 2)) },
  { id: 'shadows-off', apply: (c) => (c.shadows = false) },
  { id: 'dpr', apply: (c) => (c.maxDpr = Math.max(0.75, c.maxDpr * 0.75)) },
  { id: 'environment', apply: (c) => (c.environmentResolution = Math.max(32, c.environmentResolution / 2)) },
  { id: 'lod', apply: (c) => (c.modelLod = Math.min(2, c.modelLod + 1)) },
  { id: 'decorative-animation', apply: (c) => (c.cinematicEffects = false) },
];

export const MAX_STEP = DEGRADATION_ORDER.length;

export function applyDegradation(base: GraphicsConfig, step: number): GraphicsConfig {
  const c = { ...base };
  for (let i = 0; i < Math.min(step, MAX_STEP); i++) DEGRADATION_ORDER[i].apply(c);
  return c;
}

export interface ControllerOptions {
  /** average FPS below this for `downSec` → degrade one step */
  downFps: number;
  downSec: number;
  /** average FPS above this for `upSec` → restore one step */
  upFps: number;
  upSec: number;
  /** ignore frames right after a change (shader compiles, resize) */
  settleSec: number;
}

export const DESKTOP_POLICY: ControllerOptions = { downFps: 45, downSec: 4, upFps: 57, upSec: 15, settleSec: 2 };
export const MOBILE_POLICY: ControllerOptions = { downFps: 28, downSec: 4, upFps: 55, upSec: 15, settleSec: 2 };

export type QualityAction = { kind: 'down' | 'up'; tier: GraphicsQuality; step: number; avgFps: number } | null;

/**
 * Hysteresis controller. Auto mode moves (tier, step) one notch at a time based
 * on sustained averages, never on single spikes. Manual mode never changes the
 * configuration; it only raises `suggestLower` so the UI can offer help.
 */
export class QualityController {
  mode: QualityMode;
  tier: GraphicsQuality;
  step = 0;
  suggestLower = false;
  private samples: { t: number; dt: number }[] = [];
  private since = 0;

  constructor(mode: QualityMode, detected: GraphicsQuality, private ceiling: GraphicsQuality, private opts: ControllerOptions) {
    this.mode = mode;
    this.tier = mode === 'auto' ? detected : mode;
  }

  config(): GraphicsConfig {
    return applyDegradation(GRAPHICS_PRESETS[this.tier], this.mode === 'auto' ? this.step : 0);
  }

  setMode(mode: QualityMode, detected: GraphicsQuality, now: number): void {
    this.mode = mode;
    this.tier = mode === 'auto' ? detected : mode;
    this.step = 0;
    this.suggestLower = false;
    this.reset(now);
  }

  /** Drop the window (transitions, hidden tab, resize) so hitches are not counted as sustained load. */
  reset(now: number): void {
    this.samples = [];
    this.since = now;
  }

  private avgFps(now: number, windowSec: number): number | null {
    const from = now - windowSec;
    if (this.since > from) return null; // window not yet fully observed
    let time = 0;
    let frames = 0;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].t >= from; i--) {
      time += this.samples[i].dt;
      frames++;
    }
    return time > 0 ? frames / time : null;
  }

  /** Feed one frame. `now` and `dt` in seconds. */
  feed(dt: number, now: number): QualityAction {
    if (now - this.since < this.opts.settleSec) return null;
    this.samples.push({ t: now, dt });
    const horizon = now - Math.max(this.opts.downSec, this.opts.upSec) - 1;
    while (this.samples.length && this.samples[0].t < horizon) this.samples.shift();
    const down = this.avgFps(now, this.opts.downSec);
    if (down !== null && down < this.opts.downFps) {
      if (this.mode !== 'auto') {
        this.suggestLower = this.tier !== 'performance' && down < this.opts.downFps * 0.75;
        return null;
      }
      if (this.step < MAX_STEP) this.step++;
      else return null;
      this.reset(now);
      return { kind: 'down', tier: this.tier, step: this.step, avgFps: down };
    }
    const up = this.avgFps(now, this.opts.upSec);
    if (this.mode === 'auto' && up !== null && up > this.opts.upFps) {
      const ti = TIER_ORDER.indexOf(this.tier);
      if (this.step > 0) this.step--;
      else if (ti < TIER_ORDER.indexOf(this.ceiling)) this.tier = TIER_ORDER[ti + 1];
      else return null;
      this.reset(now);
      return { kind: 'up', tier: this.tier, step: this.step, avgFps: up };
    }
    return null;
  }
}
