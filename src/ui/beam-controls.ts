import { BEAM_PRESETS } from '../app/beam-presets';
import type { AppState, Params, Store } from '../app/state';
import { beamSolution } from '../app/system';
import type { Weighting } from '../models/array-factor';
import type { BeamSolution } from '../models/beam-solution';
import { fx, h, segmented, slider } from './dom';

const BEAM_KEYS = ['params.arrayN', 'params.spacingLambda', 'params.steerDeg', 'params.steerAzDeg', 'params.weighting', 'params.altitudeKm', 'params.freqGHz', 'params.paOutW', 'params.totalRfW', 'params.powerMode', 'params.rxGainDbi', 'params.modulation'];
export const beamChanged = (c: Set<string>): boolean => c.has('init') || BEAM_KEYS.some((k) => c.has(k));

export const km = (v: number): string => (Number.isFinite(v) ? (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) : '—');
export const km2 = (v: number): string => (!Number.isFinite(v) ? '—' : v >= 1e5 ? `${(v / 1e3).toFixed(0)}k` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString('en-US'));
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${fx(v, d)}`;
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Satcom band name for a downlink frequency (GHz). */
export function bandName(fGHz: number): string {
  return fGHz < 14.5 ? 'Ku-band' : fGHz < 17.7 ? 'K-band' : 'Ka-band';
}

/** Lobe direction as θ from boresight and φ in the array plane. */
function lobeAngles(d: [number, number, number]): string {
  const th = deg(Math.acos(Math.max(-1, Math.min(1, d[1]))));
  const ph = (deg(Math.atan2(d[2], d[0])) + 360) % 360;
  return `θ ${th.toFixed(0)}°, φ ${ph.toFixed(0)}°`;
}

/**
 * Explicit RF-power assumption. The element count changes both directivity and
 * — in per-element mode — total RF power; the mode switch makes that visible.
 */
export function powerControls(store: Store): { el: HTMLElement; update: (s: AppState) => void } {
  const el = h('div', 'power-ctl');
  const p0 = store.get().params;
  const mode = segmented('RF power assumption', [{ value: 'per-element-fixed', label: 'Fixed per element' }, { value: 'total-rf-fixed', label: 'Fixed total RF' }] as const, p0.powerMode, (v) => store.setParams({ powerMode: v }));
  const pa = slider({ label: 'PA output per element', min: 0.1, max: 4, step: 0.05, value: p0.paOutW, unit: 'W', format: (v) => v.toFixed(2), onInput: (v) => store.setParams({ paOutW: v }) });
  const tot = slider({ label: 'Total RF output', min: 16, max: 2048, step: 8, value: p0.totalRfW, unit: 'W', onInput: (v) => store.setParams({ totalRfW: v }) });
  const note = h('p', 'note');
  el.append(mode.el, pa.el, tot.el, note);
  return {
    el,
    update: (s) => {
      const q = s.params;
      const b = beamSolution(q);
      mode.set(q.powerMode);
      pa.set(q.paOutW);
      tot.set(q.totalRfW);
      const per = q.powerMode === 'per-element-fixed';
      pa.el.style.display = per ? '' : 'none';
      tot.el.style.display = per ? 'none' : '';
      note.innerHTML = per
        ? `Total RF = ${fx(b.power.perElementW, 2)} W × ${b.power.elements} elements = <b>${fx(b.power.rfW, 0)} W</b>. Changing N changes directivity <i>and</i> total power.`
        : `Per element = ${fx(b.power.rfW, 0)} W / ${b.power.elements} = <b>${fx(b.power.perElementW, 3)} W</b>. Changing N changes directivity only.`;
    },
  };
}

/**
 * The four hero controls (STEER, ARRAY SIZE, SPACING, TAPER), validated presets,
 * the grating-lobe experiment and the taper trade-off — all reading one BeamSolution.
 */
export function beamHero(store: Store): { el: HTMLElement; update: (s: AppState, c: Set<string>) => void } {
  const el = h('div', 'beam-hero');
  const p0 = store.get().params;
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const presets = h('div', 'presets');
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Beam experiments');
  for (const pr of BEAM_PRESETS) {
    const b = h('button', `preset preset-${pr.id}`, pr.label);
    b.type = 'button';
    b.title = pr.why;
    b.setAttribute('aria-label', `${pr.label}: ${pr.why}`);
    b.addEventListener('click', () => store.setParams(pr.params));
    presets.append(b);
  }
  const steer = slider({ label: 'STEER θ₀', min: -60, max: 60, step: 1, value: p0.steerDeg, unit: '°', onInput: set('steerDeg') });
  const size = segmented('ARRAY SIZE', [8, 16, 32].map((n) => ({ value: n, label: `${n}×${n}` })), p0.arrayN, (v) => store.setParams({ arrayN: v }));
  const spacing = slider({ label: 'SPACING d', min: 0.25, max: 1.2, step: 0.01, value: p0.spacingLambda, unit: 'λ', format: (v) => v.toFixed(2), onInput: set('spacingLambda') });
  const limit = h('div', 'ctl-limit');
  const taper = segmented<Weighting>('TAPER', [{ value: 'uniform', label: 'Uniform' }, { value: 'hamming', label: 'Hamming' }, { value: 'hann', label: 'Hann' }], p0.weighting, (v) => store.setParams({ weighting: v }));
  const metrics = h('div', 'bm-grid');
  metrics.setAttribute('aria-live', 'polite');
  const warn = h('div', 'gl-warn');
  warn.setAttribute('role', 'status');
  const compare = h('div', 'taper-compare');
  compare.style.display = 'none';
  warn.style.display = 'none';
  const legend = h('div', 'phase-legend', '<span>Element phase (patch colour) — cyclic</span><i aria-hidden="true"></i><div><span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span></div>');
  el.append(presets, steer.el, size.el, spacing.el, limit, taper.el, metrics, warn, compare, legend);

  let prevWeighting = p0.weighting;
  let prev: BeamSolution | null = null;
  const tile = (label: string, value: string, unit: string, title: string) => `<div class="bm" title="${title}"><span>${label}</span><b>${value}</b><em>${unit}</em></div>`;

  return {
    el,
    update: (s, c) => {
      const q = s.params;
      steer.set(q.steerDeg);
      spacing.set(q.spacingLambda);
      size.set(q.arrayN);
      taper.set(q.weighting);
      if (!beamChanged(c)) return;
      const b = beamSolution(q);
      const P = b.pattern;
      const f = b.footprint;
      limit.innerHTML = `Grating-lobe limit at θ₀ = ${q.steerDeg}°: d/λ &lt; <b>${P.gratingLimit.toFixed(2)}</b>`;
      limit.classList.toggle('over', P.gratingLobe);
      metrics.innerHTML = [
        tile('GAIN', fx(P.gainDbi, 1), 'dBi', 'Directivity integrated from |AF·EP|² × 70 % efficiency'),
        tile('HPBW', fx(P.hpbwDeg, 1), '°', 'Half-power beamwidth in the steering plane'),
        tile('SIDELOBE', fx(P.sidelobeDb, 1), 'dB', 'Peak sidelobe outside the main lobe (steering-plane cut)'),
        tile('FOOTPRINT', f.center ? `${km(f.alongTrackKm)} × ${km(f.crossTrackKm)}` : 'off Earth', 'km', 'Along-track × cross-track extent of the −3 dB contour on the spherical Earth'),
        tile('AREA', f.contour.length >= 3 ? km2(f.areaKm2) : '—', 'km²', 'Area of the −3 dB footprint (local tangent plane)'),
        tile('EIRP', fx(b.power.eirpDbw, 1), 'dBW', 'EIRP = 10·log10(P_RF) + G'),
        tile('MARGIN', b.link ? sgn(b.link.marginDb) : '—', 'dB', b.link ? `Link to the beam centre at El ${b.link.elevationDeg.toFixed(0)}°` : 'Beam centre is above the horizon: no link'),
      ].join('');
      metrics.classList.toggle('neg', !b.link || b.link.marginDb < 0);
      // grating-lobe experiment: what the model finds, never an assumed consequence
      if (b.lobes.length) {
        const L = b.lobes[0];
        const sec = b.secondary.find((x) => x.lobe === L);
        const ground = sec
          ? `It reaches the Earth: a second −3 dB footprint ${km(sec.earth.nadirOffsetKm ?? 0)} km from nadir (amber) — signals there are indistinguishable from the main beam.`
          : L.levelDb < -10
            ? 'It is weak here (outside the element pattern), so no ground footprint is drawn.'
            : 'It points above the horizon, so it illuminates no ground area.';
        warn.innerHTML = `<b>⚠ Grating lobe</b> d/λ = ${q.spacingLambda.toFixed(2)} ≥ ${P.gratingLimit.toFixed(2)}: a second beam at ${lobeAngles(L.axis)}, ${fx(L.levelDb, 1)} dB relative to the main beam. Power leaves in the wrong direction (gain ${fx(P.gainDbi, 1)} dBi). ${ground}`;
        warn.style.display = '';
      } else warn.style.display = 'none';
      // taper trade-off: calculated before/after when the weighting changes
      if (c.has('params.weighting') && prev && prevWeighting !== q.weighting) {
        const a = prev;
        compare.innerHTML = `<b>${prevWeighting} → ${q.weighting}</b> SLL ${fx(a.pattern.sidelobeDb, 1)} → ${fx(P.sidelobeDb, 1)} dB · HPBW ${fx(a.pattern.hpbwDeg, 1)} → ${fx(P.hpbwDeg, 1)}° · area ${km2(a.footprint.areaKm2)} → ${km2(f.areaKm2)} km²`;
        compare.style.display = '';
      } else if (!c.has('params.weighting') && (c.has('params.arrayN') || c.has('params.spacingLambda') || c.has('params.steerDeg'))) compare.style.display = 'none';
      prevWeighting = q.weighting;
      prev = b;
    },
  };
}

/**
 * Array Compare: 8×8 vs 32×32 for the current spacing, steering and taper, under an
 * explicit RF-power assumption (default: total RF fixed, so only the aperture differs).
 * Numbers come from the same beam model; "Show" applies a size to the live scene.
 */
export function arrayCompare(store: Store): { el: HTMLElement; update: (s: AppState, c: Set<string>) => void } {
  const el = h('div', 'compare');
  let mode: 'total-rf-fixed' | 'per-element-fixed' = 'total-rf-fixed';
  const modeSel = segmented('Power assumption for the comparison', [{ value: 'total-rf-fixed', label: 'Total RF fixed' }, { value: 'per-element-fixed', label: 'Per element fixed' }] as const, mode, (v) => {
    mode = v;
    render(store.get());
  });
  const table = h('div', 'cmp-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Array size comparison');
  const chain = h('p', 'note cmp-chain');
  const show = h('div', 'cmp-show');
  for (const n of [8, 32]) {
    const b = h('button', 'pst-btn', `Show ${n}×${n}`);
    b.type = 'button';
    b.addEventListener('click', () => store.setParams({ arrayN: n, powerMode: mode }));
    show.append(b);
  }
  el.append(modeSel.el, table, show, chain);
  const render = (s: AppState) => {
    const q = s.params;
    const A = beamSolution({ ...q, arrayN: 8, powerMode: mode });
    const B = beamSolution({ ...q, arrayN: 32, powerMode: mode });
    const row = (label: string, a: string, b: string, d: string) => `<div class="cmp-row" role="row"><span role="rowheader">${label}</span><b role="cell">${a}</b><b role="cell">${b}</b><em role="cell">${d}</em></div>`;
    const dd = (x: number, y: number, dgt = 1, unit = '') => `${y - x >= 0 ? '+' : '−'}${Math.abs(y - x).toFixed(dgt)}${unit}`;
    const ratio = (x: number, y: number) => (x > 0 ? `×${(y / x).toFixed(2)}` : '—');
    const LA = A.link;
    const LB = B.link;
    table.innerHTML =
      `<div class="cmp-row cmp-head" role="row"><span></span><b role="columnheader">8×8</b><b role="columnheader">32×32</b><em role="columnheader">change</em></div>` +
      row('Aperture', `${(8 * q.spacingLambda).toFixed(1)}λ`, `${(32 * q.spacingLambda).toFixed(1)}λ`, '×4') +
      row('Gain', `${A.pattern.gainDbi.toFixed(1)} dBi`, `${B.pattern.gainDbi.toFixed(1)} dBi`, dd(A.pattern.gainDbi, B.pattern.gainDbi, 1, ' dB')) +
      row('HPBW', `${A.pattern.hpbwDeg.toFixed(1)}°`, `${B.pattern.hpbwDeg.toFixed(1)}°`, ratio(A.pattern.hpbwDeg, B.pattern.hpbwDeg)) +
      row('Footprint area', `${km2(A.footprint.areaKm2)} km²`, `${km2(B.footprint.areaKm2)} km²`, ratio(A.footprint.areaKm2, B.footprint.areaKm2)) +
      row('Total RF', `${A.power.rfW.toFixed(0)} W`, `${B.power.rfW.toFixed(0)} W`, ratio(A.power.rfW, B.power.rfW)) +
      row('EIRP', `${A.power.eirpDbw.toFixed(1)} dBW`, `${B.power.eirpDbw.toFixed(1)} dBW`, dd(A.power.eirpDbw, B.power.eirpDbw, 1, ' dB')) +
      row('Link margin', LA ? `${sgn(LA.marginDb)} dB` : '—', LB ? `${sgn(LB.marginDb)} dB` : '—', LA && LB ? dd(LA.marginDb, LB.marginDb, 1, ' dB') : '—');
    chain.innerHTML =
      mode === 'total-rf-fixed'
        ? 'ARRAY SIZE ↑ → APERTURE ↑ → DIRECTIVITY ↑ → HPBW ↓ → FOOTPRINT ↓ (same total RF power: the difference is the aperture alone).'
        : 'Per element fixed: ARRAY SIZE ↑ → ELEMENT COUNT ↑ → TOTAL RF POWER ↑ <i>and</i> DIRECTIVITY ↑ — EIRP grows by both effects.';
  };
  let timer = 0;
  return {
    el,
    update: (_s, c) => {
      if (!beamChanged(c) && !c.has('init')) return;
      // two extra pattern solves: deferred while a slider is being dragged
      clearTimeout(timer);
      timer = window.setTimeout(() => render(store.get()), c.has('init') ? 0 : 160);
    },
  };
}
