import * as THREE from 'three';
import { mulberry32 } from '../models/units';
import { pointsMaterial, syncPointScale } from './particles';

/**
 * Energetic-particle shower (RADIATION mode): straight tracks from outside the
 * object toward sensitive targets, with an impact flash. Illustrative only.
 */
export class RadiationShower {
  readonly group = new THREE.Group();
  private heads: THREE.Points;
  private trails: THREE.LineSegments;
  private flashes: THREE.Points;
  private tracks: { from: THREE.Vector3; to: THREE.Vector3; t: number; speed: number; flash: number }[] = [];
  private rand = mulberry32(99);
  private active = false;
  private alpha = 0;
  private drawn = 0;

  constructor(private targets: THREE.Vector3[], private spawnRadius: number, count = 14, color: THREE.ColorRepresentation = '#c38bff', size = 0.12) {
    const n = count;
    const hp = new Float32Array(n * 3);
    const phase = new Float32Array(n).fill(1);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    hg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.heads = new THREE.Points(hg, pointsMaterial(color, size));
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    fg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.flashes = new THREE.Points(fg, pointsMaterial('#ffffff', size * 5));
    for (const o of [this.heads, this.trails, this.flashes]) o.frustumCulled = false;
    (this.heads.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.group.visible = false;
    this.group.add(this.heads, this.trails, this.flashes);
    this.group.userData.noFade = true;
    for (let i = 0; i < n; i++) this.tracks.push(this.spawn(this.rand()));
    this.drawn = n;
  }

  private spawn(t0 = 0) {
    const to = this.targets[Math.floor(this.rand() * this.targets.length)].clone();
    const dir = new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.3, this.rand() - 0.5).normalize();
    const from = to.clone().addScaledVector(dir, this.spawnRadius * (0.8 + this.rand() * 0.6));
    return { from, to, t: t0 - 0.2, speed: 0.6 + this.rand() * 0.8, flash: 0 };
  }

  setActive(on: boolean): void {
    this.active = on;
  }

  setDensity(f: number): void {
    this.drawn = Math.max(4, Math.ceil(this.tracks.length * Math.min(1, f)));
    this.heads.geometry.setDrawRange(0, this.drawn);
    this.flashes.geometry.setDrawRange(0, this.drawn);
    this.trails.geometry.setDrawRange(0, this.drawn * 2);
  }

  setLevelAlpha(a: number): void {
    this.alpha = a;
  }

  update(dt: number, levelAlpha = 1): void {
    const target = this.active ? levelAlpha * this.alpha : 0;
    const hm = this.heads.material as THREE.ShaderMaterial;
    const o = hm.uniforms.uOpacity.value + (target - hm.uniforms.uOpacity.value) * Math.min(1, dt * 5);
    hm.uniforms.uOpacity.value = o;
    (this.trails.material as THREE.LineBasicMaterial).opacity = 0.5 * o;
    (this.flashes.material as THREE.ShaderMaterial).uniforms.uOpacity.value = o;
    this.group.visible = o > 0.01;
    if (!this.group.visible) return;
    syncPointScale(this.heads);
    syncPointScale(this.flashes);
    const hp = this.heads.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tp = this.trails.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fp = this.flashes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fa = this.flashes.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    this.tracks.forEach((tr, i) => {
      if (i >= this.drawn) return;
      tr.t += dt * tr.speed;
      if (tr.t >= 1 && tr.flash === 0) tr.flash = 1;
      if (tr.flash > 0) {
        tr.flash -= dt * 2.5;
        if (tr.flash <= 0) Object.assign(tr, this.spawn());
      }
      const t = THREE.MathUtils.clamp(tr.t, 0, 1);
      p.lerpVectors(tr.from, tr.to, t);
      q.lerpVectors(tr.from, tr.to, Math.max(0, t - 0.25));
      hp.setXYZ(i, p.x, p.y, p.z);
      tp.setXYZ(i * 2, q.x, q.y, q.z);
      tp.setXYZ(i * 2 + 1, p.x, p.y, p.z);
      fp.setXYZ(i, tr.to.x, tr.to.y, tr.to.z);
      fa.setX(i, Math.max(0, tr.flash));
    });
    hp.needsUpdate = tp.needsUpdate = fp.needsUpdate = fa.needsUpdate = true;
  }
}

const HEAT_COLD = new THREE.Color('#401000');
const HEAT_HOT = new THREE.Color('#ff7a33');

/** Thermal glow: emissive tint on a component proportional to normalised heat (0..1). */
export function setHeat(obj: THREE.Object3D, level: number): void {
  const c = HEAT_COLD.clone().lerp(HEAT_HOT, THREE.MathUtils.clamp(level, 0, 1));
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    if (!m.userData.baseEmissive) {
      m.userData.baseEmissive = m.emissive.clone();
      m.userData.baseEmissiveIntensity = m.emissiveIntensity;
    }
    if (level <= 0) {
      m.emissive.copy(m.userData.baseEmissive as THREE.Color);
      m.emissiveIntensity = m.userData.baseEmissiveIntensity as number;
    } else {
      m.emissive.copy(c);
      m.emissiveIntensity = 0.25 + 1.4 * level;
    }
  });
}

/** Cyclic phase colormap (dark-safe): maps phase in radians → colour. */
export function phaseColor(phase: number, target = new THREE.Color()): THREE.Color {
  const t = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  const stops = ['#2a6fdb', '#29b3c9', '#e6edf3', '#e0a23a', '#c4452f', '#2a6fdb'].map((s) => new THREE.Color(s));
  const x = t * (stops.length - 1);
  const i = Math.floor(x);
  return target.copy(stops[i]).lerp(stops[Math.min(i + 1, stops.length - 1)], x - i);
}

/** Sequential colormap for gain / field magnitude (dark navy → cyan → near-white). */
export function magnitudeColor(t: number, target = new THREE.Color()): THREE.Color {
  const stops = ['#0b1f3a', '#15508a', '#1f8fc2', '#6fd0e6', '#f2f7fa'].map((s) => new THREE.Color(s));
  const x = THREE.MathUtils.clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.floor(x);
  return target.copy(stops[i]).lerp(stops[Math.min(i + 1, stops.length - 1)], x - i);
}
