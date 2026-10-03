import type { LevelId } from '../app/navigation';
import type { ScaleManager } from '../app/scale-manager';
import type { Store } from '../app/state';
import { beamSolution } from '../app/system';
import { BEAM_PRESETS, GRATING_SPACING, POSTER_STATE } from '../app/beam-presets';
import { restorePatch, snapshotDemoState, type DemoSnapshot } from '../app/demo-state';
import type { CameraRig } from '../graphics/camera';
import { easeInOutSine } from '../graphics/camera';
import type { CausalStage, Hud } from './hud';
import type { Poster } from './poster';
import { bandName, km, km2 } from './beam-controls';
import { h } from './dom';

/**
 * - quick:       ~15 s signature demo (presentation mode) ending in the interactive poster
 * - engineering: the full ~25 s sequence through every representation
 * - grating:     ~10 s "why 0.5λ matters" experiment
 */
export type DemoMode = 'quick' | 'engineering' | 'grating';

export type DemoStage =
  | 'satellite' | 'array-focus' | 'beam-lab' | 'phase' | 'wavefront' | 'pattern' | 'footprint' | 'earth-footprint' | 'link'
  | 'q-satellite' | 'q-phase' | 'q-beam' | 'q-footprint' | 'q-poster'
  | 'g-main' | 'g-spacing' | 'g-earth';

const CAUSAL_OF: Partial<Record<DemoStage, CausalStage>> = {
  phase: 'phase', wavefront: 'phase', pattern: 'beam', footprint: 'footprint', 'earth-footprint': 'footprint', link: 'link',
  'q-phase': 'phase', 'q-beam': 'beam', 'q-footprint': 'footprint', 'q-poster': 'link',
  'g-main': 'beam', 'g-spacing': 'beam', 'g-earth': 'footprint',
};
/** test hook: ?demoHold=N lengthens reading holds (slow software renderers need time to capture) */
const HOLD_SCALE = Math.max(1, Math.min(10, Number(new URLSearchParams(location.search).get('demoHold')) || 1));
const NEAR_SATELLITE = new Set<LevelId>(['satellite', 'array', 'cosmos', 'payload']);

/**
 * One skippable, real-time demo controller. It drives the real app — ScaleManager flights
 * with renormalisation, store parameters, the shared BeamSolution — and every caption
 * number is read from that solution when shown. Nothing is pre-rendered.
 */
export class HeroDemo {
  private el: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cancelled = false;
  private snapshot: DemoSnapshot | null = null;
  private previousPosterView: Poster['view'] = 'hidden';
  private releaseLevels: (() => void) | null = null;
  running = false;
  mode: DemoMode | null = null;
  stage: DemoStage | null = null;
  /** designed duration of the last run (flights + parameter animations + holds), seconds */
  plannedSeconds = 0;
  /** wall-clock duration of the last completed run, seconds */
  lastWallSeconds = 0;
  preparationSeconds = 0;

  constructor(private mgr: ScaleManager, private rig: CameraRig, private store: Store, private hud: Hud, private poster: Poster, private motion: number, private onFinish: (mode: DemoMode) => void) {
    this.el = h('div', 'hero-demo');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Beam demo');
    this.el.innerHTML = `<div class="hd-text" aria-live="polite"><div class="hd-kicker"></div><div class="hd-title"></div><div class="hd-sub"></div></div><button class="hd-skip" type="button" aria-keyshortcuts="Escape">Skip ›</button>`;
    this.kicker = this.el.querySelector('.hd-kicker')!;
    this.title = this.el.querySelector('.hd-title')!;
    this.sub = this.el.querySelector('.hd-sub')!;
    this.el.querySelector('.hd-skip')!.addEventListener('click', () => void this.skip());
    hud.mountDemo(this.el);
  }

  private say(kicker: string, title: string, sub = ''): void {
    this.kicker.textContent = kicker;
    this.title.innerHTML = title;
    this.sub.innerHTML = sub;
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
  }

