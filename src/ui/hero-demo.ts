import type { LevelId } from '../app/navigation';
import type { ScaleManager } from '../app/scale-manager';
import type { AppState, Params, Store } from '../app/state';
import { beamSolution } from '../app/system';
import { BEAM_PRESETS, GRATING_SPACING, POSTER_STATE } from '../app/beam-presets';
import { endAction, restorePatch, sameViewport, snapshotDemoState, snapshotScreen, type DemoSnapshot, type DemoTiming, type PresentationSnapshot, type StopReason } from '../app/demo-state';
import type { CameraRig, View } from '../graphics/camera';
import type { OrbitState } from '../scenes/base';
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
const ROUTE: LevelId[] = ['satellite', 'array', 'cosmos'];

/** Screens the demo hands back to; implemented by the app (they own the poster/landing composition). */
export interface DemoScreens {
  /** Cosmos poster over this state. No orbit → reference position; no camera → fitted poster frame. */
  poster(o: { state: Partial<AppState>; params: Partial<Params>; orbit?: OrbitState | null; camera?: View | null }): Promise<void>;
  /** Satellite landing over this state. No camera → the landing frame for the current viewport. */
  landing(o: { state: Partial<AppState>; params: Partial<Params>; camera?: View | null }): Promise<void>;
  /** Leave presentation where we are: poster hidden, chrome back, orbit running. */
  leavePresentation(): void;
  /** Recompute the safe viewport now (after overlays changed). */
  layout(): void;
}

