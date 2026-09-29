import { fmtTick, logTicks, makeScale, niceTicks, type Scale } from './scale';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export interface Series {
  id: string;
  name: string;
  /** CSS colour token, e.g. 'var(--series-1)' */
  color: string;
  points: [number, number][];
  dash?: string;
  width?: number;
  step?: boolean;
  dots?: boolean;
}

export interface Marker {
  x: number;
  y: number;
  color?: string;
  label?: string;
}

export interface LineChartOptions {
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  yLog?: boolean;
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  bands?: { x0: number; x1: number; label: string }[];
}

const M = { l: 46, r: 12, t: 10, b: 34 };

/** Multi-series line chart with crosshair tooltip, legend and operating-point markers. */
export class LineChart {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private tip: HTMLDivElement;
  private legend: HTMLDivElement;
  private series: Series[] = [];
  private x!: Scale;
  private y!: Scale;
  private w = 320;
  private h: number;

  constructor(private opts: LineChartOptions) {
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.legend = document.createElement('div');
    this.legend.className = 'chart-legend';
    this.svg = el('svg', { class: 'chart-svg' });
    this.h = opts.height ?? 190;
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.el.append(this.legend, this.svg, this.tip);
    this.svg.addEventListener('pointermove', (e) => this.hover(e));
    this.svg.addEventListener('pointerleave', () => this.clearHover());
  }