  private enter(stage: DemoStage): void {
    this.stage = stage;
    document.body.dataset.demoStage = stage;
    delete document.body.dataset.demoReady;
    this.hud.setCausal(CAUSAL_OF[stage] ?? null, true);
  }

  /** Reading time is kept under reduced motion; only camera/parameter motion is shortened.
   *  Marks the stage as composed (data-demo-ready) so tests capture the settled frame. */
  private async hold(ms: number): Promise<void> {
    this.plannedSeconds += ms / 1000;
    if (this.stage) document.body.dataset.demoReady = this.stage;
    const end = performance.now() + ms * HOLD_SCALE;
    while (!this.cancelled && performance.now() < end) await new Promise((r) => setTimeout(r, 40));
  }

  private async frame(stage: string, seconds: number): Promise<void> {
    const v = this.mgr.current?.demoView(stage);
    if (!v || this.cancelled) return;
    const d = Math.max(0.05, seconds * this.motion);
    this.plannedSeconds += d;
    // close-ups (e.g. a 100 km footprint seen from COSMOS) need the orbit clamp relaxed for this view
    const c = this.rig.controls;
    c.minDistance = Math.min(c.minDistance, v.pos.distanceTo(v.target) * 0.6);
    c.maxDistance = Math.max(c.maxDistance, v.pos.distanceTo(v.target) * 1.5);
    await this.rig.flyTo(v, d, easeInOutSine);
  }

