import { describe, expect, it } from 'vitest';
import css from '../src/styles/main.css?raw';
import { COMPACT_GPU_MAX, DEGRADATION_ORDER, GRAPHICS_PRESETS, MOBILE_LAYOUT_MAX, MOBILE_LAYOUT_QUERY, MOBILE_POLICY, DESKTOP_POLICY, QualityController, applyDegradation, detectInitialQuality, effectiveSteps, getRenderDpr, isGpuConstrained, maxStep, policyFor, tierCeiling } from '../src/app/quality';
import { FrameStats } from '../src/graphics/perf';

const desktop = { width: 1920, dpr: 1, cores: 16, memoryGb: 16, coarsePointer: false };

describe('device detection (no UA sniffing)', () => {
  it('phones and small/low-memory devices start in performance', () => {
    expect(detectInitialQuality({ width: 390, dpr: 3, cores: 8, coarsePointer: true })).toBe('performance');
    expect(detectInitialQuality({ ...desktop, memoryGb: 4 })).toBe('performance');
    expect(detectInitialQuality({ ...desktop, cores: 4 })).toBe('performance');
  });
  it('mid laptops start balanced, strong desktops high', () => {
    expect(detectInitialQuality({ ...desktop, width: 1280 })).toBe('balanced');
    expect(detectInitialQuality({ ...desktop, cores: 8 })).toBe('balanced');
    expect(detectInitialQuality({ ...desktop, dpr: 2.5 })).toBe('balanced');
    expect(detectInitialQuality(desktop)).toBe('high');
  });
  it('touch devices cannot auto-climb to high', () => {
    expect(tierCeiling({ width: 1024, dpr: 2, coarsePointer: true })).toBe('balanced');
    expect(tierCeiling(desktop)).toBe('high');
  });
});

describe('DPR control', () => {
  it('never renders a DPR-3 phone at DPR 3', () => {
    expect(getRenderDpr(GRAPHICS_PRESETS.performance, 3)).toBe(1);
    expect(getRenderDpr(GRAPHICS_PRESETS.balanced, 3)).toBe(1.5);
    expect(getRenderDpr(GRAPHICS_PRESETS.high, 1)).toBe(1);
  });
});

describe('degradation ladder', () => {
  it('removes decoration in the specified order', () => {
    expect(DEGRADATION_ORDER.map((d) => d.id)).toEqual(['particles', 'labels', 'bloom', 'shadow-resolution', 'shadows-off', 'dpr', 'environment', 'lod', 'decorative-animation']);
  });
  it('is cumulative and monotone, and never mutates the preset', () => {
    const hi = GRAPHICS_PRESETS.high;
    const s1 = applyDegradation(hi, 1);
    expect(s1.particles).toBeLessThan(hi.particles);
    expect(s1.bloom).toBe(true);
    const s3 = applyDegradation(hi, 3);
    expect(s3.bloom).toBe(false);
    expect(s3.shadows).toBe(true);
    const s5 = applyDegradation(hi, 5);
    expect(s5.shadows).toBe(false);
    expect(s5.maxDpr).toBe(2);
    const all = applyDegradation(hi, maxStep(hi));
    expect(all.maxDpr).toBeLessThan(2);
    expect(all.modelLod).toBe(1);
    expect(all.cinematicEffects).toBe(false);
    expect(hi.bloom).toBe(true);
  });
});

function run(c: QualityController, fps: number, seconds: number, t0: number): { t: number; actions: string[] } {
  const dt = 1 / fps;
  const actions: string[] = [];
  let t = t0;
  for (let k = 0; k < seconds * fps; k++) {
    t += dt;
    const a = c.feed(dt, t);
    if (a) actions.push(`${a.kind}:${a.tier}:${a.step}`);
  }
  return { t, actions };
}

