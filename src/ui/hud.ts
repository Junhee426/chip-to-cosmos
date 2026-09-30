import { LEVELS, MAIN_CHAIN, breadcrumb, depth, formatLength, type LevelId } from '../app/navigation';
import type { AppState, EngMode, Quality, Store } from '../app/state';
import { LEVEL_KEY_PARAM } from './summary';
import { systemInput } from '../app/system';
import { THEORY } from '../content/theory';
import type { ModelMeta } from '../models/meta';
import { SIGNAL_CHAIN } from '../models/rf';
import { evaluateSystem } from '../models/system-model';
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
}

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
    this.labelsBtn.addEventListener('click', () => store.set({ labels: !store.get().labels }));
    const intro = h('button', 'tool-btn', '▶ Intro');
    intro.addEventListener('click', () => cb.replayIntro());
    this.fps = h('span', 'fps');
    this.qualityNote = h('span', 'quality-note');
    tools.append(this.fps, this.qualityNote, this.labelsBtn, this.quality, intro);
    const back = h('button', 'icon-btn nav-back', '‹');
    back.setAttribute('aria-label', 'Zoom out to parent scale');
    back.addEventListener('click', () => cb.back());
    const menu = h('button', 'icon-btn nav-menu', '⋯');
    menu.setAttribute('aria-label', 'Menu: scale, modes, view, quality');
    menu.setAttribute('aria-expanded', 'false');
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
    this.rail = rail;
    rail.append(h('div', 'rail-title', 'SCALE'));
    this.ladder = h('ol', 'ladder');
    rail.append(this.ladder);
    rail.append(h('div', 'rail-title', 'ENGINEERING MODE'));
    const modes = h('div', 'modes');
    for (const m of MODES) {
      const b = h('button', `mode mode-${m.id}`, `<i></i>${m.label}<kbd>${m.key}</kbd>`);
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
    this.cutaway.addEventListener('click', () => store.set({ cutaway: !store.get().cutaway }));
    rail.append(ex, this.cutaway);

    // --- right panel ---
    const panel = h('aside', 'panel');
    panel.setAttribute('aria-label', 'Selected part and level information');
    this.panel = panel;
    this.sheetHandle = h('button', 'sheet-handle', '<span></span>');
    this.sheetHandle.setAttribute('aria-label', 'Expand details');
    this.sheetHandle.setAttribute('aria-expanded', 'false');
    this.sheetHandle.addEventListener('click', () => this.setSheet(!this.sheetExpanded));
    this.summary = h('div', 'sheet-summary');
    this.panelHead = h('div', 'panel-head');
    this.info = h('div', 'info');
    this.tabs = h('div', 'tabs');
    for (const t of ['intuition', 'engineering', 'theory'] as const) {
      const b = h('button', 'tab', t.toUpperCase());
      b.dataset.tab = t;
      b.addEventListener('click', () => store.set({ theoryTab: t }));
      this.tabs.append(b);
    }
    this.tabBody = h('div', 'tab-body');
    this.analysisHost = h('div', 'analysis');
    panel.append(this.sheetHandle, this.summary, this.panelHead, this.info, this.tabs, this.tabBody, this.analysisHost);

    // --- bottom: scale bar + coupling ---
    const scale = h('div', 'scale');
    this.scaleBar = h('div', 'scale-bar');
    this.scaleText = h('div', 'scale-text');
    this.scaleTag = h('div', 'scale-tag');
    scale.append(this.scaleBar, this.scaleText, this.scaleTag);
    this.coupling = h('div', 'coupling');
    const hint = h('div', 'hint', 'Drag to orbit · scroll to zoom · <b>double-click</b> a part to dive in · <b>Esc</b> to zoom out');

    this.perf = h('pre', 'perf-overlay');
    this.perf.hidden = true;
    this.toastEl = h('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.root.append(top, rail, panel, scale, this.coupling, hint, this.perf, this.toastEl);
    const ro = new ResizeObserver(() => cb.layout());
    for (const el of [top, rail, panel, this.coupling]) ro.observe(el);
    const mq = window.matchMedia('(max-width: 900px)');
    const place = () => this.placeForViewport(mq.matches);
    mq.addEventListener('change', place);
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
      li.innerHTML = `<span class="rung-dot"></span><span class="rung-name">${LEVELS[id].crumb}</span><span class="rung-scale">${rungScale(id)}</span>`;
      li.addEventListener('click', () => this.cb.navigate(id));
      this.ladder.append(li);
    }
  }

  private onState(s: AppState, c: Set<string>): void {
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
      }
      this.root.classList.toggle('transitioning', s.transitioning);
    }
    if (c.has('level')) this.buildPanel(s);
    if (c.has('mode')) for (const [m, b] of this.modeBtns) b.classList.toggle('on', m === s.mode);
    if (c.has('explode')) {
      this.explode.value = String(s.explode);
      this.explodeVal.textContent = `${Math.round(s.explode * 100)} %`;
    }
    if (c.has('cutaway')) this.cutaway.classList.toggle('on', s.cutaway);
    if (c.has('labels')) this.labelsBtn.classList.toggle('on', s.labels);
    if (c.has('quality')) this.quality.value = s.quality;
    if (c.has('theoryTab') || c.has('level')) this.renderTab(s);
    if (c.has('selected') || c.has('level')) this.renderInfo(s);
    if (c.has('selected') || c.has('level') || c.has('params')) this.renderSummary(s);
    if (c.has('level')) this.root.classList.remove('menu-open');
    if (this.analysis && (c.has('params') || c.has('init'))) this.analysis.update(s, c);
    if (c.has('params') || c.has('init')) this.renderCoupling(s);
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
    for (const b of this.tabs.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('on', b.dataset.tab === s.theoryTab);
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

  private renderCoupling(s: AppState): void {
    const p = s.params;
    const key = JSON.stringify(p);
    if (key === this.couplingKey) return;
    this.couplingKey = key;
    const sys = evaluateSystem(systemInput(p));
    const pill = (label: string, value: string, go?: LevelId) => `<button class="pill"${go ? ` data-go="${go}"` : ''}><span>${label}</span><b>${value}</b></button>`;
    const arrow = '<span class="pill-arrow">→</span>';
    this.coupling.innerHTML = `
      <div class="chain"><span class="chain-name">CHIP → HEAT</span>${[
        pill('ADC', `${p.adcBits} bit · ${p.adcFsMsps} MS/s`, 'payload'),
        pill('SNRq', `${fx(sys.quantSnrDb, 1)} dB`),
        pill('ADC+DSP', `${fx(sys.adcPowerW + sys.dspPowerW, 0)} W`, 'die'),
        pill('Payload DC', `${fx(sys.payloadDcW, 0)} W`, 'satellite'),
        pill('Heat', `${fx(sys.heatW, 0)} W`),
        pill('Radiator', `${fx(sys.radiatorM2, 2)} m²`, 'satellite'),
      ].join(arrow)}</div>
      <div class="chain"><span class="chain-name">BEAM → LINK</span>${[
        pill('Array', `${p.arrayN}×${p.arrayN} · ${p.steerDeg}°`, 'array'),
        pill('Gain', `${fx(sys.gainDbi, 1)} dBi`),
        pill('EIRP', `${fx(sys.eirpDbw, 1)} dBW`),
        pill('Pr', `${fx(sys.link.rxPowerDbm, 1)} dBm`, 'cosmos'),
        pill('Margin', `${sys.link.marginDb >= 0 ? '+' : ''}${fx(sys.link.marginDb, 1)} dB`, 'cosmos'),
      ].join(arrow)}</div>`;
    this.coupling.classList.toggle('neg', sys.link.marginDb < 0 || sys.powerMarginW < 0);
    for (const b of this.coupling.querySelectorAll<HTMLElement>('[data-go]')) b.addEventListener('click', () => this.cb.navigate(b.dataset.go as LevelId));
    this.coupling.classList.remove('flash');
    void this.coupling.offsetWidth;
    this.coupling.classList.add('flash');
  }

  /** Mobile is not a shrunk desktop: tools and the coupling strip move into the menu / sheet. */
  private placeForViewport(mobile: boolean): void {
    this.mobile = mobile;
    this.root.classList.toggle('is-mobile', mobile);
    if (mobile) {
      this.rail.append(this.tools);
      this.panel.append(this.coupling);
    } else {
      this.top.insertBefore(this.tools, this.top.lastElementChild);
      this.root.append(this.coupling);
      this.setSheet(false);
    }
    this.cb.layout();
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
        ${child ? `<button class="sum-btn primary" data-act="enter">Internal view · ${LEVELS[child].crumb} ›</button>` : ''}
        <button class="sum-btn" data-act="experiment">Experiment</button>
      </div>`;
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
    const top = this.top.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    if (this.mobile) return { top: top.bottom + 8, right: 12, bottom: H - panel.top + 8, left: 12 };
    const rail = this.rail.getBoundingClientRect();
    const coupling = this.coupling.getBoundingClientRect();
    return { top: Math.max(top.bottom, 64) + 8, right: W - panel.left + 12, bottom: H - coupling.top + 12, left: rail.right + 12 };
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
