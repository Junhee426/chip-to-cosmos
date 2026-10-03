import { POSTER_STEER } from '../app/beam-presets';
import type { AppState, Store } from '../app/state';
import { beamSolution } from '../app/system';
import { h, slider } from './dom';
import { FootprintInset } from './footprint-inset';

export type PosterView = 'hidden' | 'landing' | 'demo' | 'poster';

export interface PosterActions {
  runQuick: () => void;
  runEngineering: () => void;
  runGrating: () => void;
  explore: () => void;
}

/**
 * Screenshot-first overlay for presentation mode:
 *  - landing: title, one-line thesis, "Run 15-second demo" / "Explore freely"
 *  - demo:    title only (captions and the causal strip come from the demo / HUD)
 *  - poster:  title, 3–4 calculated key metrics and a Try-it steering slider
 * Every number is read from the shared BeamSolution at render time.
 */
export class Poster {
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;
  /** enlarged footprint detail (shown on narrow screens, see CSS) */
  readonly inset = new FootprintInset();
  private metrics: HTMLElement;
  private landing: HTMLElement;
  private tryIt: HTMLElement;
  private steer: { el: HTMLElement; set: (v: number) => void };
  view: PosterView = 'hidden';

  constructor(private store: Store, actions: PosterActions) {
    this.top = h('div', 'pst-top');
    this.top.innerHTML = `<div class="pst-brand">CHIP TO COSMOS</div><div class="pst-thesis">FROM ELEMENT PHASE<br>TO COMMUNICATION COVERAGE</div>`;
    const chain = h('div', 'pst-chain', 'Satellite → Earth-facing array → Beam → −3 dB footprint → Link');
    this.top.append(chain);
    this.landing = h('div', 'pst-landing');
    this.landing.innerHTML = `<p class="pst-lead">A phased array on the satellite's Earth-facing deck. Change the element phase, and the beam — and the area it serves on Earth — moves. Every number is calculated.</p>`;
    const run = h('button', 'pst-btn primary', '▶ Run 15-second demo');
    run.addEventListener('click', actions.runQuick);
    const explore = h('button', 'pst-btn', 'Explore freely');
    explore.addEventListener('click', actions.explore);
    const lrow = h('div', 'pst-actions');
    lrow.append(run, explore);
    this.landing.append(lrow);
    this.top.append(this.landing);

    this.bottom = h('div', 'pst-bottom');
    this.metrics = h('div', 'pst-metrics');
    this.metrics.setAttribute('aria-live', 'polite');
    this.tryIt = h('div', 'pst-try');
    this.steer = slider({ label: 'TRY IT · steer the beam θ₀', min: POSTER_STEER.min, max: POSTER_STEER.max, step: 1, value: 25, unit: '°', onInput: (v) => store.setParams({ steerDeg: v }) });
    this.tryIt.append(this.steer.el);
    const arow = h('div', 'pst-actions');
    const b = (label: string, fn: () => void, cls = 'pst-btn') => {
      const e = h('button', cls, label);
      e.addEventListener('click', fn);
      arow.append(e);
    };
    b('Explore freely', actions.explore, 'pst-btn primary');
    b('▶ Replay', actions.runQuick);
    b('Engineering demo', actions.runEngineering);
    b('Why 0.5λ matters', actions.runGrating);
    const note = h('div', 'pst-note', 'Calculated: beam, −3 dB footprint & link · Satellite enlarged for visibility');
    this.bottom.append(this.metrics, this.tryIt, arow, note);
    store.subscribe((s, c) => {
      if (this.view === 'poster' && (c.has('params') || c.has('presentation'))) this.render(s);
    });
  }

  setView(v: PosterView): void {
    this.view = v;
    document.body.dataset.posterView = v;
    this.top.dataset.view = v;
    this.bottom.dataset.view = v;
    this.top.hidden = v === 'hidden';
    this.bottom.hidden = v !== 'poster';
    this.inset.el.hidden = v !== 'poster';
    this.landing.hidden = v !== 'landing';
    if (v === 'poster') this.render(this.store.get());
  }

  private render(s: AppState): void {
    const b = beamSolution(s.params);
    const f = b.footprint;
    const L = b.link;
    this.steer.set(s.params.steerDeg);
    this.inset.render(s.params);
    const tile = (k: string, label: string, value: string, unit: string) => `<div class="pst-m" data-k="${k}"><span>${label}</span><b>${value}</b><em>${unit}</em></div>`;
    this.metrics.innerHTML = [
      tile('array', 'ARRAY', `${b.input.arrayN}×${b.input.arrayN}`, `${b.input.spacingLambda.toFixed(2)}λ · θ₀ ${b.input.steerThetaDeg}°`),
      tile('gain', 'GAIN', b.pattern.gainDbi.toFixed(1), 'dBi'),
      tile('footprint', 'FOOTPRINT', f.center ? `${Math.round(f.alongTrackKm)} × ${Math.round(f.crossTrackKm)}` : 'off Earth', 'km · −3 dB'),
      tile('link', 'LINK MARGIN', L ? `${L.marginDb >= 0 ? '+' : ''}${L.marginDb.toFixed(1)}` : 'no link', L ? `dB · El ${L.elevationDeg.toFixed(0)}°` : ''),
    ].join('');
    this.metrics.classList.toggle('neg', !L || L.marginDb < 0);
  }
}
