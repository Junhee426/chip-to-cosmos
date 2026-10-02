import type { LevelId } from '../app/navigation';
import type { AppState, Params, Store } from '../app/state';
import { beamSolution, solveSystem } from '../app/system';
import { IQChart, LineChart, PolarChart } from '../charts/charts';
import { adcPowerW, adcTrace, idealSnrDb, nyquistOk } from '../models/adc';
import { linkBudget, slantRangeM } from '../models/link-budget';
import { berTheory, esN0FromEbN0, simulateConstellation, type Modulation } from '../models/modulation';
import { mosfet, sweepVds, sweepVgs } from '../models/mosfet';
import { junctionTemperatures } from '../models/power';
import { DEFAULT_RX_CHAIN, friisCascade, noiseFloorDbm, type RfStage } from '../models/rf';
import { bandGapEv, builtInPotential, diodeCurrent, intrinsicCarrierDensity, junctionProfile } from '../models/semiconductor';
import { formatSI, wavelengthM } from '../models/units';
import { arrayCompare, beamChanged, beamHero, km, km2, powerControls } from './beam-controls';
import { linkXray } from './link-xray';
import { fx, h, readout, section, segmented, slider } from './dom';

export interface Analysis {
  el: HTMLElement;
  update: (s: AppState, changed: Set<string>) => void;
}

const C1 = 'var(--series-1)';
const C2 = 'var(--series-2)';
const C3 = 'var(--series-3)';
const C4 = 'var(--series-4)';

