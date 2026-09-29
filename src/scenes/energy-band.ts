import * as THREE from 'three';
import type { AppState } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { group, v3 } from '../graphics/geometry';
import { pointsMaterial, syncPointScale } from '../graphics/particles';
import { bandGapEv, diodeCurrent, effectiveDos, junctionProfile } from '../models/semiconductor';
import { K_BOLTZMANN_EV, mulberry32 } from '../models/units';
import { BaseLevel } from './base';

const NA = 1e17;
const ND = 1e17;
const XW = 8; // half-width of the diagram
const EY = 3.2; // scene units per eV
const DEPTH = 3; // z half-depth of the extruded band surfaces

/**
 * LEVEL 8 — energy-band diagram of an abrupt silicon PN junction, extruded
 * into 3D. Band bending, depletion width and Fermi-level split are calculated
 * from the depletion approximation for the chosen bias Vd.
 */
export class EnergyBandLevel extends BaseLevel {
  readonly id = 'energy' as const;
  readonly radius = 8;
  home = { pos: v3(4, 3.5, 20), target: v3(0, 0, 0) };
  private ec!: THREE.Mesh;
  private ev!: THREE.Mesh;
  private cb!: THREE.Mesh;
  private vb!: THREE.Mesh;
  private efP!: THREE.Mesh;
  private efN!: THREE.Mesh;
  private dep!: THREE.Mesh;
  private electrons!: THREE.Points;
  private holes!: THREE.Points;
  private profile: { x: number[]; ec: number[]; ev: number[] } = { x: [], ec: [], ev: [] };
  private eState: { x: number; z: number; e: number; v: number }[] = [];
  private hState: { x: number; z: number; e: number; v: number }[] = [];
  private rand = mulberry32(5);
  private flux = 0;
  private ecLabel = v3(-XW + 1, 0, DEPTH);
  private evLabel = v3(XW - 1, 0, DEPTH);
  private efLabel = v3(XW - 1.5, 0, DEPTH);
  private efpY = 0;
  private efnY = 0;