const signedDb = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

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
  private snapshot: DemoSnapshot | null = null;
  private screen: PresentationSnapshot | null = null;
  private limits: { min: number; max: number } | null = null;
  private releaseLevels: (() => void) | null = null;
  /** session token: bumps on every play(), invalidating detached continuations of older runs */
  private token = 0;
  private stopReason: StopReason | null = null;
  private ending = false;
  private run: Promise<void> | null = null;
  private wake: () => void = () => {};
  private stopped: Promise<void> = Promise.resolve();
  private playStart = 0;
  running = false;
  mode: DemoMode | null = null;
  stage: DemoStage | null = null;
  /** designed duration of the last run (flights + parameter animations + holds), seconds */
  plannedSeconds = 0;
  /** wall-clock duration (play() entry → final screen) of the last completed run, seconds */
  lastWallSeconds = 0;
  preparationSeconds = 0;
  /** timing of the last run, whatever ended it */
  timing: DemoTiming | null = null;
  /** the last run's end reason (complete / skip / navigate / explore / error) */
  lastReason: StopReason | null = null;

  constructor(private mgr: ScaleManager, private rig: CameraRig, private store: Store, private hud: Hud, private poster: Poster, private screens: DemoScreens, private motion: number, private onFinish: (mode: DemoMode) => void) {
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

  private get cancelled(): boolean {
    return this.stopReason !== null;
  }

  private alive(token: number): boolean {
    return token === this.token && this.stopReason === null;
  }

  /** Resolve with the promise, or early (undefined) once the run is stopped. */
  private untilStopped<T>(p: Promise<T>): Promise<T | undefined> {
    return Promise.race([p, this.stopped.then(() => undefined)]);
  }

  private enter(stage: DemoStage): void {
    if (!this.playStart) this.playStart = performance.now();
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
    const token = this.token;
    while (this.alive(token) && performance.now() < end) await new Promise((r) => setTimeout(r, 40));
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
    const token = this.token;
    return new Promise((res) => {
      const step = () => {
        if (!this.alive(token)) return res();
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

  private setOrbit(o: Partial<OrbitState>): void {
    for (const l of this.mgr.levelsBuilt()) l.setOrbitState(o);
  }

  private pauseOrbit(v: boolean): void {
    this.setOrbit({ paused: v });
  }

  private orbitNow(): OrbitState | null {
    for (const l of this.mgr.levelsBuilt()) {
      const o = l.orbitState();
      if (o) return o;
    }
    return null;
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

  /**
   * Run one demo. Resolves only after the final screen is composed and cleanup is done
   * (so a following Replay/navigation always starts from a settled state). While a run
   * is active, further calls return that run's promise.
   */
  play(mode: DemoMode = 'engineering'): Promise<void> {
    if (this.run) return this.run;
    const token = ++this.token;
    this.run = this.execute(mode, token).finally(() => {
      if (this.token === token) this.run = null;
    });
    return this.run;
  }

  private async execute(mode: DemoMode, token: number): Promise<void> {
    const t0 = performance.now();
    this.running = true;
    this.stopReason = null;
    this.ending = false;
    this.stopped = new Promise<void>((r) => (this.wake = r));
    this.mode = mode;
    this.plannedSeconds = 0;
    this.playStart = 0;
    // Both snapshots are taken before the demo changes anything.
    const st = this.store.get();
    this.snapshot = snapshotDemoState(st);
    const settled = !this.mgr.isBusy && !this.rig.flying;
    this.screen = snapshotScreen(this.poster.view, settled ? this.mgr.currentId : null, settled ? this.rig.currentView() : null, { width: innerWidth, height: innerHeight }, this.orbitNow());
    this.limits = { min: this.rig.controls.minDistance, max: this.rig.controls.maxDistance };
    const built = new Set(this.mgr.levelsBuilt().map((l) => l.id));
    const cold = ROUTE.some((id) => !built.has(id));
    this.releaseLevels = this.mgr.retainLevels(ROUTE);
    this.el.classList.add('on');
    document.body.classList.add('demo-running');
    document.body.dataset.demoMode = mode;
    if (mode !== 'quick') {
      // Engineering / Grating are exploration demos: never inherit the poster or presentation.
      this.poster.setView('hidden');
      this.store.set({ presentation: false, mode: 'signal', labels: true, explode: 0, selected: null, emphasis: null });
    }
    let completed = false;
    let error: unknown = null;
    try {
      completed = await (mode === 'quick' ? this.quick() : mode === 'grating' ? this.grating() : this.engineering());
      completed = completed && !this.cancelled;
    } catch (e) {
      error = e;
      console.error(e);
    }
    const playEnd = performance.now();
    const reason: StopReason = completed ? 'complete' : error ? 'error' : this.stopReason ?? 'error';
    await this.finish(mode, reason, token);
    const end = performance.now();
    const prep = this.playStart ? this.playStart - t0 : playEnd - t0;
    this.timing = {
      mode,
      reason,
      preparationMs: prep,
      playbackMs: this.playStart ? playEnd - this.playStart : 0,
      finishMs: end - playEnd,
      totalMs: end - t0,
      plannedPlaybackMs: this.plannedSeconds * 1000,
      cold,
    };
    this.preparationSeconds = prep / 1000;
    if (reason === 'complete') this.lastWallSeconds = (end - t0) / 1000;
  }

  // ------------------------------------------------------------------ quick (~15 s)
  private async quick(): Promise<boolean> {
    const s = this.store;
    s.set({ presentation: true, mode: 'signal', labels: true, explode: 0, selected: null, emphasis: null });
    this.poster.setView('demo');
    this.say('GETTING READY', 'Preparing the live beam demo', 'The panel stays fixed; element phase steers the beam.');
    await this.untilStopped(this.mgr.preload(ROUTE));
    if (this.cancelled) return false;
    this.enter('q-satellite');
    if (!(await this.toSatellite())) return false;
    s.setParams({ ...POSTER_STATE, steerDeg: 0 });
    this.say('SATELLITE', 'An Earth-facing phased array', 'The antenna panel looks straight down at the Earth — and never moves.');
    await this.frame('earth-facing', 1.1);
    await this.hold(700);

    if (this.cancelled) return false;
    this.enter('q-phase');
    const target = POSTER_STATE.steerDeg!;
    this.say('ELEMENT PHASE', 'Element phase sets the beam direction.', 'θ₀ = 0°');
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
    this.say('BEAM', 'The panel stays fixed; the beam steers.', `Gain ${b.pattern.gainDbi.toFixed(1)} dBi · width ${b.pattern.hpbwDeg.toFixed(1)}° · array-local close-up`);
    if (!(await this.go('array', 1.5))) return false;
    await this.frame('pattern', 0.6);
    await this.hold(700);

    if (this.cancelled) return false;
    this.enter('q-footprint');
    const f = b.footprint;
    this.say('FOOTPRINT', 'The −3 dB outline is the beam’s half-power contour on Earth.', f.center ? `${km(f.alongTrackKm)} × ${km(f.crossTrackKm)} km · ${km(f.nadirOffsetKm ?? 0)} km from nadir` : 'Beam centre above the horizon');
    if (!(await this.go('cosmos', 1.0))) return false;
    this.mgr.current?.setOrbitState({ time: 0, paused: true });
    await this.frame('poster', 1.0);
    await this.hold(300);

    if (this.cancelled) return false;
    this.enter('q-poster');
    const link = beamSolution(s.get().params).link;
    if (link) this.say('LINK', `Link margin at the beam-centre terminal: ${signedDb(link.marginDb)} dB`, link.marginDb >= 0 ? 'Above the model’s required signal quality · try steering below' : 'Below the model’s required signal quality · try steering below');
    else this.say('LINK', 'No link: the beam centre misses the Earth', 'The model has no ground terminal for this steering.');
    this.poster.setView('poster');
    await this.hold(3000);
    if (this.cancelled) return false;
    // outro: caption away, the poster's own overlays (footprint inset) take their place;
    // settle on exactly the frame a direct ?view=poster load computes for this layout
    this.el.classList.remove('on', 'show');
    document.body.classList.remove('demo-running');
    this.screens.layout();
    await this.frame('poster', 0.6);
    return true;
  }

  // ------------------------------------------------------------------ grating (~10 s)
  private async grating(): Promise<boolean> {
    const s = this.store;
    this.say('WHY 0.5λ MATTERS', 'Element spacing and grating lobes', 'Opening the Beam Lab…');
    await this.untilStopped(this.mgr.preload(['array', 'cosmos']));
    if (this.cancelled) return false;
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
    this.say('PHASED-ARRAY DOWNLINK', 'From element phase to the ground', 'Flying to the satellite…');
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

  /** Skip: back to the screen the demo started from (see endAction()). */
  skip(): Promise<void> {
    return this.stop('skip');
  }

  /**
   * End the running demo for a reason and wait until its final screen is composed.
   * Repeated calls share the same run promise. An explicit navigate/explore replaces an
   * earlier skip that has not started restoring yet (the latest intent wins); once the
   * end is being composed, the caller's own follow-up (goTo / leave presentation) runs
   * after it and so still decides the final state.
   */
  stop(reason: Exclude<StopReason, 'complete' | 'error'> = 'skip'): Promise<void> {
    if (!this.run) return Promise.resolve();
    if (!this.ending && (this.stopReason === null || reason !== 'skip')) this.stopReason = reason;
    this.wake();
    // a scale step in flight still completes (renormalisation is never left half-done)
    this.mgr.stop();
    this.rig.finishFlight();
    return this.run;
  }

  private async finish(mode: DemoMode, reason: StopReason, token: number): Promise<void> {
    this.ending = true;
    this.lastReason = reason;
    this.stage = null;
    delete document.body.dataset.demoStage;
    delete document.body.dataset.demoReady;
    this.el.classList.remove('on', 'show');
    this.hud.setCausal(null, false);
    try {
      // never compose the end screen on top of a half-finished scale step
      while (this.mgr.isBusy) {
        this.mgr.stop();
        this.rig.finishFlight();
        await new Promise((r) => setTimeout(r, 30));
      }
      if (token === this.token) await this.compose(mode, reason);
    } catch (e) {
      console.error(e);
      this.recover(mode);
    } finally {
      // retention is released exactly once, after the end screen is in use
      this.releaseLevels?.();
      this.releaseLevels = null;
      this.snapshot = null;
      this.screen = null;
      this.limits = null;
      this.running = false;
      this.ending = false;
      delete document.body.dataset.demoMode;
      document.body.classList.remove('demo-running');
    }
    if (reason === 'complete') this.onFinish(mode);
    else if (reason === 'error') this.hud.toast('The demo stopped before it finished. The scene is ready to explore.', { label: 'Run again', run: () => void this.play(mode) });
  }

  private async compose(mode: DemoMode, reason: StopReason): Promise<void> {
    const snap = this.snapshot!;
    const scr = this.screen!;
    const act = endAction(mode, reason, scr.view);
    const r = restorePatch(snap);
    const same = sameViewport(scr.viewport, { width: innerWidth, height: innerHeight });
    switch (act.kind) {
      case 'poster':
        // Quick completed: the signature poster (state and orbit were set by the run; the user's
        // Try-it slider moves during the last reading hold are kept)
        this.pauseOrbit(true);
        if (this.poster.view !== 'poster') this.poster.setView('poster');
        return;
      case 'overview': {
        this.poster.setView('hidden');
        if (this.store.get().presentation) this.store.set({ presentation: false });
        const cur = this.mgr.current;
        if (cur?.id === 'cosmos') {
          // frame first, then let the orbit run: the overview is Earth-fixed, so motion never breaks it
          await this.rig.flyTo(cur.home, Math.max(0.05, 1.2 * this.motion), easeInOutSine);
          this.mgr.applyControlLimits(cur);
        }
        this.pauseOrbit(false);
        return;
      }
      case 'explore':
        this.screens.leavePresentation();
        return;
      case 'release':
        this.store.set({ ...r.state, presentation: false });
        this.store.setParams(r.params);
        this.poster.setView('hidden');
        this.pauseOrbit(false);
        return;
      case 'restore':
        if (act.screen === 'landing') {
          await this.screens.landing({ state: r.state, params: r.params, camera: same && scr.level === 'satellite' ? scr.camera : null });
          if (scr.orbit) this.setOrbit({ paused: scr.orbit.paused });
        } else if (act.screen === 'poster') {
          await this.screens.poster({ state: r.state, params: r.params, orbit: scr.orbit, camera: same && scr.level === 'cosmos' ? scr.camera : null });
        } else {
          // free exploration: stay in the current (settled) scene; never transplant another level's camera
          this.store.set(r.state);
          this.store.setParams(r.params);
          this.poster.setView(scr.view === 'demo' ? 'hidden' : scr.view);
          this.setOrbit({ paused: scr.orbit?.paused ?? false });
          if (scr.camera && scr.level === this.mgr.currentId) {
            this.rig.setView(scr.camera);
            if (this.limits) {
              this.rig.controls.minDistance = this.limits.min;
              this.rig.controls.maxDistance = this.limits.max;
            }
          }
        }
        return;
    }
  }

  /** Last resort after a failed restore: a usable, explorable scene with the starting parameters. */
  private recover(mode: DemoMode): void {
    void mode;
    try {
      if (this.snapshot) this.store.setParams(restorePatch(this.snapshot).params);
      this.screens.leavePresentation();
      this.rig.cancelFlight();
      this.mgr.applyControlLimits();
    } catch (e) {
      console.error(e);
    }
  }
}
