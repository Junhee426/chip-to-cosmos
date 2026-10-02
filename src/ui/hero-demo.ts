import type { LevelId } from '../app/navigation';
import type { ScaleManager } from '../app/scale-manager';
import type { Store } from '../app/state';
import { beamSolution } from '../app/system';
import { BEAM_PRESETS } from '../app/beam-presets';
import type { CameraRig } from '../graphics/camera';
import { easeInOutSine } from '../graphics/camera';
import type { CausalStage, Hud } from './hud';
import { bandName, km, km2 } from './beam-controls';
import { h } from './dom';

export type DemoStage = 'satellite' | 'array-focus' | 'beam-lab' | 'phase' | 'wavefront' | 'pattern' | 'footprint' | 'earth-footprint' | 'link';

const CAUSAL_OF: Partial<Record<DemoStage, CausalStage>> = { phase: 'phase', wavefront: 'phase', pattern: 'beam', footprint: 'footprint', 'earth-footprint': 'footprint', link: 'link' };
/** test hook: ?demoHold=N lengthens reading holds (slow software renderers need time to capture) */
const HOLD_SCALE = Math.max(1, Math.min(10, Number(new URLSearchParams(location.search).get('demoHold')) || 1));
const NEAR_SATELLITE = new Set<LevelId>(['satellite', 'array', 'cosmos', 'payload']);

/**
 * Skippable, real-time Satellite → BEAM LAB → Earth-footprint sequence (~25 s).
 * It drives the real app — ScaleManager flights with renormalisation, store
 * parameters, the shared BeamSolution — and every caption number is read
 * from that solution at the moment it is shown. Nothing is pre-rendered.
 */
export class HeroDemo {
  private el: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cancelled = false;
  running = false;
  stage: DemoStage | null = null;

  constructor(private mgr: ScaleManager, private rig: CameraRig, private store: Store, private hud: Hud, private motion: number, private onFinish: () => void) {
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
    if (this.stage) document.body.dataset.demoReady = this.stage;
    const end = performance.now() + ms * HOLD_SCALE;
    while (!this.cancelled && performance.now() < end) await new Promise((r) => setTimeout(r, 40));
  }

  private async frame(stage: string, seconds: number): Promise<void> {
    const v = this.mgr.current?.demoView(stage);
    if (!v || this.cancelled) return;
    // close-ups (e.g. a 100 km footprint seen from COSMOS) need the orbit clamp relaxed for this view
    const c = this.rig.controls;
    c.minDistance = Math.min(c.minDistance, v.pos.distanceTo(v.target) * 0.6);
    await this.rig.flyTo(v, Math.max(0.05, seconds * this.motion), easeInOutSine);
  }

  /** Animate a parameter through the real store (one write per frame); instant under reduced motion. */
  private tween(ms: number, apply: (t: number) => void): Promise<void> {
    if (this.motion < 1) {
      apply(1);
      return Promise.resolve();
    }
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
    const ok = await this.mgr.goTo(level, stepDuration);
    return ok && !this.cancelled && this.mgr.current?.id === level;
  }

  private pauseOrbit(v: boolean): void {
    for (const l of this.mgr.levelsBuilt()) if (l.id === 'cosmos') (l as unknown as { orbitPaused: boolean }).orbitPaused = v;
  }