  update(series: Series[], markers: Marker[] = [], opts?: Partial<LineChartOptions>): void {
    if (opts) this.opts = { ...this.opts, ...opts };
    this.series = series;
    const o = this.opts;
    this.w = Math.max(240, this.el.clientWidth || 320);
    const W = this.w;
    const H = this.h;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.innerHTML = '';
    const all = series.flatMap((s) => s.points);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]).filter((v) => (o.yLog ? v > 0 : Number.isFinite(v)));
    const xd: [number, number] = o.xDomain ?? [Math.min(...xs), Math.max(...xs)];
    let yd: [number, number] = o.yDomain ?? [Math.min(0, ...ys), Math.max(...ys) * 1.08 || 1];
    if (o.yLog && !o.yDomain) yd = [Math.max(Math.min(...ys), 1e-30), Math.max(...ys) * 2];
    this.x = makeScale(xd, [M.l, W - M.r]);
    this.y = makeScale(yd, [H - M.b, M.t], o.yLog);
    const g = el('g', {}, this.svg);
    // bands
    for (const b of o.bands ?? []) {
      const x0 = this.x(Math.max(b.x0, xd[0]));
      const x1 = this.x(Math.min(b.x1, xd[1]));
      if (x1 <= x0) continue;
      el('rect', { x: x0, y: M.t, width: x1 - x0, height: H - M.b - M.t, class: 'chart-band' }, g);
      const t = el('text', { x: (x0 + x1) / 2, y: M.t + 11, class: 'chart-band-label', 'text-anchor': 'middle' }, g);
      t.textContent = b.label;
    }
    // grid + ticks
    const xt = niceTicks(xd[0], xd[1], 5);
    const yt = o.yLog ? logTicks(yd[0], yd[1]) : niceTicks(yd[0], yd[1], 4);
    for (const v of yt) {
      const py = this.y(v);
      el('line', { x1: M.l, x2: W - M.r, y1: py, y2: py, class: 'chart-grid' }, g);
      const t = el('text', { x: M.l - 6, y: py + 3.5, class: 'chart-tick', 'text-anchor': 'end' }, g);
      t.textContent = (o.yFormat ?? fmtTick)(v);
    }
    for (const v of xt) {
      const px = this.x(v);
      el('line', { x1: px, x2: px, y1: H - M.b, y2: H - M.b + 4, class: 'chart-axis' }, g);
      const t = el('text', { x: px, y: H - M.b + 15, class: 'chart-tick', 'text-anchor': 'middle' }, g);
      t.textContent = (o.xFormat ?? fmtTick)(v);
    }
    el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'chart-axis' }, g);
    const xl = el('text', { x: (M.l + W - M.r) / 2, y: H - 4, class: 'chart-label', 'text-anchor': 'middle' }, g);
    xl.textContent = o.xLabel;
    const yl = el('text', { x: 11, y: (H - M.b + M.t) / 2, class: 'chart-label', 'text-anchor': 'middle', transform: `rotate(-90 11 ${(H - M.b + M.t) / 2})` }, g);
    yl.textContent = o.yLabel;
    // clip
    const clipId = `c${Math.random().toString(36).slice(2, 8)}`;
    const defs = el('defs', {}, this.svg);
    const cp = el('clipPath', { id: clipId }, defs);
    el('rect', { x: M.l, y: M.t - 2, width: W - M.l - M.r, height: H - M.b - M.t + 2 }, cp);
    const plot = el('g', { 'clip-path': `url(#${clipId})` }, this.svg);
    for (const s of series) {
      if (!s.points.length) continue;
      if (s.dots) {
        for (const [px, py] of s.points) el('circle', { cx: this.x(px), cy: this.y(py), r: 2.4, style: `fill:${s.color}` }, plot);
        continue;
      }
      let d = '';
      s.points.forEach(([px, py], i) => {
        const X = this.x(px).toFixed(1);
        const Y = this.y(o.yLog ? Math.max(py, yd[0] * 1e-3) : py).toFixed(1);
        if (i === 0) d += `M${X},${Y}`;
        else if (s.step) d += `H${X}V${Y}`;
        else d += `L${X},${Y}`;
      });
      el('path', { d, class: 'chart-line', style: `stroke:${s.color};stroke-width:${s.width ?? 2}px;${s.dash ? `stroke-dasharray:${s.dash}` : ''}` }, plot);
    }
    for (const mk of markers) {
      if (!(mk.x >= xd[0] && mk.x <= xd[1])) continue;
      const cx = this.x(mk.x);
      const cy = this.y(o.yLog ? Math.max(mk.y, yd[0]) : mk.y);
      el('line', { x1: cx, x2: cx, y1: cy, y2: H - M.b, class: 'chart-guide' }, plot);
      el('circle', { cx, cy, r: 5.5, class: 'chart-marker', style: `fill:${mk.color ?? 'var(--accent)'}` }, plot);
      if (mk.label) {
        const t = el('text', { x: Math.min(cx + 8, W - M.r - 4), y: Math.max(cy - 8, M.t + 10), class: 'chart-marker-label', 'text-anchor': cx > W * 0.7 ? 'end' : 'start' }, plot);
        if (cx > W * 0.7) t.setAttribute('x', String(cx - 8));
        t.textContent = mk.label;
      }
    }
    el('line', { class: 'chart-cross', x1: 0, x2: 0, y1: M.t, y2: H - M.b, visibility: 'hidden' }, this.svg);
    this.legend.innerHTML = series.length >= 2 ? series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') : '';
  }

  private hover(e: PointerEvent): void {
    if (!this.series.length) return;
    const rect = this.svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.w;
    if (px < M.l || px > this.w - M.r) return this.clearHover();
    const xv = this.x.invert(px);
    const cross = this.svg.querySelector('.chart-cross') as SVGLineElement;
    cross.setAttribute('x1', String(px));
    cross.setAttribute('x2', String(px));
    cross.setAttribute('visibility', 'visible');
    const rows = this.series
      .filter((s) => s.points.length && !s.dots)
      .map((s) => {
        let best = s.points[0];
        for (const p of s.points) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
        return `<div><i style="background:${s.color}"></i>${s.name}: <b>${(this.opts.yFormat ?? fmtTick)(best[1])}</b></div>`;
      });
    this.tip.innerHTML = `<div class="tip-x">${this.opts.xLabel}: ${(this.opts.xFormat ?? fmtTick)(xv)}</div>${rows.join('')}`;
    this.tip.style.display = 'block';
    const left = (px / this.w) * rect.width;
    this.tip.style.left = `${Math.min(left + 12, rect.width - 150)}px`;
    this.tip.style.top = `${24}px`;
  }

  private clearHover(): void {
    this.tip.style.display = 'none';
    this.svg.querySelector('.chart-cross')?.setAttribute('visibility', 'hidden');
  }
}

/** Half-plane polar radiation plot: boresight up, θ ∈ [−90°, 90°], radial dB. */
export class PolarChart {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private tip: HTMLDivElement;
  private data: { thetaDeg: number; db: number }[] = [];

  constructor(private size = 300) {
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.svg = el('svg', { class: 'chart-svg', viewBox: `0 0 ${size} ${size * 0.62}` });
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.el.append(this.svg, this.tip);
    this.svg.addEventListener('pointermove', (e) => this.hover(e));
    this.svg.addEventListener('pointerleave', () => (this.tip.style.display = 'none'));
  }

  private geom() {
    const cx = this.size / 2;
    const cy = this.size * 0.58;
    const R = this.size * 0.5 - 14;
    return { cx, cy, R };
  }