function sci(v: number, d = 2): string {
  if (!Number.isFinite(v) || v === 0) return v === 0 ? '0' : '—';
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${(v / 10 ** e).toFixed(d)}e${e}`;
}

function eqLine(html: string): HTMLElement {
  return h('div', 'eq-live', html);
}

type Builder = (store: Store) => Analysis;

// ---------------------------------------------------------------- MOSFET
const mosfetPanel: Builder = (store) => {
  const root = h('div');
  const p = store.get().params;
  const sec = section('MOSFET operating point', 'educational');
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const sVgs = slider({ label: 'Gate voltage Vgs', min: 0, max: 3, step: 0.02, value: p.vgs, unit: 'V', format: (v) => v.toFixed(2), onInput: set('vgs') });
  const sVds = slider({ label: 'Drain voltage Vds', min: 0, max: 3, step: 0.02, value: p.vds, unit: 'V', format: (v) => v.toFixed(2), onInput: set('vds') });
  const sWl = slider({ label: 'Aspect ratio W/L', min: 1, max: 50, step: 1, value: p.wOverL, onInput: set('wOverL') });
  const sT = slider({ label: 'Temperature', min: 200, max: 450, step: 5, value: p.tempK, unit: 'K', onInput: set('tempK') });
  const ro = readout([
    { key: 'region', label: 'Region' },
    { key: 'id', label: 'Drain current Id' },
    { key: 'vth', label: 'Threshold Vth', unit: 'V' },
    { key: 'vov', label: 'Overdrive Vgs − Vth', unit: 'V' },
    { key: 'gm', label: 'Transconductance gm' },
    { key: 'mu', label: 'Mobility µn', unit: 'cm²/V·s' },
    { key: 'ns', label: 'Channel electrons (source)', unit: 'cm⁻²' },
    { key: 'eox', label: 'Oxide field (Vgs/tox)', unit: 'MV/cm' },
  ]);
  const eq = eqLine('');
  const c1 = new LineChart({ xLabel: 'Vgs (V)', yLabel: 'Id (mA)', height: 170 });
  const c2 = new LineChart({ xLabel: 'Vds (V)', yLabel: 'Id (mA)', height: 170 });
  sec.body.append(sVgs.el, sVds.el, sWl.el, sT.el, ro.el, eq, h('div', 'chart-title', 'Transfer characteristic Id–Vgs'), c1.el, h('div', 'chart-title', 'Output characteristic Id–Vds'), c2.el);
  root.append(sec.el);
  const update = (s: AppState) => {
    const q = s.params;
    sVgs.set(q.vgs); sVds.set(q.vds); sWl.set(q.wOverL); sT.set(q.tempK);
    const base = { vgs: q.vgs, vds: q.vds, wOverL: q.wOverL, tempK: q.tempK };
    const r = mosfet(base);
    ro.set({
      region: r.region === 'cutoff' ? 'Cut-off (no channel)' : r.region === 'triode' ? 'Triode (linear)' : 'Saturation (pinched-off)',
      id: formatSI(r.id, 'A'),
      vth: fx(r.vth, 3),
      vov: fx(r.vov, 3),
      gm: formatSI(r.gm, 'S'),
      mu: fx(r.mu, 0),
      ns: sci(r.nsSource),
      eox: fx(r.eOxVPerCm / 1e6, 2),
    });
    const kp = r.kPrime * 1e6;
    eq.innerHTML = r.region === 'saturation'
      ? `Id ≈ ½·µnCox·(W/L)·(Vgs−Vth)²·(1+λΔV) = ½·${kp.toFixed(0)} µA/V²·${q.wOverL}·(${r.vov.toFixed(2)} V)²·… = <b>${formatSI(r.id, 'A')}</b>`
      : r.region === 'triode'
        ? `Id = µnCox(W/L)[(Vgs−Vth)Vds − Vds²/2] = ${kp.toFixed(0)} µA/V²·${q.wOverL}·[${r.vov.toFixed(2)}·${q.vds.toFixed(2)} − ${q.vds.toFixed(2)}²/2] = <b>${formatSI(r.id, 'A')}</b>`
        : `Vgs = ${q.vgs.toFixed(2)} V < Vth = ${r.vth.toFixed(2)} V → no inversion layer, Id = 0 (subthreshold ignored)`;
    const vg = sweepVgs(base).map(([x, y]) => [x, y * 1e3] as [number, number]);
    c1.update([{ id: 'id', name: `Vds = ${q.vds.toFixed(2)} V`, color: C1, points: vg }], [{ x: q.vgs, y: r.id * 1e3, label: `${(r.id * 1e3).toFixed(2)} mA` }], { yDomain: [0, Math.max(0.5, ...vg.map((v) => v[1])) * 1.1] });
    const fam = [q.vgs, Math.max(0, q.vgs - 0.5), q.vgs + 0.5].map((vgs, i) => ({ id: `v${i}`, name: `Vgs = ${vgs.toFixed(2)} V`, color: [C1, C3, C2][i], dash: i ? '4 3' : undefined, width: i ? 1.5 : 2.2, points: sweepVds({ ...base, vgs }).map(([x, y]) => [x, y * 1e3] as [number, number]) }));
    const sat = Math.max(r.vov, 0);
    c2.update(fam, [{ x: q.vds, y: r.id * 1e3, label: r.region === 'saturation' ? 'sat.' : r.region }], { yDomain: [0, Math.max(0.5, ...fam.flatMap((f) => f.points.map((v) => v[1]))) * 1.1], bands: sat > 0 ? [{ x0: 0, x1: sat, label: 'triode' }] : [] });
  };
  return { el: root, update: (s) => update(s) };
};

// ---------------------------------------------------------------- PAYLOAD
const payloadPanel: Builder = (store) => {
  const root = h('div');
  const p0 = store.get().params;
  // --- Friis ---
  const f = section('Receiver cascade — Friis noise', 'calculated');
  const chain: RfStage[] = DEFAULT_RX_CHAIN.map((s) => ({ ...s }));
  const lnaNf = slider({ label: 'LNA noise figure', min: 0.5, max: 6, step: 0.1, value: chain[1].nfDb, unit: 'dB', format: (v) => v.toFixed(1), onInput: (v) => { chain[1].nfDb = v; drawFriis(); } });
  const lnaG = slider({ label: 'LNA gain', min: 0, max: 35, step: 0.5, value: chain[1].gainDb, unit: 'dB', format: (v) => v.toFixed(1), onInput: (v) => { chain[1].gainDb = v; drawFriis(); } });
  const table = h('div', 'stage-table');
  const friisRo = readout([
    { key: 'nf', label: 'Cascade noise figure', unit: 'dB' },
    { key: 'te', label: 'Noise temperature Te', unit: 'K' },
    { key: 'g', label: 'Cascade gain', unit: 'dB' },
    { key: 'floor', label: 'Noise floor (B = 250 MHz)', unit: 'dBm' },
  ]);
  const friisEq = eqLine('');
  const cF = new LineChart({ xLabel: 'Stage', yLabel: 'Cumulative NF (dB)', height: 150, xFormat: (v) => chain[Math.round(v)]?.name.split(' ')[0] ?? '' });
  f.body.append(lnaNf.el, lnaG.el, table, friisRo.el, friisEq, cF.el);
  const drawFriis = () => {
    const r = friisCascade(chain);
    table.innerHTML = `<div class="st-row st-head"><span>Stage</span><span>G (dB)</span><span>NF (dB)</span><span>Σ NF</span></div>` + chain.map((s, i) => `<div class="st-row"><span>${s.name}</span><span>${s.gainDb.toFixed(1)}</span><span>${s.nfDb.toFixed(1)}</span><span>${r.cumulativeNfDb[i].toFixed(2)}</span></div>`).join('');
    friisRo.set({ nf: fx(r.totalNfDb), te: fx(r.noiseTempK, 0), g: fx(r.totalGainDb, 1), floor: fx(noiseFloorDbm(250e6, r.totalNfDb), 1) });
    const g1 = 10 ** (chain[0].gainDb / 10);
    const g12 = g1 * 10 ** (chain[1].gainDb / 10);
    friisEq.innerHTML = `F = ${r.contributions[0].toFixed(3)} + (F₂−1)/G₁ = ${r.contributions[1].toFixed(3)} + (F₃−1)/(G₁G₂) = ${r.contributions[2].toFixed(4)} + … → <b>NF = ${r.totalNfDb.toFixed(2)} dB</b> <span class="muted">(G₁ = ${g1.toFixed(2)}, G₁G₂ = ${g12.toFixed(0)})</span>`;
    cF.update([{ id: 'nf', name: 'Cumulative NF', color: C1, points: r.cumulativeNfDb.map((v, i) => [i, v] as [number, number]) }], [{ x: chain.length - 1, y: r.totalNfDb, label: `${r.totalNfDb.toFixed(2)} dB` }], { xDomain: [0, chain.length - 1], yDomain: [0, Math.max(4, r.totalNfDb * 1.3)] });
  };

  // --- ADC ---
  const a = section('ADC — sampling & quantisation', 'calculated');
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const bits = segmented('Resolution', [4, 6, 8, 10, 12].map((b) => ({ value: b, label: `${b} bit` })), p0.adcBits, (v) => store.setParams({ adcBits: v }));
  const fs = slider({ label: 'Sampling rate fs', min: 100, max: 2000, step: 10, value: p0.adcFsMsps, unit: 'MS/s', onInput: set('adcFsMsps') });
  const fsig = slider({ label: 'Signal frequency', min: 10, max: 1500, step: 5, value: p0.signalMHz, unit: 'MHz', onInput: set('signalMHz') });
  const adcRo = readout([
    { key: 'nyq', label: 'Nyquist fs > 2·f' },
    { key: 'alias', label: 'Apparent (alias) frequency', unit: 'MHz' },
    { key: 'snr', label: 'SNR ideal 6.02N + 1.76', unit: 'dB' },
    { key: 'snrm', label: 'SNR measured (simulated)', unit: 'dB' },
    { key: 'pw', label: 'ADC power (Walden FOM, 1 ch)', unit: '' },
  ]);
  const cA = new LineChart({ xLabel: 'Time (ns)', yLabel: 'Amplitude (FS)', height: 180, yDomain: [-1.1, 1.1] });
  a.body.append(bits.el, fs.el, fsig.el, adcRo.el, cA.el);

  // --- Modulation ---
  const m = section('Digital modulation — AWGN', 'calculated');
  const mod = segmented<Modulation>('Scheme', (['BPSK', 'QPSK', '16QAM', '64QAM'] as Modulation[]).map((v) => ({ value: v, label: v })), p0.modulation, (v) => store.setParams({ modulation: v }));
  const eb = slider({ label: 'Eb/N0', min: -2, max: 24, step: 0.5, value: p0.ebN0Db, unit: 'dB', format: (v) => v.toFixed(1), onInput: set('ebN0Db') });
  const iq = new IQChart(220);
  const modRo = readout([
    { key: 'es', label: 'Es/N0', unit: 'dB' },
    { key: 'ber', label: 'BER theory' },
    { key: 'ser', label: 'SER measured (1500 sym.)' },
    { key: 'evm', label: 'EVM', unit: '% rms' },
  ]);
  const cB = new LineChart({ xLabel: 'Eb/N0 (dB)', yLabel: 'Bit error rate', height: 180, yLog: true, yDomain: [1e-8, 0.5], xDomain: [-2, 24] });
  const iqRow = h('div', 'iq-row');
  iqRow.append(iq.el, modRo.el);
  m.body.append(mod.el, eb.el, iqRow, cB.el);
  root.append(f.el, a.el, m.el);

  const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const update = (s: AppState, changed: Set<string>) => {
    const q = s.params;
    bits.set(q.adcBits); fs.set(q.adcFsMsps); fsig.set(q.signalMHz); mod.set(q.modulation); eb.set(q.ebN0Db);
    if (changed.has('init') || ['params.adcBits', 'params.adcFsMsps', 'params.signalMHz'].some((k) => changed.has(k))) {
      const tr = adcTrace({ signalHz: q.signalMHz * 1e6, fsHz: q.adcFsMsps * 1e6, bits: q.adcBits }, 3);
      const ns = (pts: [number, number][]) => pts.map(([t, v]) => [t * 1e9, v] as [number, number]);
      const ok = nyquistOk(q.signalMHz * 1e6, q.adcFsMsps * 1e6);
      const series = [
        { id: 'c', name: 'Input', color: C1, points: ns(tr.continuous), width: 1.6 },
        { id: 'q', name: `Quantised (${q.adcBits} bit)`, color: C2, points: ns(tr.quantized), step: true, width: 1.8 },
        { id: 's', name: 'Samples', color: C4, points: ns(tr.samples), dots: true },
      ];
      if (!ok) series.push({ id: 'a', name: `Alias ${tr.aliasHz / 1e6 < 1 ? (tr.aliasHz / 1e3).toFixed(0) + ' kHz' : (tr.aliasHz / 1e6).toFixed(0) + ' MHz'}`, color: C3, points: ns(tr.alias), width: 2 } as never);
      cA.update(series);
      adcRo.set({ nyq: ok ? 'satisfied ✓' : 'VIOLATED → aliasing', alias: fx(tr.aliasHz / 1e6, 1), snr: fx(idealSnrDb(q.adcBits), 2), snrm: fx(tr.measuredSnrDb, 2), pw: formatSI(adcPowerW(q.adcBits, q.adcFsMsps * 1e6), 'W') });
    }
    if (changed.has('init') || changed.has('params.modulation') || changed.has('params.ebN0Db')) {
      const es = esN0FromEbN0(q.modulation, q.ebN0Db);
      const sim = simulateConstellation(q.modulation, es);
      iq.update(sim.received, sim.ideal, { cloud: cssVar('--series-1'), ideal: cssVar('--text-primary'), grid: cssVar('--grid'), text: cssVar('--text-secondary') });
      const ber = berTheory(q.modulation, q.ebN0Db);
      modRo.set({ es: fx(es, 1), ber: sci(ber), ser: sci(sim.ser || 0), evm: fx(sim.evmPct, 1) });
      const curves = (['BPSK', '16QAM', '64QAM'] as Modulation[]).map((mm, i) => ({ id: mm, name: mm === 'BPSK' ? 'BPSK / QPSK' : mm, color: [C1, C2, C3][i], width: 1.8, points: Array.from({ length: 105 }, (_, k) => { const x = -2 + k * 0.25; return [x, Math.max(berTheory(mm, x), 1e-9)] as [number, number]; }) }));
      cB.update(curves, [{ x: q.ebN0Db, y: Math.max(ber, 1e-8), label: `${q.modulation}: ${sci(ber, 1)}`, color: 'var(--accent)' }]);
    }
  };
  drawFriis();
  return { el: root, update };
};

// ---------------------------------------------------------------- ARRAY (BEAM LAB)
const arrayPanel: Builder = (store) => {
  const root = h('div');
  const p0 = store.get().params;
  const hero = section('Beam experiment', 'calculated');
  const beam = beamHero(store);
  hero.body.append(beam.el);
  const cmpSec = section('Array compare · 8×8 vs 32×32', 'calculated');
  const cmp = arrayCompare(store);
  cmpSec.body.append(cmp.el);
  const sec = section('Engineering detail', 'calculated');
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const n = slider({ label: 'Elements per side N', min: 4, max: 32, step: 1, value: p0.arrayN, format: (v) => `${v} × ${v}`, onInput: set('arrayN') });
  const az = slider({ label: 'Steering azimuth φ₀', min: 0, max: 180, step: 5, value: p0.steerAzDeg, unit: '°', onInput: set('steerAzDeg') });
  const w = segmented('Amplitude weighting', [{ value: 'uniform', label: 'Uniform' }, { value: 'cosine', label: 'Cosine' }, { value: 'hamming', label: 'Hamming' }, { value: 'hann', label: 'Hann' }] as const, p0.weighting, (v) => store.setParams({ weighting: v }));
  const power = powerControls(store);
  const ro = readout([
    { key: 'd', label: 'Directivity (numerical)', unit: 'dBi' },
    { key: 'g', label: 'Gain (η = 70 %)', unit: 'dBi' },
    { key: 'te', label: 'Taper efficiency', unit: '%' },
    { key: 'gl', label: 'Grating lobes' },
    { key: 'rf', label: 'Total RF power', unit: 'W' },
    { key: 'eirp', label: 'EIRP', unit: 'dBW' },
    { key: 'flatA', label: 'Lab footprint, along scan (flat ground)', unit: 'km' },
    { key: 'flatC', label: 'Lab footprint, across scan (flat ground)', unit: 'km' },
    { key: 'fpAlong', label: 'Earth footprint, along-track (spherical)', unit: 'km' },
    { key: 'fpAcross', label: 'Earth footprint, cross-track (spherical)', unit: 'km' },
    { key: 'fpArea', label: 'Earth footprint area', unit: 'km²' },
    { key: 'off', label: 'Beam centre from nadir', unit: 'km' },
  ]);
  const eq = eqLine('');
  const polar = new PolarChart(320);
  const cut = new LineChart({ xLabel: 'θ (deg)', yLabel: 'Normalised gain (dB)', height: 160, xDomain: [-90, 90], yDomain: [-50, 2] });
  const fpNote = h('p', 'note', 'BEAM LAB draws the −3 dB contour on a flat ground plane (directions exact, distance compressed). COSMOS intersects the same contour with the spherical Earth; the numbers above marked "spherical" are that intersection.');
  sec.body.append(n.el, az.el, w.el, power.el, ro.el, fpNote, eq, h('div', 'chart-title', 'Polar cut through the steered beam'), polar.el, cut.el);
  root.append(hero.el, cmpSec.el, sec.el);
  const update = (s: AppState, changed: Set<string>) => {
    const q = s.params;
    beam.update(s, changed);
    cmp.update(s, changed);
    n.set(q.arrayN); az.set(q.steerAzDeg); w.set(q.weighting);
    power.update(s);
    if (!beamChanged(changed)) return;
    const b = beamSolution(q);
    const m = b.pattern;
    const fp = b.footprint;
    ro.set({ d: fx(m.directivityDbi, 1), g: fx(m.gainDbi, 1), te: fx(m.taperEfficiency * 100, 0), gl: m.gratingLobe ? `⚠ ${b.lobes.length} in visible space` : 'none', rf: fx(b.power.rfW, 0), eirp: fx(b.power.eirpDbw, 1), flatA: km(b.flat.alongKm), flatC: km(b.flat.acrossKm), fpAlong: km(fp.alongTrackKm), fpAcross: km(fp.crossTrackKm), fpArea: km2(fp.areaKm2), off: fp.nadirOffsetKm === null ? 'off Earth' : km(fp.nadirOffsetKm) });
    const bx = (m.phaseStepX * 180) / Math.PI;
    eq.innerHTML = `Phase step βx = −k·d·sinθ₀·cosφ₀ = −360°·${q.spacingLambda.toFixed(2)}·sin(${q.steerDeg}°)·cos(${q.steerAzDeg}°) = <b>${bx.toFixed(1)}°</b> per element · grating-lobe limit d/λ &lt; ${m.gratingLimit.toFixed(2)}`;
    polar.update(m.cut, q.steerDeg);
    cut.update([{ id: 'cut', name: 'AF·EP', color: C1, points: m.cut.map((c) => [c.thetaDeg, Math.max(c.db, -50)] as [number, number]) }], [{ x: q.steerDeg, y: Math.max(...m.cut.map((c) => c.db)), label: `θ₀ = ${q.steerDeg}°` }]);
  };
  return { el: root, update };
};

// ---------------------------------------------------------------- COSMOS (link budget)
const cosmosPanel: Builder = (store) => {
  const root = h('div');
  const p0 = store.get().params;
  const sec = section('Downlink to the beam centre', 'calculated');
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const alt = slider({ label: 'Altitude h', min: 340, max: 1200, step: 10, value: p0.altitudeKm, unit: 'km', onInput: set('altitudeKm') });
  const st = slider({ label: 'Beam steering θ₀', min: -60, max: 60, step: 1, value: p0.steerDeg, unit: '°', onInput: set('steerDeg') });
  const fr = slider({ label: 'Frequency', min: 10.7, max: 30, step: 0.1, value: p0.freqGHz, unit: 'GHz', format: (v) => v.toFixed(1), onInput: set('freqGHz') });
  const power = powerControls(store);
  const gr = slider({ label: 'User terminal gain Gr', min: 28, max: 45, step: 0.5, value: p0.rxGainDbi, unit: 'dBi', format: (v) => v.toFixed(1), onInput: set('rxGainDbi') });
  const geo = h('p', 'note', 'The user terminal sits at the centre of the calculated footprint, so elevation and slant range follow from steering and altitude — the drawn link and the numbers are the same link.');
  const ro = readout([
    { key: 'el', label: 'Elevation at beam centre', unit: '°' },
    { key: 'off', label: 'Beam centre from nadir', unit: 'km' },
    { key: 'fp', label: 'Footprint along × cross-track', unit: 'km' },
    { key: 'r', label: 'Slant range R', unit: 'km' },
    { key: 'fspl', label: 'Free-space path loss', unit: 'dB' },
    { key: 'pt', label: 'Tx power Pt', unit: '' },
    { key: 'gt', label: 'Tx gain Gt (array)', unit: 'dBi' },
    { key: 'eirp', label: 'EIRP', unit: 'dBW' },
    { key: 'pr', label: 'Received power Pr', unit: '' },
    { key: 'gt2', label: 'G/T', unit: 'dB/K' },
    { key: 'cn0', label: 'C/N0', unit: 'dB-Hz' },
    { key: 'ebn0', label: 'Eb/N0', unit: 'dB' },
    { key: 'margin', label: 'Link margin', unit: 'dB' },
  ]);
  const eq = eqLine('');
  const chart = new LineChart({ xLabel: 'Elevation (deg)', yLabel: 'Link margin (dB)', height: 170, xDomain: [10, 90] });
  const chartNote = h('p', 'note', 'Curve: margin vs elevation with the current EIRP held fixed (geometry only). Marker: the calculated beam-centre link.');
  sec.body.append(alt.el, st.el, fr.el, power.el, gr.el, geo, ro.el, eq, chart.el, chartNote);
  const xsec = section('Link budget X-ray', 'calculated');
  const xray = linkXray(store);
  xsec.body.append(xray.el);
  root.append(xsec.el, sec.el);
  const update = (s: AppState) => {
    const q = s.params;
    alt.set(q.altitudeKm); st.set(q.steerDeg); fr.set(q.freqGHz); gr.set(q.rxGainDbi);
    power.update(s);
    xray.update(s);
    const sys = solveSystem(q);
    const b = sys.beam;
    const L = sys.link;
    const fp = b.footprint;
    const dash = '—';
    ro.set({
      el: L ? fx(L.elevationDeg, 1) : 'above horizon',
      off: fp.nadirOffsetKm === null ? dash : km(fp.nadirOffsetKm),
      fp: fp.contour.length >= 3 ? `${km(fp.alongTrackKm)} × ${km(fp.crossTrackKm)}${fp.complete ? '' : ' (clipped)'}` : dash,
      r: L ? fx(L.rangeKm, 0) : dash,
      fspl: L ? fx(L.fsplDb, 1) : dash,
      pt: `${fx(b.power.rfW, 0)} W = ${fx(10 * Math.log10(b.power.rfW), 1)} dBW`,
      gt: fx(sys.gainDbi, 1),
      eirp: fx(sys.eirpDbw, 1),
      pr: L ? `${fx(L.rxPowerDbw, 1)} dBW = ${fx(L.rxPowerDbm, 1)} dBm` : dash,
      gt2: L ? fx(L.gOverTDbK, 1) : dash,
      cn0: L ? fx(L.cn0DbHz, 1) : dash,
      ebn0: L ? fx(L.ebN0Db, 1) : dash,
      margin: L ? `${L.marginDb >= 0 ? '+' : ''}${fx(L.marginDb, 1)}` : 'no link',
    });
    if (!L) {
      eq.innerHTML = `The beam axis at θ₀ = ${q.steerDeg}° from ${q.altitudeKm} km points above the Earth limb (horizon at ${fx((Math.asin(6371 / (6371 + q.altitudeKm)) * 180) / Math.PI, 1)}° from nadir): no ground link.`;
      chart.update([], []);
      return;
    }
    const lam = wavelengthM(q.freqGHz * 1e9);
    eq.innerHTML = `FSPL = 20·log10(4π·R/λ) = 20·log10(4π·${fx(L.rangeKm, 0)} km / ${fx(lam * 1000, 2)} mm) = <b>${fx(L.fsplDb, 1)} dB</b><br>Pr = Pt + Gt + Gr − FSPL − L = ${fx(L.txPowerDbw, 1)} + ${fx(sys.gainDbi, 1)} + ${fx(q.rxGainDbi, 1)} − ${fx(L.fsplDb, 1)} − 3.0 = <b>${fx(L.rxPowerDbw, 1)} dBW</b>`;
    const pts: [number, number][] = [];
    for (let e = 10; e <= 90; e += 2) {
      const r = linkBudget({ altitudeKm: q.altitudeKm, elevationDeg: e, freqGHz: q.freqGHz, txPowerW: b.power.rfW, txGainDbi: sys.gainDbi, rxGainDbi: q.rxGainDbi, rxNoiseTempK: 250, otherLossesDb: 3, dataRateBps: sys.dataRateBps, requiredEbN0Db: L.ebN0Db - L.marginDb });
      pts.push([e, r.marginDb]);
    }
    chart.update([{ id: 'm', name: 'Margin (EIRP fixed)', color: C1, points: pts }, { id: 'z', name: '0 dB', color: 'var(--text-muted)', dash: '3 3', width: 1, points: [[10, 0], [90, 0]] }], [{ x: Math.max(10, L.elevationDeg), y: L.marginDb, label: `${L.marginDb.toFixed(1)} dB @ El ${L.elevationDeg.toFixed(0)}°, ${fx(slantRangeM(q.altitudeKm * 1000, L.elevationDeg) / 1000, 0)} km` }]);
  };
  return { el: root, update };
};

// ---------------------------------------------------------------- SATELLITE (power/thermal)
const satellitePanel: Builder = (store) => {
  const root = h('div');
  const sec = section('Power & thermal balance', 'calculated');
  const p0 = store.get().params;
  const set = (k: keyof Params) => (v: number) => store.setParams({ [k]: v } as Partial<Params>);
  const bitsS = slider({ label: 'ADC resolution', min: 4, max: 12, step: 2, value: p0.adcBits, unit: 'bit', onInput: set('adcBits') });
  const fsS = slider({ label: 'ADC sample rate', min: 100, max: 2000, step: 10, value: p0.adcFsMsps, unit: 'MS/s', onInput: set('adcFsMsps') });
  const nS = slider({ label: 'Array elements per side', min: 4, max: 32, step: 1, value: p0.arrayN, onInput: set('arrayN') });
  const pS = powerControls(store);
  const bars = h('div', 'pbars');
  const ro = readout([
    { key: 'solar', label: 'Solar array (orbit average)', unit: 'W' },
    { key: 'load', label: 'Total load', unit: 'W' },
    { key: 'margin', label: 'Power margin', unit: 'W' },
    { key: 'heat', label: 'Waste heat Q = P_DC − P_RF', unit: 'W' },
    { key: 'rad', label: 'Radiator area needed (300 K)', unit: 'm²' },
  ]);
  const eq = eqLine('');
  const chart = new LineChart({ xLabel: 'ADC resolution (bit)', yLabel: 'Payload DC power (W)', height: 160, xDomain: [4, 12] });
  sec.body.append(bitsS.el, fsS.el, nS.el, pS.el, bars, ro.el, eq, chart.el);
  const xsec = section('Link budget X-ray', 'calculated');
  const xray = linkXray(store);
  xsec.body.append(xray.el);
  root.append(sec.el, xsec.el);
  const update = (s: AppState) => {
    const q = s.params;
    bitsS.set(q.adcBits); fsS.set(q.adcFsMsps); nS.set(q.arrayN); pS.update(s);
    xray.update(s);
    const sys = solveSystem(q);
    const items = [
      ['PA (DC)', sys.paDcW, 'var(--series-2)'],
      ['DSP', sys.dspPowerW, 'var(--series-1)'],
      ['ADC', sys.adcPowerW, 'var(--series-3)'],
      ['Bus', sys.busW, 'var(--text-muted)'],
    ] as const;
    const max = Math.max(sys.solarW, sys.totalLoadW);
    bars.innerHTML = items.map(([n, v, c]) => `<div class="pbar"><span>${n}</span><div class="pbar-track"><i style="width:${(100 * v) / max}%;background:${c}"></i></div><b>${v.toFixed(0)} W</b></div>`).join('') + `<div class="pbar pbar-total"><span>Solar</span><div class="pbar-track"><i style="width:${(100 * sys.solarW) / max}%;background:var(--series-4)"></i></div><b>${sys.solarW.toFixed(0)} W</b></div>`;
    ro.set({ solar: fx(sys.solarW, 0), load: fx(sys.totalLoadW, 0), margin: `${sys.powerMarginW >= 0 ? '+' : ''}${fx(sys.powerMarginW, 0)}`, heat: fx(sys.heatW, 0), rad: fx(sys.radiatorM2, 2) });
    eq.innerHTML = `A_rad = Q / (εσ(T⁴ − T_sink⁴)) = ${fx(sys.heatW, 0)} W / (0.85·5.67×10⁻⁸·(300⁴ − 200⁴)) = <b>${fx(sys.radiatorM2, 2)} m²</b>`;
    const pts: [number, number][] = [4, 6, 8, 10, 12].map((b) => [b, solveSystem({ ...q, adcBits: b }).payloadDcW]);
    chart.update([{ id: 'p', name: 'Payload DC', color: C1, points: pts }], [{ x: q.adcBits, y: sys.payloadDcW, label: `${sys.payloadDcW.toFixed(0)} W` }]);
  };
  return { el: root, update };
};

// ---------------------------------------------------------------- PACKAGE (thermal stack)
const packagePanel: Builder = () => {
  const root = h('div');
  const sec = section('Junction temperature — 1D thermal stack', 'calculated');
  const pS = { v: 25 };
  const ro = readout([
    { key: 'tj', label: 'Junction temperature Tj', unit: '°C' },
    { key: 'margin', label: 'Margin to 105 °C limit', unit: '°C' },
  ]);
  const chart = new LineChart({ xLabel: 'Node', yLabel: 'Temperature (°C)', height: 160, xFormat: (v) => ['Cold plate', 'IHS', 'TIM', 'Die'][Math.round(v)] ?? '' });
  const eq = eqLine('');
  const s = slider({ label: 'SoC power', min: 5, max: 60, step: 1, value: 25, unit: 'W', onInput: (v) => { pS.v = v; draw(); } });
  sec.body.append(s.el, ro.el, eq, chart.el);
  root.append(sec.el);
  const draw = () => {
    const t = junctionTemperatures(pS.v, 40);
    ro.set({ tj: fx(t.tj, 1), margin: fx(105 - t.tj, 1) });
    eq.innerHTML = `Tj = T_cp + P·(θ_IHS + θ_TIM + θ_die) = 40 + ${pS.v}·(${t.theta.map((v) => v.toFixed(2)).join(' + ')}) K/W = <b>${t.tj.toFixed(1)} °C</b>`;
    chart.update([{ id: 't', name: 'T', color: C2, points: t.nodes.map((v, i) => [i, v] as [number, number]) }], [{ x: 3, y: t.tj, label: `Tj ${t.tj.toFixed(0)} °C` }], { xDomain: [0, 3] });
  };
  draw();
  return { el: root, update: () => {} };
};

// ---------------------------------------------------------------- DIE (power breakdown)
const diePanel: Builder = (store) => {
  const root = h('div');
  const sec = section('Block power from the system model', 'calculated');
  const p0 = store.get().params;
  const bitsS = segmented('ADC resolution', [4, 6, 8, 10, 12].map((b) => ({ value: b, label: `${b}` })), p0.adcBits, (v) => store.setParams({ adcBits: v }));
  const fsS = slider({ label: 'ADC sample rate', min: 100, max: 2000, step: 10, value: p0.adcFsMsps, unit: 'MS/s', onInput: (v) => store.setParams({ adcFsMsps: v }) });
  const bars = h('div', 'pbars');
  const note = h('p', 'note', 'Switch to THERMAL mode: block colour = power density from this calculation.');
  sec.body.append(bitsS.el, fsS.el, bars, note);
  root.append(sec.el);
  return {
    el: root,
    update: (s) => {
      bitsS.set(s.params.adcBits); fsS.set(s.params.adcFsMsps);
      const sys = solveSystem(s.params);
      const perChip = { ADC: sys.adcPowerW / 32 * 4, DSP: sys.dspPowerW / 32 * 4, 'RF + other': 6 };
      const max = Math.max(...Object.values(perChip));
      bars.innerHTML = Object.entries(perChip).map(([k, v], i) => `<div class="pbar"><span>${k}</span><div class="pbar-track"><i style="width:${(100 * v) / max}%;background:${[C3, C1, 'var(--text-muted)'][i]}"></i></div><b>${v.toFixed(2)} W</b></div>`).join('') + `<p class="note">Per die (4 channels). ADC ∝ 2^ENOB·fs; DSP ∝ N·fs.</p>`;
    },
  };
};

// ---------------------------------------------------------------- SILICON
const siliconPanel: Builder = (store) => {
  const root = h('div');
  const sec = section('Intrinsic carrier density', 'calculated');
  const sT = slider({ label: 'Temperature', min: 200, max: 600, step: 5, value: store.get().params.tempK, unit: 'K', onInput: (v) => store.setParams({ tempK: v }) });
  const ro = readout([
    { key: 'eg', label: 'Band gap Eg(T)', unit: 'eV' },
    { key: 'ni', label: 'ni', unit: 'cm⁻³' },
    { key: 'kt', label: 'Thermal energy kT', unit: 'meV' },
  ]);
  const eq = eqLine('');
  const chart = new LineChart({ xLabel: 'Temperature (K)', yLabel: 'ni (cm⁻³)', height: 170, yLog: true, xDomain: [200, 600] });
  sec.body.append(sT.el, ro.el, eq, chart.el);
  root.append(sec.el);
  const curve: [number, number][] = [];
  for (let T = 200; T <= 600; T += 5) curve.push([T, intrinsicCarrierDensity(T)]);
  return {
    el: root,
    update: (s) => {
      const T = s.params.tempK;
      sT.set(T);
      const eg = bandGapEv(T);
      const ni = intrinsicCarrierDensity(T);
      ro.set({ eg: fx(eg, 4), ni: sci(ni), kt: fx(8.617333e-5 * T * 1000, 1) });
      eq.innerHTML = `ni = √(Nc·Nv)·exp(−Eg/2kT) = √(${sci(2.8e19 * (T / 300) ** 1.5, 1)}·${sci(1.04e19 * (T / 300) ** 1.5, 1)})·exp(−${eg.toFixed(3)} / (2·${(8.617333e-5 * T).toFixed(4)})) = <b>${sci(ni)} cm⁻³</b>`;
      chart.update([{ id: 'ni', name: 'ni', color: C1, points: curve }], [{ x: T, y: ni, label: sci(ni, 1) }]);
    },
  };
};

// ---------------------------------------------------------------- ENERGY
const energyPanel: Builder = (store) => {
  const root = h('div');
  const sec = section('PN junction — bands & diode', 'calculated');
  const p0 = store.get().params;
  const sVd = slider({ label: 'Applied bias Vd', min: -2, max: 0.8, step: 0.01, value: p0.vd, unit: 'V', format: (v) => v.toFixed(2), onInput: (v) => store.setParams({ vd: v }) });
  const sT = slider({ label: 'Temperature', min: 200, max: 450, step: 5, value: p0.tempK, unit: 'K', onInput: (v) => store.setParams({ tempK: v }) });
  const ro = readout([
    { key: 'vbi', label: 'Built-in potential Vbi', unit: 'V' },
    { key: 'w', label: 'Depletion width W', unit: 'nm' },
    { key: 'i', label: 'Diode current (Is = 10 fA)' },
  ]);
  const eq = eqLine('');
  const chart = new LineChart({ xLabel: 'Vd (V)', yLabel: '|I| (A)', height: 170, yLog: true, xDomain: [-0.5, 0.8], yDomain: [1e-16, 1] });
  sec.body.append(sVd.el, sT.el, ro.el, eq, chart.el);
  root.append(sec.el);
  return {
    el: root,
    update: (s) => {
      const { vd, tempK: T } = s.params;
      sVd.set(vd); sT.set(T);
      const vbi = builtInPotential(T, 1e17, 1e17);
      const prof = junctionProfile(T, 1e17, 1e17, vd);
      const i = diodeCurrent(vd, 1e-14, 1, T);
      ro.set({ vbi: fx(vbi, 3), w: fx(prof.wUm * 1000, 1), i: formatSI(i, 'A') });
      eq.innerHTML = `I = Is·[exp(Vd/nVt) − 1] = 10 fA·[exp(${vd.toFixed(2)}/${(0.025852 * T / 300).toFixed(4)}) − 1] = <b>${formatSI(i, 'A')}</b>`;
      const pts: [number, number][] = [];
      for (let v = -0.5; v <= 0.8; v += 0.01) pts.push([v, Math.abs(diodeCurrent(v, 1e-14, 1, T)) + 1e-17]);
      chart.update([{ id: 'iv', name: '|I|', color: C1, points: pts }], [{ x: vd, y: Math.abs(i) + 1e-17, label: formatSI(i, 'A') }]);
    },
  };
};

// ---------------------------------------------------------------- PCB
const pcbPanel: Builder = (store) => {
  const root = h('div');
  const sec = section('Board power rails', 'calculated');
  const ro = readout([
    { key: 'soc', label: 'SoC power (4 channels)', unit: 'W' },
    { key: 'core', label: 'Core rail current @ 0.8 V', unit: 'A' },
    { key: 'in', label: '12 V input (η = 90 %)', unit: 'A' },
  ]);
  const note = h('p', 'note', 'SoC power follows ADC resolution and sample rate through the system model (change them in PAYLOAD or DIE).');
  sec.body.append(ro.el, note);
  root.append(sec.el);
  void store;
  return {
    el: root,
    update: (s) => {
      const sys = solveSystem(s.params);
      const soc = (sys.adcPowerW + sys.dspPowerW) / 32 * 4 + 6;
      ro.set({ soc: fx(soc, 1), core: fx((soc * 0.7) / 0.8, 1), in: fx(soc / 0.9 / 12, 2) });
    },
  };
};

const BUILDERS: Record<LevelId, Builder> = {
  cosmos: cosmosPanel,
  satellite: satellitePanel,
  array: arrayPanel,
  payload: payloadPanel,
  pcb: pcbPanel,
  package: packagePanel,
  die: diePanel,
  mosfet: mosfetPanel,
  silicon: siliconPanel,
  energy: energyPanel,
};

export function buildAnalysis(level: LevelId, store: Store): Analysis {
  return BUILDERS[level](store);
}

