import type { Params } from '../app/state';
import { beamSolution } from '../app/system';
import { tangentPlaneKm } from '../models/array-factor';
import { canonicalOrbit } from '../models/frames';
import { h } from './dom';

const W = 156;
const H = 92;
const PAD = 12;
const NICE_KM = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * "Footprint detail · enlarged": the same spherical −3 dB footprint the 3D poster draws
 * (shared BeamSolution), projected into the solver's own local tangent plane at the beam
 * centre (x along-track, y across) with ONE scale for both axes and a km scale bar.
 * Redrawn only when the parameters change — no animation loop, no extra beam solve.
 */
export class FootprintInset {
  readonly el: HTMLElement;
  private svg: HTMLElement;
  private caption: HTMLElement;
  private key = '';

  constructor() {
    this.el = h('figure', 'fp-inset');
    this.el.setAttribute('aria-label', 'Footprint detail, enlarged');
    this.el.innerHTML = `<figcaption class="fp-title">FOOTPRINT DETAIL · ENLARGED</figcaption><div class="fp-svg"></div><div class="fp-cap"></div>`;
    this.svg = this.el.querySelector('.fp-svg')!;
    this.caption = this.el.querySelector('.fp-cap')!;
  }

  render(p: Params): void {
    const b = beamSolution(p);
    const f = b.footprint;
    const key = `${p.arrayN}|${p.spacingLambda}|${p.steerDeg}|${p.steerAzDeg}|${p.weighting}|${p.altitudeKm}|${p.freqGHz}`;
    if (key === this.key) return;
    this.key = key;
    if (!f.center || f.contour.length < 3) {
      this.svg.innerHTML = '';
      this.caption.textContent = 'Beam centre misses the Earth — no footprint';
      return;
    }
    // exactly the plane the solver measures alongTrackKm / crossTrackKm in
    const pts = tangentPlaneKm(f.contour, f.center, canonicalOrbit(p.altitudeKm).x);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0), minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);
    // one scale for both axes (px per km): the shape is never stretched
    const s = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1e-6), (H - 2 * PAD - 12) / Math.max(maxY - minY, 1e-6));
    const ox = W / 2 - ((minX + maxX) / 2) * s;
    const oy = (H - 12) / 2 - ((minY + maxY) / 2) * s;
    const X = (x: number) => (ox + x * s).toFixed(1);
    const Y = (y: number) => (oy - y * s).toFixed(1);
    const poly = pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
    const bar = [...NICE_KM].reverse().find((km) => km * s <= W * 0.42) ?? NICE_KM[0];
    const bx = PAD;
    const by = H - 6;
    this.svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="−3 dB footprint outline with the beam-centre terminal; scale bar ${bar} km">
      <polygon class="fp-area" points="${poly}"/>
      <circle class="fp-term" cx="${X(0)}" cy="${Y(0)}" r="2.6"/>
      <text class="fp-tlabel" x="${X(0)}" y="${(+Y(0) - 5).toFixed(1)}" text-anchor="middle">terminal</text>
      <line class="fp-bar" x1="${bx}" y1="${by}" x2="${(bx + bar * s).toFixed(1)}" y2="${by}"/>
      <text class="fp-blabel" x="${(bx + bar * s + 4).toFixed(1)}" y="${by + 3}">${bar} km</text>
      <text class="fp-axis" x="${W - 4}" y="${by + 3}" text-anchor="end">along-track →</text>
    </svg>`;
    this.caption.innerHTML = `<b>−3 dB</b> outline · ${Math.round(f.alongTrackKm)} × ${Math.round(f.crossTrackKm)} km`;
  }
}