  update(cut: { thetaDeg: number; db: number }[], steerDeg: number, floor = -40): void {
    this.data = cut;
    const { cx, cy, R } = this.geom();
    this.svg.innerHTML = '';
    const g = el('g', {}, this.svg);
    for (const db of [0, -10, -20, -30, -40].filter((d) => d >= floor)) {
      const r = (R * (db - floor)) / -floor;
      el('path', { d: `M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`, class: 'chart-grid', fill: 'none' }, g);
      const t = el('text', { x: cx + 3, y: cy - r - 2, class: 'chart-tick' }, g);
      t.textContent = `${db} dB`;
    }
    for (const a of [-90, -60, -30, 0, 30, 60, 90]) {
      const th = (a * Math.PI) / 180;
      el('line', { x1: cx, y1: cy, x2: cx + R * Math.sin(th), y2: cy - R * Math.cos(th), class: 'chart-grid' }, g);
      const t = el('text', { x: cx + (R + 9) * Math.sin(th), y: cy - (R + 9) * Math.cos(th) + 3, class: 'chart-tick', 'text-anchor': 'middle' }, g);
      t.textContent = `${a}°`;
    }
    let d = '';
    cut.forEach((p, i) => {
      const r = (R * Math.max(0, p.db - floor)) / -floor;
      const th = (p.thetaDeg * Math.PI) / 180;
      d += `${i ? 'L' : 'M'}${(cx + r * Math.sin(th)).toFixed(1)},${(cy - r * Math.cos(th)).toFixed(1)}`;
    });
    el('path', { d, class: 'chart-line chart-fill', style: 'stroke:var(--series-1);stroke-width:2px' }, g);
    const st = (steerDeg * Math.PI) / 180;
    el('line', { x1: cx, y1: cy, x2: cx + R * Math.sin(st), y2: cy - R * Math.cos(st), class: 'chart-guide', style: 'stroke:var(--accent)' }, g);
  }

  private hover(e: PointerEvent): void {
    const rect = this.svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * this.size;
    const sy = ((e.clientY - rect.top) / rect.height) * this.size * 0.62;
    const { cx, cy } = this.geom();
    const th = (Math.atan2(sx - cx, cy - sy) * 180) / Math.PI;
    if (Math.abs(th) > 90 || !this.data.length) return;
    let best = this.data[0];
    for (const p of this.data) if (Math.abs(p.thetaDeg - th) < Math.abs(best.thetaDeg - th)) best = p;
    this.tip.innerHTML = `<div class="tip-x">θ = ${best.thetaDeg.toFixed(1)}°</div><div>Normalised gain: <b>${best.db.toFixed(1)} dB</b></div>`;
    this.tip.style.display = 'block';
    this.tip.style.left = `${Math.min(((sx / this.size) * rect.width) + 10, rect.width - 150)}px`;
    this.tip.style.top = '8px';
  }
}

/** I/Q constellation scatter (received cloud + ideal points). */
export class IQChart {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  constructor(size = 220) {
    this.el = document.createElement('div');
    this.el.className = 'chart chart-iq';
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * 2;
    this.canvas.height = size * 2;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.el.appendChild(this.canvas);
  }

  update(received: { i: number; q: number }[], ideal: { i: number; q: number }[], colors: { cloud: string; ideal: string; grid: string; text: string }): void {
    const c = this.canvas.getContext('2d')!;
    const S = this.canvas.width;
    c.clearRect(0, 0, S, S);
    const lim = 1.75;
    const sc = (v: number) => ((v + lim) / (2 * lim)) * S;
    c.strokeStyle = colors.grid;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(S / 2, 0);
    c.lineTo(S / 2, S);
    c.moveTo(0, S / 2);
    c.lineTo(S, S / 2);
    c.stroke();
    c.fillStyle = colors.cloud;
    c.globalAlpha = 0.55;
    for (const p of received) {
      c.beginPath();
      c.arc(sc(p.i), S - sc(p.q), 2.6, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.strokeStyle = colors.ideal;
    c.lineWidth = 3;
    for (const p of ideal) {
      const x = sc(p.i);
      const y = S - sc(p.q);
      c.beginPath();
      c.moveTo(x - 8, y);
      c.lineTo(x + 8, y);
      c.moveTo(x, y - 8);
      c.lineTo(x, y + 8);
      c.stroke();
    }
    c.fillStyle = colors.text;
    c.font = '22px Inter, system-ui, sans-serif';
    c.fillText('I', S - 22, S / 2 - 10);
    c.fillText('Q', S / 2 + 10, 24);
  }
}