  /** Animate a parameter through the real store (one write per frame); instant under reduced motion. */
  private tween(ms: number, apply: (t: number) => void): Promise<void> {
    if (this.motion < 1) {
      apply(1);
      return Promise.resolve();
    }
    this.plannedSeconds += ms / 1000;
    const t0 = performance.now();
    return new Promise((res) => {
      const step = () => {
        if (this.cancelled) return res();
        const t = Math.min(1, (performance.now() - t0) / ms);
        apply(easeInOutSine(t));
        if (t < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }

  private async go(level: LevelId, stepDuration?: number): Promise<boolean> {
    if (this.cancelled) return false;
    const steps = level === this.mgr.current?.id ? 0 : level === 'cosmos' && this.mgr.current?.id === 'array' ? 2 : 1;
    this.plannedSeconds += steps * (stepDuration ?? 2.8) * this.motion;
    const ok = await this.mgr.goTo(level, stepDuration);
    return ok && !this.cancelled && this.mgr.current?.id === level;
  }

  private pauseOrbit(v: boolean): void {
    for (const l of this.mgr.levelsBuilt()) if (l.id === 'cosmos') (l as unknown as { orbitPaused: boolean }).orbitPaused = v;
  }

  /** Start at the satellite: animated when close in the tree, a cut otherwise. */
  private async toSatellite(step = 1.2): Promise<boolean> {
    if (this.mgr.current?.id === 'satellite') return true;
    if (!NEAR_SATELLITE.has(this.store.get().level)) {
      await this.mgr.jumpTo('satellite');
      return !this.cancelled;
    }
    return this.go('satellite', step);
  }

  async play(mode: DemoMode = 'engineering'): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.mode = mode;
    this.plannedSeconds = 0;
    this.snapshot = snapshotDemoState(this.store.get());
    this.previousPosterView = this.poster.view;
    this.releaseLevels = this.mgr.retainLevels(['satellite', 'array', 'cosmos']);
    this.el.classList.add('on');
    document.body.classList.add('demo-running');
    document.body.dataset.demoMode = mode;
    const t0 = performance.now();
    let completed = false;
    try {
      completed = await (mode === 'quick' ? this.quick() : mode === 'grating' ? this.grating() : this.engineering());
      completed = completed && !this.cancelled;
    } finally {
      if (completed) this.lastWallSeconds = (performance.now() - t0) / 1000;
      this.finish(completed);
    }
  }

  // ------------------------------------------------------------------ quick (~15 s)
  private async quick(): Promise<boolean> {
    const s = this.store;
    s.set({ presentation: true, mode: 'signal', labels: true, explode: 0, selected: null, emphasis: null });
    this.poster.setView('demo');
    this.say('GETTING READY', 'Preparing the live beam demo', 'The panel stays fixed; element phase steers the beam.');
    const prepStart = performance.now();
    await this.mgr.preload(['satellite', 'array', 'cosmos']);
    this.preparationSeconds = (performance.now() - prepStart) / 1000;
    this.enter('q-satellite');
    if (!(await this.toSatellite())) return false;
    s.setParams({ ...POSTER_STATE, steerDeg: 0 });
    this.say('SATELLITE', 'An Earth-facing phased array', 'The antenna panel looks straight down at the Earth — and never moves.');
    await this.frame('earth-facing', 1.1);
    await this.hold(700);

    if (this.cancelled) return false;
    this.enter('q-phase');
    const target = POSTER_STATE.steerDeg!;
    this.say('ELEMENT PHASE', 'Element phase&nbsp;&nbsp;→&nbsp;&nbsp;beam direction', 'θ₀ = 0°');
    await Promise.all([
      this.frame('array-focus', 1.3),
      this.tween(2200, (t) => {
        const steer = Math.round(target * t);
        s.setParams({ steerDeg: steer });
        const b = beamSolution(s.get().params);
        this.sub.textContent = `θ₀ = ${steer}° · β = ${((b.pattern.phaseStepX * 180) / Math.PI).toFixed(0)}° per element`;
      }),
    ]);
    // These motions overlap: use their critical path, not the sum.
    if (this.motion >= 1) this.plannedSeconds -= 1.3 * this.motion;
    await this.hold(300);

    if (this.cancelled) return false;
    this.enter('q-beam');
    const b = beamSolution(s.get().params);
    this.say('BEAM', 'Phase changes steer the beam; the panel stays fixed', `Gain ${b.pattern.gainDbi.toFixed(1)} dBi · width ${b.pattern.hpbwDeg.toFixed(1)}° · array-local close-up`);
    if (!(await this.go('array', 1.5))) return false;
    await this.frame('pattern', 0.6);
    await this.hold(700);

    if (this.cancelled) return false;
    this.enter('q-footprint');
    const f = b.footprint;
    this.say('FOOTPRINT', 'The −3 dB contour lands on the spherical Earth', f.center ? `${km(f.alongTrackKm)} × ${km(f.crossTrackKm)} km · ${km(f.nadirOffsetKm ?? 0)} km from nadir` : 'Beam centre above the horizon');
    if (!(await this.go('cosmos', 1.0))) return false;
    this.pauseOrbit(true);
    (this.mgr.current as unknown as { resetOrbit: () => void }).resetOrbit();
    await this.frame('poster', 1.0);
    await this.hold(300);

    if (this.cancelled) return false;
    this.enter('q-poster');
    const link = beamSolution(s.get().params).link;
    this.say('LINK', link && link.marginDb >= 0 ? 'The ground terminal has a positive link margin' : 'The link needs more margin', link ? `${link.marginDb.toFixed(1)} dB above the model’s required signal quality · try steering below` : 'The beam does not reach the Earth');
    this.poster.setView('poster');
    await this.hold(3000);
    this.el.classList.remove('on', 'show');
    await this.hold(600);
    return true;
  }

  // ------------------------------------------------------------------ grating (~10 s)
  private async grating(): Promise<boolean> {
    const s = this.store;
    s.set({ mode: 'signal', explode: 0, selected: null, emphasis: null });
    await this.mgr.preload(['array', 'cosmos']);
    this.enter('g-main');
    if (this.mgr.current?.id !== 'array') {
      if (!NEAR_SATELLITE.has(this.store.get().level)) await this.mgr.jumpTo('satellite');
      if (!(await this.go('array', 1.4))) return false;
    }
    s.setParams(BEAM_PRESETS.find((p) => p.id === 'steered')!.params);
    const lim = beamSolution(s.get().params).pattern.gratingLimit;
    this.say('WHY 0.5λ MATTERS', `d/λ = 0.50&nbsp;&nbsp;·&nbsp;&nbsp;limit ${lim.toFixed(2)}`, 'One main beam: the power goes where it is steered.');
    await this.frame('pattern', 1.0);
    await this.hold(1200);

    if (this.cancelled) return false;
    this.enter('g-spacing');
    await this.tween(3200, (t) => {
      const d = Math.round((0.5 + (GRATING_SPACING - 0.5) * t) * 100) / 100;
      s.setParams({ spacingLambda: d });
      const b = beamSolution(s.get().params);
      const L = b.lobes[0];
      this.kicker.textContent = b.lobes.length ? 'GRATING LOBE' : 'ELEMENT SPACING ↑';
      this.title.innerHTML = `d/λ = ${d.toFixed(2)}&nbsp;&nbsp;·&nbsp;&nbsp;limit ${b.pattern.gratingLimit.toFixed(2)}`;
      this.sub.textContent = L ? `A second beam appears at ${L.levelDb.toFixed(1)} dB relative to the main beam` : 'Approaching the grating-lobe threshold';
    });
    await this.hold(900);

    if (this.cancelled) return false;
    this.enter('g-earth');
    const b = beamSolution(s.get().params);
    const sec = b.secondary[0];
    this.say('UNINTENDED ILLUMINATION', sec ? 'The grating lobe lights a second area on Earth' : 'The grating lobe misses the Earth here', sec ? `MAIN BEAM — primary service area (solid) · GRATING LOBE — unintended illumination (dashed), ${km(sec.earth.nadirOffsetKm ?? 0)} km from nadir` : 'No secondary footprint is drawn when the lobe does not reach the ground.');
    if (!(await this.go('cosmos', 1.0))) return false;
    this.pauseOrbit(true);
    await this.frame('earth-footprint', 1.2);
    await this.hold(2200);
    return true;
  }

  // ------------------------------------------------------------------ engineering (~25 s)
  private async engineering(): Promise<boolean> {
    const s = this.store;
    this.enter('satellite');
    if (!(await this.toSatellite(2.8))) return false;
    s.set({ mode: 'signal', explode: 0, selected: null, emphasis: null });
    s.setParams(BEAM_PRESETS.find((p) => p.id === 'nadir')!.params);
    const p = s.get().params;
    this.say('PHASED-ARRAY DOWNLINK', `${bandName(p.freqGHz)} · ${p.arrayN}×${p.arrayN} · d = ${p.spacingLambda.toFixed(2)}λ`, 'One calculated array state drives everything that follows.');
    await this.frame('satellite', 1.2);
    await this.hold(1200);

    if (this.cancelled) return false;
    this.enter('array-focus');
    this.say('PHASED ARRAY', 'Element phase controls beam direction.', 'Each patch has its own phase shifter. Colour = calculated phase.');
    await this.frame('array-focus', 1.4);
    await this.hold(600);

    this.enter('beam-lab');
    this.say('BEAM LAB', 'Inside the sub-array', `${p.arrayN}×${p.arrayN} elements · ${p.freqGHz.toFixed(1)} GHz`);
    if (!(await this.go('array', 2.4))) return false;
    await this.hold(300);

    this.enter('phase');
    const target = BEAM_PRESETS.find((q) => q.id === 'steered')!.params.steerDeg!;
    this.say('PHASE', 'Progressive phase βx = −k·d·sin θ₀', 'Steering 0° → 25°: watch the colour gradient across the elements.');
    await this.frame('phase', 1.0);
    await this.tween(2000, (t) => s.setParams({ steerDeg: Math.round(target * t) }));
    const b1 = beamSolution(s.get().params);
    this.sub.innerHTML = `θ₀ = ${s.get().params.steerDeg}° → <b>${((b1.pattern.phaseStepX * 180) / Math.PI).toFixed(1)}° per element</b>`;
    await this.hold(500);

    if (this.cancelled) return false;
    this.enter('wavefront');
    this.say('WAVEFRONT', 'Phase gradient → tilted wavefront → beam steering', 'Fronts are λ apart and perpendicular to the beam axis.');
    await this.frame('wavefront', 1.0);
    await this.hold(1200);

    if (this.cancelled) return false;
    this.enter('pattern');
    const b2 = beamSolution(s.get().params);
    this.say('RADIATION PATTERN', `D ${b2.pattern.directivityDbi.toFixed(1)} dBi · G ${b2.pattern.gainDbi.toFixed(1)} dBi · HPBW ${b2.pattern.hpbwDeg.toFixed(1)}°`, `Sidelobe ${b2.pattern.sidelobeDb.toFixed(1)} dB · steering ${b2.input.steerThetaDeg}° · white ring = −3 dB`);
    await this.frame('pattern', 1.0);
    await this.hold(1600);

    if (this.cancelled) return false;
    this.enter('footprint');
    this.say('FOOTPRINT', 'Edge rays through the −3 dB ring land on the ground', `Flat-ground projection · distance compressed for display · ${km(b2.flat.alongKm)} × ${km(b2.flat.acrossKm)} km`);
    await this.frame('footprint', 1.0);
    await this.hold(1200);

    if (this.cancelled) return false;
    this.enter('earth-footprint');
    this.say('EARTH FOOTPRINT', 'Same contour, intersected with the spherical Earth', 'Array → spacecraft → Earth frame, one ray per contour direction.');
    if (!(await this.go('cosmos', 1.3))) return false;
    this.pauseOrbit(true);
    const f = b2.footprint;
    this.sub.innerHTML = f.center ? `Along-track ${km(f.alongTrackKm)} km · cross-track ${km(f.crossTrackKm)} km · area ${km2(f.areaKm2)} km² · ${km(f.nadirOffsetKm ?? 0)} km from nadir` : 'Beam centre above the horizon';
    await this.frame('earth-footprint', 1.2);
    await this.hold(800);

    if (this.cancelled) return false;
    this.enter('link');
    const L = b2.link;
    this.say('LINK', L ? `Gain ${b2.pattern.gainDbi.toFixed(1)} dBi · EIRP ${b2.power.eirpDbw.toFixed(1)} dBW` : 'No link', L ? `User at the beam centre (El ${L.elevationDeg.toFixed(0)}°) · Rx ${L.rxPowerDbm.toFixed(1)} dBm · margin <b>${L.marginDb >= 0 ? '+' : ''}${L.marginDb.toFixed(1)} dB</b>` : '');
    await this.frame('link', 1.0);
    await this.hold(2000);
    return true;
  }

  /**
   * Stop at once. Skipping returns the parameters, mode and presentation state the user
   * had before the demo (navigation stays where it is — the user is never trapped).
   */
  async skip(): Promise<void> {
    if (!this.running) return;
    this.cancelled = true;
    this.mgr.stop();
    this.rig.finishFlight();
    while (this.running) await new Promise((r) => setTimeout(r, 30));
  }

  private finish(completed: boolean): void {
    this.pauseOrbit(completed && this.mode === 'quick');
    const mode = this.mode!;
    this.running = false;
    this.stage = null;
    delete document.body.dataset.demoStage;
    delete document.body.dataset.demoReady;
    delete document.body.dataset.demoMode;
    this.el.classList.remove('on', 'show');
    document.body.classList.remove('demo-running');
    this.hud.setCausal(null, false);
    if (!completed && this.snapshot) {
      const r = restorePatch(this.snapshot);
      this.store.set(r.state);
      this.store.setParams(r.params);
      this.poster.setView(this.previousPosterView);
    }
    this.releaseLevels?.();
    this.releaseLevels = null;
    this.snapshot = null;
    if (completed) this.onFinish(mode);
  }
}
