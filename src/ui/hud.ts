import { LEVELS, MAIN_CHAIN, breadcrumb, depth, formatLength, type LevelId } from '../app/navigation';
import type { AppState, EngMode, Quality, Store } from '../app/state';
import { LEVEL_KEY_PARAM } from './summary';
import { MOBILE_LAYOUT_QUERY } from '../app/quality';
import { beamSolution, solveSystem } from '../app/system';
import { THEORY } from '../content/theory';
import type { ModelMeta } from '../models/meta';
import { SIGNAL_CHAIN } from '../models/rf';
import type { ComponentDef } from '../scenes/base';
import { buildAnalysis, type Analysis } from './analysis';
import { fx, h } from './dom';

export interface HudCallbacks {
  navigate: (id: LevelId) => void;
  back: () => void;
  /** safe viewport changed (panels, sheet, nav) */
  layout: () => void;
  replayIntro: () => void;
  componentInfo: (id: string) => ComponentDef | null;
  /** components of the current level (for the keyboard/touch-reachable parts list) */
  components: () => ComponentDef[];
  /** start the Satellite → Beam Lab → Earth footprint demo */
  runBeamDemo: () => void;
}

export type CausalStage = 'phase' | 'beam' | 'footprint' | 'link';
const CAUSAL: { id: CausalStage; label: string }[] = [
  { id: 'phase', label: 'PHASE' },
  { id: 'beam', label: 'BEAM' },
  { id: 'footprint', label: 'FOOTPRINT' },
  { id: 'link', label: 'LINK' },
];
/** levels where the beam chain is on screen */
const BEAM_LEVELS = new Set<LevelId>(['satellite', 'array', 'cosmos']);

const MODES: { id: EngMode; label: string; key: string }[] = [
  { id: 'structure', label: 'Structure', key: '1' },
  { id: 'signal', label: 'Signal', key: '2' },
  { id: 'power', label: 'Power', key: '3' },
  { id: 'thermal', label: 'Thermal', key: '4' },
  { id: 'radiation', label: 'Radiation', key: '5' },
];

/** All 2D chrome around the WebGL canvas. */
export class Hud {
  readonly root: HTMLElement;
  private crumbs: HTMLElement;
  private ladder: HTMLElement;
  private modeBtns = new Map<EngMode, HTMLButtonElement>();
  private explode: HTMLInputElement;
  private explodeVal: HTMLElement;
  private cutaway: HTMLButtonElement;
  private labelsBtn: HTMLButtonElement;
  private quality: HTMLSelectElement;
  private panelHead: HTMLElement;
  private info: HTMLElement;
  private tabs: HTMLElement;
  private tabBody: HTMLElement;
  private analysisHost: HTMLElement;
  private analysis: Analysis | null = null;
  private analysisLevel: LevelId | null = null;
  private scaleBar: HTMLElement;
  private scaleText: HTMLElement;
  private scaleTag: HTMLElement;
  private coupling: HTMLElement;
  private couplingKey = '';
  private couplingPrev = new Map<string, number>();
  private parts!: HTMLElement;
  readonly fps: HTMLElement;
  readonly perf: HTMLElement;
  private panel!: HTMLElement;
  private rail!: HTMLElement;
  private top!: HTMLElement;
  private tools!: HTMLElement;
  private summary!: HTMLElement;
  private sheetHandle!: HTMLButtonElement;
  private toastEl!: HTMLElement;
  private qualityNote!: HTMLElement;
  sheetExpanded = false;
  private mobile = false;
  private causal!: HTMLElement;
  private causalPrev = new Map<CausalStage, string>();
  private causalStage: CausalStage | null = null;
  private demoOn = false;
  private pendingChanged: Set<string> | null = null;