  build(): void {
    const r = this.root;
    const mk = (color: string, emissive: number) => {
      const m = mat.emissive(color, emissive, 0.95);
      m.side = THREE.DoubleSide;
      return new THREE.Mesh(new THREE.BufferGeometry(), m);
    };
    this.ec = mk('#4f9cff', 0.55);
    this.ev = mk('#ff9a5c', 0.55);
    this.cb = new THREE.Mesh(new THREE.BufferGeometry(), mat.doped('#2e6fd0', 0.12));
    this.vb = new THREE.Mesh(new THREE.BufferGeometry(), mat.doped('#d0702e', 0.22));
    const ecG = group(this.ec, this.cb);
    const evG = group(this.ev, this.vb);
    r.add(ecG, evG);
    this.addComponent({ id: 'ec', name: 'Conduction Band Ec', sub: 'free electrons', object: ecG, labelLocal: this.ecLabel, desc: 'Lowest empty energy band. Electrons here are mobile. Its edge bends by −qψ(x) across the junction.', specs: ['Nc ≈ 2.8×10¹⁹ cm⁻³ (300 K)'] });
    this.addComponent({ id: 'ev', name: 'Valence Band Ev', sub: 'holes', object: evG, labelLocal: this.evLabel, desc: 'Highest filled band. Missing electrons (holes) act as positive mobile carriers.', specs: ['Nv ≈ 1.04×10¹⁹ cm⁻³ (300 K)'] });

    const lineMat = (c: string) => mat.emissive(c, 0.45, 0.85);
    this.efP = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.06), lineMat('#dfe6ef'));
    this.efN = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.06), lineMat('#dfe6ef'));
    this.efP.position.z = this.efN.position.z = DEPTH;
    const ef = group(this.efP, this.efN);
    r.add(ef);
    this.addComponent({ id: 'ef', name: 'Fermi Level EF', sub: 'split = qVd', object: ef, labelLocal: this.efLabel, desc: 'Electrochemical potential of carriers. Flat in equilibrium; under bias the quasi-Fermi levels separate by exactly qVd.', specs: ['EF − Ev = kT ln(Nv/Na) on p side'] });

    this.dep = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2 * DEPTH), mat.doped('#c9a0ff', 0.1));
    const depG = group(this.dep);
    r.add(depG);
    this.addComponent({ id: 'depletion', name: 'Depletion Region', sub: 'W ∝ √(Vbi − Vd)', object: depG, labelLocal: v3(0, -2.6, DEPTH), desc: 'Space-charge region with ionised dopants and almost no mobile carriers. Its built-in field opposes diffusion.', specs: ['W = √(2εs(Vbi−Vd)/q · (1/Na + 1/Nd))'] });

    // p / n side markers
    const pLabel = new THREE.Object3D();
    pLabel.position.set(-XW + 1.5, -3.2, 0);
    const nLabel = new THREE.Object3D();
    nLabel.position.set(XW - 1.5, 3.4, 0);
    r.add(pLabel, nLabel);
    this.addComponent({ id: 'pside', name: 'p-type side', sub: `Na = 10¹⁷ cm⁻³`, object: pLabel, desc: 'Acceptor-doped silicon: holes are majority carriers.', specs: [] });
    this.addComponent({ id: 'nside', name: 'n-type side', sub: `Nd = 10¹⁷ cm⁻³`, object: nLabel, desc: 'Donor-doped silicon: electrons are majority carriers.', specs: [] });

    const mkPts = (n: number, color: THREE.Color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
      const p = new THREE.Points(g, pointsMaterial(color, 0.18));
      p.frustumCulled = false;
      return p;
    };
    this.electrons = mkPts(160, COLORS.electron);
    this.holes = mkPts(160, COLORS.hole);
    const carriers = group(this.electrons, this.holes);
    carriers.userData.noFade = true;
    r.add(carriers);
    for (let i = 0; i < 160; i++) {
      this.eState.push({ x: XW * (0.1 + 0.9 * this.rand()), z: (this.rand() - 0.5) * 2 * DEPTH * 0.9, e: this.rand(), v: 0 });
      this.hState.push({ x: -XW * (0.1 + 0.9 * this.rand()), z: (this.rand() - 0.5) * 2 * DEPTH * 0.9, e: this.rand(), v: 0 });
    }
    this.explode.add(ecG, v3(0, 1.5, 0), 0, 1);
    this.explode.add(evG, v3(0, -1.5, 0), 0, 1);
    this.applyParams(this.ctx.store.get());
  }

  onState(state: AppState, changed: Set<string>): void {
    if (changed.has('params.vd') || changed.has('params.tempK')) this.applyParams(state);
  }

  private applyParams(state: AppState): void {
    const T = state.params.tempK;
    const vd = state.params.vd;
    const prof = junctionProfile(T, NA, ND, vd, 161);
    const eg = bandGapEv(T);
    const span = Math.max(...prof.xUm.map(Math.abs));
    const xs = prof.xUm.map((x) => (x / span) * XW);
    const ecE = prof.psi.map((p) => eg - p);
    const evE = prof.psi.map((p) => -p);
    const mid = (eg - prof.psi[prof.psi.length - 1]) / 2; // centre vertically
    const y = (e: number) => (e - mid) * EY - 0.2;
    this.profile = { x: xs, ec: ecE.map(y), ev: evE.map(y) };
    this.ec.geometry.dispose();
    this.ev.geometry.dispose();
    this.cb.geometry.dispose();
    this.vb.geometry.dispose();
    this.ec.geometry = ribbon(xs, this.profile.ec, 0.06);
    this.ev.geometry = ribbon(xs, this.profile.ev, 0.06);
    this.cb.geometry = slab(xs, this.profile.ec, 1.8);
    this.vb.geometry = slab(xs, this.profile.ev, -1.8);
    const { nv } = effectiveDos(T);
    const kT = K_BOLTZMANN_EV * T;
    const efp = kT * Math.log(nv / NA); // above Ev on the p side
    const efpE = efp;
    const efnE = efp + vd; // forward bias raises the n-side electron quasi-Fermi level by qVd
    this.efpY = y(efpE);
    this.efnY = y(efnE);
    const xp = -(prof.xpUm / span) * XW;
    const xn = (prof.xnUm / span) * XW;
    this.efP.scale.x = xn + XW;
    this.efP.position.set((-XW + xn) / 2, this.efpY, DEPTH);
    this.efN.scale.x = XW - xp;
    this.efN.position.set((XW + xp) / 2, this.efnY, DEPTH);
    this.ecLabel.y = this.profile.ec[8];
    this.evLabel.y = this.profile.ev[this.profile.ev.length - 9];
    this.efLabel.y = this.efnY;
    this.dep.scale.set(Math.max(0.05, xn - xp), EY * (eg + 2.2), 1);
    this.dep.position.set((xp + xn) / 2, y(eg / 2) - 0.6, 0);
    const i = diodeCurrent(vd, 1e-14, 1, T);
    this.flux = THREE.MathUtils.clamp(Math.log10(Math.abs(i) + 1e-18) + 14, 0, 12) / 12 * Math.sign(i || 1);
    this.markOpacityDirty();
  }

  private interp(arr: number[], x: number): number {
    const xs = this.profile.x;
    if (x <= xs[0]) return arr[0];
    if (x >= xs[xs.length - 1]) return arr[arr.length - 1];
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] > x) hi = m;
      else lo = m;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return arr[lo] + (arr[hi] - arr[lo]) * t;
  }

  protected tick(dt: number): void {
    for (const p of [this.electrons, this.holes]) {
      syncPointScale(p);
      (p.material as THREE.ShaderMaterial).uniforms.uOpacity.value = this.alpha;
      p.visible = this.alpha > 0.02;
    }
    if (!this.electrons.visible) return;
    const ep = this.electrons.geometry.getAttribute('position') as THREE.BufferAttribute;
    const hp = this.holes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fwd = Math.max(0, this.flux);
    this.eState.forEach((s, i) => {
      // electrons wander on the n side; forward bias lets them diffuse over the barrier
      const drift = (this.rand() - 0.5) * 1.2 - (i % 12 < fwd * 12 ? 1.2 : 0.25 * (s.x < 1 ? -1 : 0));
      s.x = THREE.MathUtils.clamp(s.x + drift * dt, -XW, XW);
      if (s.x <= -XW + 0.05) s.x = XW * (0.3 + 0.7 * this.rand());
      s.z += (this.rand() - 0.5) * dt;
      const yc = this.interp(this.profile.ec, s.x) + 0.15 + s.e * 0.5;
      ep.setXYZ(i, s.x, yc, s.z);
    });
    this.hState.forEach((s, i) => {
      const drift = (this.rand() - 0.5) * 1.2 + (i % 12 < fwd * 12 ? 1.2 : 0.25 * (s.x > -1 ? 1 : 0));
      s.x = THREE.MathUtils.clamp(s.x + drift * dt, -XW, XW);
      if (s.x >= XW - 0.05) s.x = -XW * (0.3 + 0.7 * this.rand());
      s.z += (this.rand() - 0.5) * dt;
      const yc = this.interp(this.profile.ev, s.x) - 0.15 - s.e * 0.5;
      hp.setXYZ(i, s.x, yc, s.z);
    });
    ep.needsUpdate = hp.needsUpdate = true;
  }
}

/** Band edge as a thin extruded ribbon along z. */
function ribbon(xs: number[], ys: number[], t: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  xs.forEach((x, i) => {
    for (const [dy, z] of [[t, -DEPTH], [t, DEPTH], [-t, -DEPTH], [-t, DEPTH]] as const) pos.push(x, ys[i] + dy, z);
  });
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    idx.push(a, b, a + 1, b, b + 1, a + 1); // top
    idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // bottom
    idx.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3); // front
    idx.push(a, a + 2, b, b, a + 2, b + 2); // back
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Translucent band volume from the edge towards +h (CB) or −h (VB). */
function slab(xs: number[], ys: number[], h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  xs.forEach((x, i) => {
    pos.push(x, ys[i], DEPTH, x, ys[i] + h, DEPTH, x, ys[i], -DEPTH, x, ys[i] + h, -DEPTH);
  });
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
    idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