describe('hysteresis controller', () => {
  it('a single spike does not change quality', () => {
    const c = new QualityController('auto', 'high', 'high', DESKTOP_POLICY);
    let t = run(c, 60, 6, 0).t;
    expect(c.feed(0.5, (t += 0.5))).toBeNull();
    expect(run(c, 60, 3, t).actions).toEqual([]);
  });
  it('sustained slowness degrades one step at a time', () => {
    const c = new QualityController('auto', 'performance', 'balanced', MOBILE_POLICY);
    const r = run(c, 20, 20, 0);
    expect(r.actions[0]).toBe('down:performance:1');
    expect(r.actions.length).toBeGreaterThanOrEqual(2);
    expect(r.actions.length).toBeLessThanOrEqual(4); // settle + 4 s window per step
  });
  it('recovers only after a long fast window and climbs tiers up to the ceiling', () => {
    const c = new QualityController('auto', 'performance', 'balanced', MOBILE_POLICY);
    let r = run(c, 20, 7, 0);
    expect(c.step).toBe(1);
    r = run(c, 60, 10, r.t);
    expect(r.actions).toEqual([]); // < 15 s: no oscillation
    r = run(c, 60, 60, r.t);
    expect(r.actions).toContain('up:performance:0');
    expect(r.actions).toContain('up:balanced:0');
    expect(c.tier).toBe('balanced'); // capped by ceiling
  });
  it('manual mode never changes the configuration, only suggests', () => {
    const c = new QualityController('high', 'performance', 'high', DESKTOP_POLICY);
    const r = run(c, 12, 20, 0);
    expect(r.actions).toEqual([]);
    expect(c.tier).toBe('high');
    expect(c.suggestLower).toBe(true);
  });
  it('reset drops the window (transitions / hidden tab)', () => {
    const c = new QualityController('auto', 'high', 'high', DESKTOP_POLICY);
    let t = run(c, 20, 3, 0).t;
    c.reset(t);
    expect(run(c, 20, 3, t).actions).toEqual([]);
  });
});

describe('frame statistics', () => {
  it('computes averages, percentiles and long frames', () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 95; i++) s.push(16);
    for (let i = 0; i < 5; i++) s.push(80);
    const m = s.summary();
    expect(m.frames).toBe(100);
    expect(m.avgMs).toBeCloseTo(19.2, 6);
    expect(m.p99Ms).toBe(80);
    expect(s.longFrames).toBe(5);
    expect(m.over33).toBeCloseTo(0.05, 9);
  });
});

describe('feature-aware degradation (no no-op steps)', () => {
  it('every effective step changes the configuration', () => {
    for (const tier of ['high', 'balanced', 'performance'] as const) {
      const base = GRAPHICS_PRESETS[tier];
      for (let k = 1; k <= maxStep(base); k++) {
        expect(applyDegradation(base, k)).not.toEqual(applyDegradation(base, k - 1));
      }
    }
  });
  it('skips steps that are already off in the tier', () => {
    const perf = effectiveSteps(GRAPHICS_PRESETS.performance);
    expect(perf).not.toContain('bloom');
    expect(perf).not.toContain('shadows-off');
    expect(perf).not.toContain('decorative-animation');
    expect(effectiveSteps(GRAPHICS_PRESETS.high)).toContain('bloom');
    expect('ssao' in GRAPHICS_PRESETS.high).toBe(false);
  });
  it('controller never takes a no-op step and stops at the end of the ladder', () => {
    const c = new QualityController('auto', 'performance', 'balanced', MOBILE_POLICY);
    run(c, 10, 120, 0);
    expect(c.step).toBe(maxStep(GRAPHICS_PRESETS.performance));
  });
});

describe('layout breakpoint ≠ GPU policy', () => {
  it('constants are distinct concepts', () => {
    expect(MOBILE_LAYOUT_MAX).toBe(900);
    expect(COMPACT_GPU_MAX).toBe(768);
  });
  it('an 850 px desktop window gets the mobile layout but not the phone GPU policy', () => {
    const s = { width: 850, dpr: 1, cores: 12, memoryGb: 16, coarsePointer: false };
    expect(isGpuConstrained(s)).toBe(false);
    expect(policyFor(s)).toBe(DESKTOP_POLICY);
    expect(detectInitialQuality(s)).toBe('balanced');
  });
  it('a 4-core desktop gets the constrained GPU policy at full width', () => {
    const s = { width: 1920, dpr: 1, cores: 4, coarsePointer: false };
    expect(policyFor(s)).toBe(MOBILE_POLICY);
  });
  it('the CSS mobile media query is exactly MOBILE_LAYOUT_QUERY', () => {
    expect(css).toContain(`@media ${MOBILE_LAYOUT_QUERY} {`);
  });
});