  async play(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.el.classList.add('on');
    document.body.classList.add('demo-running');
    const s = this.store;
    try {
      // --- SATELLITE ---
      this.enter('satellite');
      if (!NEAR_SATELLITE.has(this.store.get().level)) await this.mgr.jumpTo('satellite');
      else if (!(await this.go('satellite'))) return;
      const nadir = BEAM_PRESETS.find((p) => p.id === 'nadir')!;
      s.set({ mode: 'signal', explode: 0, selected: null });
      s.setParams(nadir.params);
      const p = s.get().params;
      this.say('PHASED-ARRAY DOWNLINK', `${bandName(p.freqGHz)} · ${p.arrayN}×${p.arrayN} · d = ${p.spacingLambda.toFixed(2)}λ`, 'One calculated array state drives everything that follows.');
      await this.frame('satellite', 1.2);
      await this.hold(1200);

      // --- ARRAY FOCUS ---
      if (this.cancelled) return;
      this.enter('array-focus');
      this.say('PHASED ARRAY', 'Element phase controls beam direction.', 'Each patch has its own phase shifter. Colour = calculated phase.');
      await this.frame('array-focus', 1.4);
      await this.hold(600);

      // --- BEAM LAB (real anchored zoom into the sub-array) ---
      this.enter('beam-lab');
      this.say('BEAM LAB', 'Inside the sub-array', `${p.arrayN}×${p.arrayN} elements · ${p.freqGHz.toFixed(1)} GHz`);
      if (!(await this.go('array', 2.4))) return;
      await this.hold(300);

      // --- PHASE ---
      this.enter('phase');
      const target = BEAM_PRESETS.find((q) => q.id === 'steered')!.params.steerDeg!;
      this.say('PHASE', 'Progressive phase βx = −k·d·sin θ₀', 'Steering 0° → 25°: watch the colour gradient across the elements.');
      await this.frame('phase', 1.0);
      await this.tween(2000, (t) => s.setParams({ steerDeg: Math.round(target * t) }));
      const b1 = beamSolution(s.get().params);
      this.sub.innerHTML = `θ₀ = ${s.get().params.steerDeg}° → <b>${((b1.pattern.phaseStepX * 180) / Math.PI).toFixed(1)}° per element</b>`;
      await this.hold(500);

      // --- WAVEFRONT ---
      if (this.cancelled) return;
      this.enter('wavefront');
      this.say('WAVEFRONT', 'Phase gradient → tilted wavefront → beam steering', 'Fronts are λ apart and perpendicular to the beam axis.');
      await this.frame('wavefront', 1.0);
      await this.hold(1200);

      // --- PATTERN ---
      if (this.cancelled) return;
      this.enter('pattern');
      const b2 = beamSolution(s.get().params);
      this.say('RADIATION PATTERN', `D ${b2.pattern.directivityDbi.toFixed(1)} dBi · G ${b2.pattern.gainDbi.toFixed(1)} dBi · HPBW ${b2.pattern.hpbwDeg.toFixed(1)}°`, `Sidelobe ${b2.pattern.sidelobeDb.toFixed(1)} dB · steering ${b2.input.steerThetaDeg}° · white ring = −3 dB`);
      await this.frame('pattern', 1.0);
      await this.hold(1600);

      // --- FOOTPRINT (flat ground, lab) ---
      if (this.cancelled) return;
      this.enter('footprint');
      this.say('FOOTPRINT', 'Edge rays through the −3 dB ring land on the ground', `Flat-ground projection · distance compressed for display · ${km(b2.flat.alongKm)} × ${km(b2.flat.acrossKm)} km`);
      await this.frame('footprint', 1.0);
      await this.hold(1200);

      // --- EARTH FOOTPRINT (same contour, spherical Earth) ---
      if (this.cancelled) return;
      this.enter('earth-footprint');
      this.say('EARTH FOOTPRINT', 'Same contour, intersected with the spherical Earth', 'Array → spacecraft → Earth frame, one ray per contour direction.');
      if (!(await this.go('cosmos', 1.3))) return;
      this.pauseOrbit(true);
      const f = b2.footprint;
      this.sub.innerHTML = f.center ? `Along-track ${km(f.alongTrackKm)} km · cross-track ${km(f.crossTrackKm)} km · area ${km2(f.areaKm2)} km² · ${km(f.nadirOffsetKm ?? 0)} km from nadir` : 'Beam centre above the horizon';
      await this.frame('earth-footprint', 1.2);
      await this.hold(800);

      // --- LINK ---
      if (this.cancelled) return;
      this.enter('link');
      const L = b2.link;
      this.say('LINK', L ? `Gain ${b2.pattern.gainDbi.toFixed(1)} dBi · EIRP ${b2.power.eirpDbw.toFixed(1)} dBW` : 'No link', L ? `User at the beam centre (El ${L.elevationDeg.toFixed(0)}°) · Rx ${L.rxPowerDbm.toFixed(1)} dBm · margin <b>${L.marginDb >= 0 ? '+' : ''}${L.marginDb.toFixed(1)} dB</b>` : '');
      await this.frame('link', 1.0);
      await this.hold(2000);
    } finally {
      this.finish(!this.cancelled);
    }
  }

  /** Stop at once and leave the user exactly where the demo was (navigation is never trapped). */
  async skip(): Promise<void> {
    if (!this.running) return;
    this.cancelled = true;
    this.mgr.stop();
    this.rig.finishFlight();
    while (this.running) await new Promise((r) => setTimeout(r, 30));
  }

  private finish(completed: boolean): void {
    this.pauseOrbit(false);
    this.running = false;
    this.stage = null;
    delete document.body.dataset.demoStage;
    delete document.body.dataset.demoReady;
    this.el.classList.remove('on', 'show');
    document.body.classList.remove('demo-running');
    this.hud.setCausal(null, false);
    if (completed) this.onFinish();
  }
}