  constructor(parent: HTMLElement, private store: Store, private cb: HudCallbacks) {
    this.root = h('div', 'hud');
    parent.append(this.root);

    // --- top bar ---
    const top = h('header', 'topbar');
    const brand = h('div', 'brand', `<div class="brand-mark"></div><div><div class="brand-name">CHIP TO COSMOS</div><div class="brand-tag">From Electrons to Orbital Networks</div></div>`);
    this.crumbs = h('nav', 'crumbs');
    this.crumbs.setAttribute('aria-label', 'Scale breadcrumb');
    const tools = h('div', 'tools');
    this.quality = h('select', 'tool-select');
    this.quality.setAttribute('aria-label', 'Graphics quality');
    for (const [v, l] of [['auto', 'Auto'], ['high', 'High'], ['balanced', 'Balanced'], ['performance', 'Performance']]) this.quality.append(new Option(`Quality · ${l}`, v));
    this.quality.addEventListener('change', () => store.set({ quality: this.quality.value as Quality }));
    this.labelsBtn = h('button', 'tool-btn', 'Labels');
    this.labelsBtn.setAttribute('aria-pressed', 'true');
    this.labelsBtn.addEventListener('click', () => store.set({ labels: !store.get().labels }));
    const intro = h('button', 'tool-btn', '▶ Intro');
    intro.addEventListener('click', () => cb.replayIntro());
    const demo = h('button', 'tool-btn demo-btn', '▶ Beam demo');
    demo.setAttribute('aria-label', 'Run the beam demo: element phase to Earth footprint to link margin');
    demo.addEventListener('click', () => cb.runBeamDemo());
    this.fps = h('span', 'fps');
    this.qualityNote = h('span', 'quality-note');
    tools.append(this.fps, this.qualityNote, this.labelsBtn, this.quality, intro, demo);
    const back = h('button', 'icon-btn nav-back', '‹');
    back.setAttribute('aria-label', 'Zoom out to parent scale');
    back.addEventListener('click', () => cb.back());
    const menu = h('button', 'icon-btn nav-menu', '⋯');
    menu.setAttribute('aria-label', 'Menu: scale, modes, view, quality');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-controls', 'c2c-menu');
    menu.addEventListener('click', () => {
      const open = !this.root.classList.contains('menu-open');
      this.root.classList.toggle('menu-open', open);
      menu.setAttribute('aria-expanded', String(open));
    });
    top.append(back, brand, this.crumbs, tools, menu);
    this.top = top;
    this.tools = tools;

    // --- left rail ---
    const rail = h('aside', 'rail');
    rail.id = 'c2c-menu';
    rail.setAttribute('aria-label', 'Scale, engineering mode and view');
    this.rail = rail;
    rail.append(h('div', 'rail-title', 'SCALE'));
    this.ladder = h('ol', 'ladder');
    rail.append(this.ladder);
    rail.append(h('div', 'rail-title', 'ENGINEERING MODE'));
    const modes = h('div', 'modes');
    for (const m of MODES) {
      const b = h('button', `mode mode-${m.id}`, `<i aria-hidden="true"></i>${m.label}<kbd aria-hidden="true">${m.key}</kbd>`);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-keyshortcuts', m.key);
      b.addEventListener('click', () => store.set({ mode: m.id }));
      this.modeBtns.set(m.id, b);
      modes.append(b);
    }
    rail.append(modes);
    rail.append(h('div', 'rail-title', 'VIEW'));
    const ex = h('label', 'ctl');
    this.explodeVal = h('span', 'ctl-val', '0 %');
    const exHead = h('div', 'ctl-head', '<span class="ctl-name">Explode</span>');
    exHead.append(this.explodeVal);
    this.explode = h('input');
    this.explode.type = 'range';
    this.explode.min = '0';
    this.explode.max = '1';
    this.explode.step = '0.01';
    this.explode.value = '0';
    this.explode.addEventListener('input', () => store.set({ explode: Number(this.explode.value) }));
    ex.append(exHead, this.explode);
    this.cutaway = h('button', 'tool-btn wide', 'Cutaway');
    this.cutaway.setAttribute('aria-pressed', 'false');
    this.cutaway.addEventListener('click', () => store.set({ cutaway: !store.get().cutaway }));
    rail.append(ex, this.cutaway);

    // --- right panel ---
    const panel = h('aside', 'panel');
    panel.setAttribute('aria-label', 'Selected part and level information');
    panel.id = 'c2c-inspector';
    this.panel = panel;
    this.sheetHandle = h('button', 'sheet-handle', '<span></span>');
    this.sheetHandle.setAttribute('aria-label', 'Expand details');
    this.sheetHandle.setAttribute('aria-expanded', 'false');
    this.sheetHandle.setAttribute('aria-controls', 'c2c-inspector');
    this.sheetHandle.addEventListener('click', () => this.setSheet(!this.sheetExpanded));
    this.summary = h('div', 'sheet-summary');
    this.panelHead = h('div', 'panel-head');
    this.info = h('div', 'info');
    this.tabs = h('div', 'tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Explanation depth');
    for (const t of ['intuition', 'engineering', 'theory'] as const) {
      const b = h('button', 'tab', t.toUpperCase());
      b.dataset.tab = t;
      b.id = `c2c-tab-${t}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'c2c-tabpanel');
      b.addEventListener('click', () => store.set({ theoryTab: t }));
      this.tabs.append(b);
    }
    this.tabBody = h('div', 'tab-body');
    this.tabBody.id = 'c2c-tabpanel';
    this.tabBody.setAttribute('role', 'tabpanel');
    this.parts = h('nav', 'parts');
    this.parts.setAttribute('aria-label', 'Parts at this scale');
    this.analysisHost = h('div', 'analysis');
    panel.append(this.sheetHandle, this.summary, this.panelHead, this.info, this.parts, this.tabs, this.tabBody, this.analysisHost);

    // --- bottom: scale bar + coupling ---
    const scale = h('div', 'scale');
    this.scaleBar = h('div', 'scale-bar');
    this.scaleText = h('div', 'scale-text');
    this.scaleTag = h('div', 'scale-tag');
    scale.append(this.scaleBar, this.scaleText, this.scaleTag);
    this.coupling = h('div', 'coupling');
    // causal strip: one beam state, four consequences
    this.causal = h('ol', 'causal');
    this.causal.setAttribute('aria-label', 'Beam causal chain');
    this.causal.innerHTML = CAUSAL.map((c, i) => `${i ? '<li class="causal-arrow" aria-hidden="true">→</li>' : ''}<li class="causal-step" data-stage="${c.id}"><span>${c.label}</span><b></b></li>`).join('');
    const hint = h('div', 'hint', 'Drag to orbit · scroll to zoom · <b>double-click</b> a part to dive in · <b>Esc</b> to zoom out');

    this.perf = h('pre', 'perf-overlay');
    this.perf.hidden = true;
    this.toastEl = h('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.root.append(top, rail, panel, this.causal, scale, this.coupling, hint, this.perf, this.toastEl);
    const ro = new ResizeObserver(() => cb.layout());
    for (const el of [top, rail, panel, this.coupling, this.causal]) ro.observe(el);
    const mq = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const place = () => this.placeForViewport(mq.matches);
    mq.addEventListener('change', place);
    addEventListener('resize', () => this.placeCoupling());
    place();
    this.buildLadder();
    store.subscribe((s, c) => this.onState(s, c));
    this.onState(store.get(), new Set(['init', 'level', 'mode', 'explode', 'cutaway', 'quality', 'labels', 'theoryTab', 'params', 'selected']));
  }

  private buildLadder(): void {
    const items: LevelId[] = [...MAIN_CHAIN.slice(0, 2), 'array', ...MAIN_CHAIN.slice(2)];
    for (const id of items) {
      const li = h('li', 'rung');
      li.dataset.level = id;
      if (id === 'array') li.classList.add('branch');
      const b = h('button', 'rung-btn', `<span class="rung-dot" aria-hidden="true"></span><span class="rung-name">${LEVELS[id].crumb}</span><span class="rung-scale">${rungScale(id)}</span>`);
      b.setAttribute('aria-label', `${LEVELS[id].title} (${rungScale(id)})`);
      b.addEventListener('click', () => this.cb.navigate(id));
      li.append(b);
      this.ladder.append(li);
    }
  }

  private onState(s: AppState, c: Set<string>): void {
    // parameter drags fire many events per frame: panels, charts and strips update once per frame
    if (c.has('params') && !c.has('init') && c.size === [...c].filter((k) => k.startsWith('params')).length) {
      if (!this.pendingChanged) {
        this.pendingChanged = new Set();
        requestAnimationFrame(() => {
          const changed = this.pendingChanged!;
          this.pendingChanged = null;
          this.onParams(this.store.get(), changed);
        });
      }
      for (const k of c) this.pendingChanged.add(k);
      return;
    }
    this.onParams(s, c);
  }

  private onParams(s: AppState, c: Set<string>): void {
    if (c.has('level') || c.has('transitioning')) {
      this.crumbs.innerHTML = '';
      breadcrumb(s.level).forEach((l, i, arr) => {
        const b = h('button', `crumb${i === arr.length - 1 ? ' current' : ''}`, l.crumb);
        b.addEventListener('click', () => this.cb.navigate(l.id));
        this.crumbs.append(b);
        if (i < arr.length - 1) this.crumbs.append(h('span', 'crumb-sep', '›'));
      });
      for (const li of this.ladder.querySelectorAll<HTMLElement>('.rung')) {
        li.classList.toggle('current', li.dataset.level === s.level);
        li.querySelector('button')?.toggleAttribute('aria-current', li.dataset.level === s.level);
      }
      this.root.classList.toggle('transitioning', s.transitioning);
    }
    if (c.has('level')) this.buildPanel(s);
    if (c.has('mode'))
      for (const [m, b] of this.modeBtns) {
        b.classList.toggle('on', m === s.mode);
        b.setAttribute('aria-pressed', String(m === s.mode));
      }
    if (c.has('explode')) {
      this.explode.value = String(s.explode);
      this.explodeVal.textContent = `${Math.round(s.explode * 100)} %`;
    }
    if (c.has('cutaway')) {
      this.cutaway.classList.toggle('on', s.cutaway);
      this.cutaway.setAttribute('aria-pressed', String(s.cutaway));
    }
    if (c.has('labels')) {
      this.labelsBtn.classList.toggle('on', s.labels);
      this.labelsBtn.setAttribute('aria-pressed', String(s.labels));
    }
    if (c.has('quality')) this.quality.value = s.quality;
    if (c.has('theoryTab') || c.has('level')) this.renderTab(s);
    if (c.has('selected') || c.has('level')) this.renderInfo(s);
    if (c.has('selected') || c.has('level')) this.renderParts(s);
    if (c.has('selected') || c.has('level') || c.has('params')) this.renderSummary(s);
    if (c.has('level')) this.root.classList.remove('menu-open');
    if (c.has('presentation') || c.has('init')) {
      this.root.classList.toggle('presentation', s.presentation);
      document.body.classList.toggle('presentation', s.presentation);
      this.cb.layout();
    }
    if (this.analysis && (c.has('params') || c.has('init'))) this.analysis.update(s, c);
    if (c.has('params') || c.has('init')) this.renderCoupling(s);
    if (c.has('params') || c.has('init') || c.has('level') || c.has('presentation')) this.renderCausal(s);
  }

  /** PHASE → BEAM → FOOTPRINT → LINK with the current calculated values. */
  private renderCausal(s: AppState): void {
    const show = this.demoOn || s.presentation || BEAM_LEVELS.has(s.level);
    this.causal.hidden = !show;
    this.root.classList.toggle('causal-on', show);
    if (!show) return;
    const b = beamSolution(s.params);
    const f = b.footprint;
    const vals: Record<CausalStage, string> = {
      phase: `β ${((b.pattern.phaseStepX * 180) / Math.PI).toFixed(0)}°/el`,
      beam: `${b.pattern.hpbwDeg.toFixed(1)}° · ${b.pattern.gainDbi.toFixed(1)} dBi`,
      footprint: f.center ? `${Math.round(f.alongTrackKm)}×${Math.round(f.crossTrackKm)} km` : 'off Earth',
      link: b.link ? `${b.link.marginDb >= 0 ? '+' : ''}${b.link.marginDb.toFixed(1)} dB` : 'no link',
    };
    for (const li of this.causal.querySelectorAll<HTMLElement>('.causal-step')) {
      const id = li.dataset.stage as CausalStage;
      const v = vals[id];
      const el = li.querySelector('b')!;
      if (el.textContent !== v) {
        el.textContent = v;
        if (this.causalPrev.has(id)) {
          li.classList.remove('changed');
          void li.offsetWidth;
          li.classList.add('changed');
        }
        this.causalPrev.set(id, v);
      }
      li.classList.toggle('on', this.causalStage === id);
      if (this.causalStage === id) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
    this.causal.classList.toggle('warn', b.pattern.gratingLobe);
  }

  private demoEl: HTMLElement | null = null;

  private posterTop: HTMLElement | null = null;
  private posterBottom: HTMLElement | null = null;

  /** Presentation-mode overlay (title, metrics, Try-it): part of the safe-viewport computation. */
  mountPoster(top: HTMLElement, bottom: HTMLElement): void {
    this.posterTop = top;
    this.posterBottom = bottom;
    this.root.append(top, bottom);
    const ro = new ResizeObserver(() => this.cb.layout());
    ro.observe(top);
    ro.observe(bottom);
  }

  /** The demo caption lives in the HUD so the safe viewport can keep the beam clear of it. */
  mountDemo(el: HTMLElement): void {
    this.demoEl = el;
    this.root.append(el);
    new ResizeObserver(() => this.cb.layout()).observe(el);
  }

  /** Hero demo: highlight the current causal stage (null = none). */
  setCausal(stage: CausalStage | null, demoRunning: boolean): void {
    this.causalStage = stage;
    this.demoOn = demoRunning;
    this.root.classList.toggle('demo-on', demoRunning);
    this.renderCausal(this.store.get());
    this.cb.layout();
  }

  private buildPanel(s: AppState): void {
    const L = LEVELS[s.level];
    this.panelHead.innerHTML = `<div class="lvl-kicker">LEVEL ${depth(s.level)} · ${L.crumb}</div><h2>${L.title}</h2><div class="lvl-sub">${L.subtitle}</div>${L.notToScale ? '<span class="badge badge-illustrative">Proportions not to scale</span>' : ''}`;
    if (this.analysisLevel !== s.level) {
      this.analysisHost.innerHTML = '';
      this.analysis = buildAnalysis(s.level, this.store);
      this.analysisLevel = s.level;
      this.analysisHost.append(this.analysis.el);
      requestAnimationFrame(() => this.analysis?.update(this.store.get(), new Set(['init', 'params'])));
    }
  }

  private renderTab(s: AppState): void {
    const t = THEORY[s.level];
    for (const b of this.tabs.querySelectorAll<HTMLElement>('.tab')) {
      const on = b.dataset.tab === s.theoryTab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) this.tabBody.setAttribute('aria-labelledby', b.id);
    }
    if (s.theoryTab === 'intuition') this.tabBody.innerHTML = t.intuition.map((p) => `<p>${p}</p>`).join('');
    else if (s.theoryTab === 'engineering') this.tabBody.innerHTML = t.engineering.map((p) => `<p>${p}</p>`).join('');
    else this.tabBody.innerHTML = (t.models.length ? t.models.map(metaHtml).join('') : '<p class="muted">No calculated model at this level — see the linked levels.</p>') + (t.illustrative.length ? `<div class="illus"><b>Illustrative in this view:</b><ul>${t.illustrative.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : '');
  }

  private renderInfo(s: AppState): void {
    const c = s.selected ? this.cb.componentInfo(s.selected) : null;
    if (!c) {
      this.info.innerHTML = '';
      this.info.classList.remove('open');
      return;
    }
    const chain = c.chain ? SIGNAL_CHAIN.find((b) => b.id === c.chain) : undefined;
    const specs = chain?.params ?? c.specs ?? [];
    this.info.innerHTML = `
      <div class="info-head"><div><div class="info-kicker">SELECTED</div><h3>${c.name}</h3>${c.sub ? `<div class="info-sub">${c.sub}</div>` : ''}</div><button class="info-close" aria-label="Close">×</button></div>
      ${chain ? `<dl class="info-dl"><dt>Function</dt><dd>${chain.func}</dd><dt>Input</dt><dd>${chain.input}</dd><dt>Output</dt><dd>${chain.output}</dd><dt>Equation</dt><dd class="mono">${chain.equation}</dd></dl>` : `<p>${c.desc}</p>`}
      ${specs.length ? `<div class="info-specs">${specs.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
      ${c.child ? `<button class="enter-btn">Zoom into ${LEVELS[c.child].crumb} ›</button>` : ''}`;
    this.info.classList.add('open');
    this.info.querySelector('.info-close')?.addEventListener('click', () => this.store.set({ selected: null }));
    this.info.querySelector('.enter-btn')?.addEventListener('click', () => this.cb.navigate(c.child!));
  }

  /** Every part is reachable without the canvas: keyboard, screen readers, and small screens with few callouts. */
  private renderParts(s: AppState): void {
    const list = this.cb.components();
    if (!list.length) {
      this.parts.innerHTML = '';
      return;
    }
    this.parts.innerHTML = `<div class="parts-title">PARTS AT THIS SCALE</div><div class="parts-list">${list
      .map((c) => `<button class="part${c.id === s.selected ? ' on' : ''}" data-id="${c.id}" aria-pressed="${c.id === s.selected}">${c.name}${c.child ? ' <span aria-hidden="true">›</span>' : ''}</button>`)
      .join('')}</div>`;
    for (const b of this.parts.querySelectorAll<HTMLElement>('.part')) b.addEventListener('click', () => this.store.set({ selected: b.dataset.id === this.store.get().selected ? null : b.dataset.id! }));
  }

  private renderCoupling(s: AppState): void {
    const p = s.params;
    const key = JSON.stringify(p);
    if (key === this.couplingKey) return;
    this.couplingKey = key;
    const sys = solveSystem(p);
    // what changed since the last parameter edit, and in which direction (calculated values only)
    const prev = this.couplingPrev;
    const next = new Map<string, number>();
    const pill = (label: string, value: string, go: LevelId | undefined, num: number, why: string) => {
      next.set(label, num);
      const before = prev.get(label);
      const d = before === undefined ? 0 : num - before;
      const rel = before ? Math.abs(d / before) : 0;
      const cls = before !== undefined && rel > 1e-6 ? (d > 0 ? ' changed up' : ' changed down') : '';
      const delta = cls ? `<em aria-hidden="true">${d > 0 ? '▲' : '▼'}</em>` : '';
      return `<button class="pill${cls}"${go ? ` data-go="${go}"` : ''} title="${why}" aria-label="${label} ${value}${cls ? (d > 0 ? ', increased' : ', decreased') : ''}. ${why}"><span>${label}</span><b>${value}${delta}</b></button>`;
    };
    const arrow = '<span class="pill-arrow">→</span>';
    this.coupling.innerHTML = `
      <div class="chain"><span class="chain-name">CHIP → HEAT</span>${[
        pill('ADC', `${p.adcBits} bit · ${p.adcFsMsps} MS/s`, 'payload', p.adcBits * 1e4 + p.adcFsMsps, 'Converter resolution and sample rate (input)'),
        pill('SNRq', `${fx(sys.quantSnrDb, 1)} dB`, undefined, sys.quantSnrDb, 'Quantisation SNR = 6.02·N + 1.76 dB'),
        pill('ADC+DSP', `${fx(sys.adcPowerW + sys.dspPowerW, 0)} W`, 'die', sys.adcPowerW + sys.dspPowerW, 'ADC ∝ 2^ENOB·fs (Walden FOM); DSP ∝ N·fs'),
        pill('Payload DC', `${fx(sys.payloadDcW, 0)} W`, 'satellite', sys.payloadDcW, 'ADC + DSP + PA DC (Pout/PAE) + LO/LNA'),
        pill('Heat', `${fx(sys.heatW, 0)} W`, undefined, sys.heatW, 'Q = P_DC − P_RF radiated'),
        pill('Radiator', `${fx(sys.radiatorM2, 2)} m²`, 'satellite', sys.radiatorM2, 'A = Q / (εσ(T⁴ − T_sink⁴))'),
      ].join(arrow)}</div>
      <div class="chain"><span class="chain-name">BEAM → LINK</span>${[
        pill('Array', `${p.arrayN}×${p.arrayN} · ${p.steerDeg}°`, 'array', p.arrayN * 1e3 + p.steerDeg + p.spacingLambda, 'Elements, spacing, steering and taper (input)'),
        pill('Gain', `${fx(sys.gainDbi, 1)} dBi`, undefined, sys.gainDbi, 'Directivity integrated from |AF·EP|² × 70 % efficiency'),
        pill('EIRP', `${fx(sys.eirpDbw, 1)} dBW`, undefined, sys.eirpDbw, 'EIRP = Pt + Gt'),
        pill('Pr', sys.link ? `${fx(sys.link.rxPowerDbm, 1)} dBm` : '—', 'cosmos', sys.link?.rxPowerDbm ?? NaN, 'Pr = EIRP + Gr − FSPL − L (user at the beam centre)'),
        pill('Margin', sys.link ? `${sys.link.marginDb >= 0 ? '+' : ''}${fx(sys.link.marginDb, 1)} dB` : 'no link', 'cosmos', sys.link?.marginDb ?? NaN, 'Eb/N0 − required Eb/N0'),
      ].join(arrow)}</div>`;
    this.couplingPrev = next;
    this.coupling.classList.toggle('neg', !sys.link || sys.link.marginDb < 0 || sys.powerMarginW < 0);
    for (const b of this.coupling.querySelectorAll<HTMLElement>('[data-go]')) b.addEventListener('click', () => this.cb.navigate(b.dataset.go as LevelId));
    this.coupling.classList.remove('flash');
    void this.coupling.offsetWidth;
    this.coupling.classList.add('flash');
  }

  /** Mobile is not a shrunk desktop: tools and the coupling strip move into the menu / sheet. */
  private placeForViewport(mobile: boolean): void {
    this.mobile = mobile;
    this.root.classList.toggle('is-mobile', mobile);
    if (mobile) this.rail.append(this.tools);
    else {
      this.top.insertBefore(this.tools, this.top.lastElementChild);
      this.setSheet(false);
    }
    this.placeCoupling();
    this.cb.layout();
  }

  /**
   * The coupling chain needs ~620 px. When the strip between rail and panel is
   * narrower (mobile, touch tablets in landscape, small windows), it moves into
   * the panel instead of scrolling its pills out of sight.
   */
  private placeCoupling(): void {
    const free = innerWidth - this.rail.getBoundingClientRect().right - (innerWidth - this.panel.getBoundingClientRect().left);
    const inPanel = this.mobile || free < 620;
    const target = inPanel ? this.panel : this.root;
    if (this.coupling.parentElement !== target) {
      target.append(this.coupling);
      this.root.classList.toggle('coupling-in-panel', inPanel);
      this.cb.layout();
    }
  }

  get isMobile(): boolean {
    return this.mobile;
  }

  setSheet(expanded: boolean, focusAnalysis = false): void {
    this.sheetExpanded = expanded;
    this.panel.classList.toggle('expanded', expanded);
    this.sheetHandle.setAttribute('aria-expanded', String(expanded));
    this.sheetHandle.setAttribute('aria-label', expanded ? 'Collapse details' : 'Expand details');
    if (!expanded) this.panel.scrollTop = 0;
    if (expanded && focusAnalysis) requestAnimationFrame(() => this.analysisHost.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    this.cb.layout();
  }

  /** Collapsed mobile inspector: name, one line, key parameter, Internal View, Experiment. */
  private renderSummary(s: AppState): void {
    const c = s.selected ? this.cb.componentInfo(s.selected) : null;
    const L = LEVELS[s.level];
    const name = c ? c.name : L.title;
    const line = c ? (c.sub ?? '') + (c.desc ? ` — ${c.desc.split(/(?<=\.)\s/)[0]}` : '') : L.subtitle;
    const key = c ? c.specs?.[0] ?? '' : LEVEL_KEY_PARAM[s.level](s.params);
    const child = c ? c.child : MAIN_CHAIN[MAIN_CHAIN.indexOf(s.level) + 1];
    this.summary.innerHTML = `
      <div class="sum-kicker">${c ? 'SELECTED' : `LEVEL ${depth(s.level)} · ${L.crumb}`}</div>
      <strong class="sum-name">${name}</strong>
      <p class="sum-line">${line}</p>
      ${key ? `<div class="sum-key">${key}</div>` : ''}
      <div class="sum-actions">
        ${child ? `<button class="sum-btn primary" data-act="enter" aria-label="Internal view: ${LEVELS[child].title}">Inside · ${LEVELS[child].crumb} ›</button>` : ''}
        <button class="sum-btn" data-act="experiment">Experiment</button>
        ${BEAM_LEVELS.has(s.level) && !c ? '<button class="sum-btn" data-act="demo" aria-label="Run the beam demo">▶ Demo</button>' : ''}
      </div>`;
    this.summary.querySelector('[data-act="demo"]')?.addEventListener('click', () => this.cb.runBeamDemo());
    this.summary.querySelector('[data-act="enter"]')?.addEventListener('click', () => child && this.cb.navigate(child));
    this.summary.querySelector('[data-act="experiment"]')?.addEventListener('click', () => this.setSheet(true, true));
  }

  setQualityState(mode: Quality, tier: string, step: number): void {
    this.quality.value = mode;
    this.qualityNote.textContent = mode === 'auto' ? `${tier}${step ? ` −${step}` : ''}` : '';
    document.body.dataset.gfx = tier;
  }

  toast(msg: string, action?: { label: string; run: () => void }): void {
    this.toastEl.innerHTML = `<span>${msg}</span>`;
    if (action) {
      const b = h('button', 'tool-btn', action.label);
      b.addEventListener('click', () => {
        action.run();
        this.toastEl.classList.remove('show');
      });
      this.toastEl.append(b);
    }
    this.toastEl.classList.add('show');
    clearTimeout((this.toastEl as unknown as { _t?: number })._t);
    (this.toastEl as unknown as { _t?: number })._t = window.setTimeout(() => this.toastEl.classList.remove('show'), 7000);
  }

  /** Safe viewport (px from each edge) not covered by chrome — used for camera framing and callouts. */
  insets(): { top: number; right: number; bottom: number; left: number } {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const topBar = this.top.getBoundingClientRect();
    const causal = this.causal.hidden ? null : this.causal.getBoundingClientRect();
    const demo = this.demoOn && this.demoEl ? this.demoEl.getBoundingClientRect() : null;
    const top = { bottom: Math.max(topBar.bottom, causal && causal.height ? causal.bottom : 0, demo && demo.height ? demo.bottom : 0) };
    if (this.store.get().presentation) {
      // presentation: no rail, panel or coupling — only title/causal/caption on top and the poster bar
      const r = (e: HTMLElement | null) => (e && !e.hidden ? e.getBoundingClientRect() : null);
      const title = r(this.posterTop?.querySelector<HTMLElement>('.pst-thesis') ?? null);
      const pb = r(this.posterBottom);
      const topEdge = Math.max(causal && causal.height ? causal.bottom : 0, demo && demo.height ? demo.bottom : 0, title && title.height ? title.bottom : 0);
      return { top: topEdge + 8, right: 16, bottom: pb && pb.height ? H - pb.top + 8 : 16, left: 16 };
    }
    const panel = this.panel.getBoundingClientRect();
    if (this.mobile) {
      // landscape phones: the sheet docks to the right edge instead of covering the bottom
      const side = panel.height > H * 0.6 && panel.left > W * 0.3;
      return side ? { top: top.bottom + 8, right: W - panel.left + 8, bottom: 12, left: 12 } : { top: top.bottom + 8, right: 12, bottom: H - panel.top + 8, left: 12 };
    }
    const rail = this.rail.getBoundingClientRect();
    const coupling = this.coupling.getBoundingClientRect();
    const bottom = this.coupling.parentElement === this.panel ? 24 : H - coupling.top + 12;
    return { top: Math.max(top.bottom, 64) + 8, right: W - panel.left + 12, bottom, left: rail.right + 12 };
  }

  /** Update the scale bar from the metres currently spanned by the viewport. */
  setScale(viewMeters: number, viewPx: number, level: LevelId, transitioning: boolean): void {
    const target = viewMeters * 0.18;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= target).pop() ?? p;
    const px = (nice / viewMeters) * viewPx;
    this.scaleBar.style.width = `${px.toFixed(0)}px`;
    this.scaleText.innerHTML = `<b>${formatLength(nice)}</b><span>field of view ≈ ${formatLength(viewMeters)}</span>`;
    this.scaleTag.textContent = transitioning ? 'ZOOMING' : LEVELS[level].notToScale ? 'NOT TO SCALE' : '';
  }
}

function rungScale(id: LevelId): string {
  const s: Record<LevelId, string> = { cosmos: '10⁷ m', satellite: '10 m', array: '10 cm', payload: '1 m', pcb: '10 cm', package: '1 cm', die: '1 cm', mosfet: '1 µm', silicon: '1 nm', energy: 'eV' };
  return s[id];
}

function metaHtml(m: ModelMeta): string {
  return `<div class="meta">
    <div class="meta-head"><b>${m.title}</b><span class="badge badge-${m.kind}">${m.kind.toUpperCase()}</span></div>
    <div class="meta-eqs">${m.equations.map((e) => `<div class="mono">${e}</div>`).join('')}</div>
    <div class="meta-grid">
      <div><h4>Units</h4><ul>${m.units.map((u) => `<li>${u}</li>`).join('')}</ul></div>
      <div><h4>Assumptions</h4><ul>${m.assumptions.map((u) => `<li>${u}</li>`).join('')}</ul></div>
    </div>
    <div class="meta-valid"><h4>Validity</h4><p>${m.validity}</p></div>
    <div class="meta-lim"><h4>Model limitations</h4><ul>${m.limitations.map((u) => `<li>${u}</li>`).join('')}</ul></div>
    <div class="meta-ref">Ref: ${m.reference}</div>
  </div>`;
}
