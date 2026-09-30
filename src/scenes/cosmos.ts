import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelId } from '../app/navigation';
import type { AppState, EngMode } from '../app/state';
import { createEarth } from '../graphics/earth';
import { COLORS, mat } from '../graphics/materials';
import { FlowPath, pointsMaterial, syncPointScale } from '../graphics/particles';
import { v3 } from '../graphics/geometry';
import { BaseLevel, type Anchor } from './base';

const RE = 10; // scene units per Earth radius
const RE_KM = 6371;

interface Shell {
  planes: number;
  perPlane: number;
  incDeg: number;
  altKm: number;
  phasing: number;
}

const SHELLS: Shell[] = [
  { planes: 24, perPlane: 22, incDeg: 53, altKm: 550, phasing: 1 },
  { planes: 12, perPlane: 16, incDeg: 70, altKm: 570, phasing: 1 },
];

/** Orbit state in a Y-up frame (ECI z → scene y). */
function orbitState(raan: number, inc: number, u: number, r: number, pos: THREE.Vector3, vel?: THREE.Vector3): void {
  const cO = Math.cos(raan), sO = Math.sin(raan), cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(inc), si = Math.sin(inc);
  const x = cO * cu - sO * su * ci;
  const y = sO * cu + cO * su * ci;
  const z = su * si;
  pos.set(x * r, z * r, -y * r);
  if (vel) {
    const vx = -cO * su - sO * cu * ci;
    const vy = -sO * su + cO * cu * ci;
    const vz = cu * si;
    vel.set(vx, vz, -vy).normalize();
  }
}

/**
 * LEVEL 0 — Earth and a two-shell Walker-delta LEO constellation with
 * optical inter-satellite links, the hero satellite's coverage cone and a
 * user-terminal downlink geometry driven by the link-budget elevation.
 * Satellite markers are enlarged for visibility (not to scale).
 */
export class CosmosLevel extends BaseLevel {
  readonly id = 'cosmos' as const;
  readonly radius = RE;
  home = { pos: v3(15, 13, 34), target: v3(0, 0.5, 0) };
  private earth!: ReturnType<typeof createEarth>;
  private sats!: THREE.InstancedMesh;
  private glow!: THREE.Points;
  private isl!: THREE.LineSegments;
  private slots: { shell: number; raan: number; inc: number; u0: number; r: number; plane: number; idx: number }[] = [];
  private orbitT = 0;
  private heroIdx = 0;
  private hero!: THREE.Group;
  private heroRing!: THREE.Mesh;
  private user!: THREE.Group;
  private beam!: THREE.Mesh;
  private beamFlow!: FlowPath;
  private coverage!: THREE.Line;
  private belts!: THREE.Group;
  private heroPos = new THREE.Vector3();
  private heroVel = new THREE.Vector3();
  private readonly omega = (2 * Math.PI) / 60; // one orbit per minute (time-lapse ×95)

  build(): void {
    this.earth = createEarth({ radius: RE, sunDir: this.ctx.sunDir });
    this.root.add(this.earth.group);
    this.addComponent({ id: 'earth', name: 'Earth', sub: 'R = 6371 km', object: this.earth.group, labelLocal: v3(-6, -6, 5), desc: 'Procedurally shaded Earth (continents, ocean glint, night lights, clouds, atmosphere).', specs: ['Scene: 1 unit = 637 km', 'Sun direction shared with key light'], label: false });

    // --- constellation ---
    const body = new THREE.BoxGeometry(0.03, 0.012, 0.02);
    const wingA = new THREE.BoxGeometry(0.008, 0.002, 0.07).translate(0, 0, 0.05);
    const wingB = wingA.clone().translate(0, 0, -0.1);
    const satGeo = mergeGeometries([body, wingA, wingB])!;
    let total = 0;
    SHELLS.forEach((s) => (total += s.planes * s.perPlane));
    this.sats = new THREE.InstancedMesh(satGeo, mat.aluminum(), total);
    this.sats.frustumCulled = false;
    SHELLS.forEach((s, si) => {
      const r = RE * (RE_KM + s.altKm) / RE_KM;
      for (let p = 0; p < s.planes; p++) {
        for (let j = 0; j < s.perPlane; j++) {
          this.slots.push({
            shell: si,
            raan: (2 * Math.PI * p) / s.planes,
            inc: (s.incDeg * Math.PI) / 180,
            u0: (2 * Math.PI * j) / s.perPlane + (2 * Math.PI * s.phasing * p) / (s.planes * s.perPlane),
            r,
            plane: p,
            idx: j,
          });
        }
      }
    });
    const gp = new Float32Array(total * 3);
    const gph = new Float32Array(total).fill(0.7);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('aPhase', new THREE.BufferAttribute(gph, 1));
    this.glow = new THREE.Points(gg, pointsMaterial('#bfe3ff', 0.06));
    this.glow.frustumCulled = false;
    // ISLs: in-plane + cross-plane (first shell only)
    const s0 = SHELLS[0];
    const nIsl = s0.planes * s0.perPlane * 2;
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nIsl * 6), 3));
    this.isl = new THREE.LineSegments(ig, new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.isl.frustumCulled = false;
    // orbit rings
    // all orbit planes in a single LineSegments draw call
    const ringMat = new THREE.LineBasicMaterial({ color: '#6d88b0', transparent: true, opacity: 0.045, depthWrite: false });
    const ringPts: THREE.Vector3[] = [];
    SHELLS.forEach((s) => {
      const r = RE * (RE_KM + s.altKm) / RE_KM;
      for (let p = 0; p < s.planes; p++) {
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        for (let k = 0; k < 128; k++) {
          orbitState((2 * Math.PI * p) / s.planes, (s.incDeg * Math.PI) / 180, (2 * Math.PI * k) / 128, r, a);
          orbitState((2 * Math.PI * p) / s.planes, (s.incDeg * Math.PI) / 180, (2 * Math.PI * (k + 1)) / 128, r, b);
          ringPts.push(a.clone(), b.clone());
        }
      }
    });
    const rings = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat);
    const constellation = new THREE.Group();
    constellation.add(this.sats, this.glow, this.isl, rings);
    this.root.add(constellation);
    this.addComponent({ id: 'constellation', name: 'LEO Constellation', sub: '720 satellites · 2 shells', object: constellation, labelLocal: v3(-9, 7.5, 2), desc: 'Two Walker-delta shells (24×22 @ 53°, 550 km; 12×16 @ 70°, 570 km) meshed by optical inter-satellite links (ISLs).', specs: ['Orbital period ≈ 95.6 min (animated ×95)', 'In-plane + cross-plane ISLs', 'Markers enlarged ~2000× for visibility'] });

    // --- hero satellite ---
    this.hero = new THREE.Group();
    const heroBody = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.02), mat.mli('gold'));
    const heroWing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.16), mat.solarCell());
    this.hero.add(heroBody, heroWing);
    this.heroRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.13, 64), new THREE.MeshBasicMaterial({ color: '#e8f1ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    this.hero.add(this.heroRing);
    this.root.add(this.hero);
    this.addComponent({ id: 'hero', name: 'LEO-BB-01', sub: '550 km · 53° · click to enter', object: this.hero, desc: 'The satellite followed through every scale of this visualization.', specs: ['Altitude 550 km, inclination 53°', 'v ≈ 7.6 km/s', 'Enter to see the spacecraft'], child: 'satellite' });

    // --- user terminal, downlink, coverage ---
    this.user = new THREE.Group();
    this.user.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8), mat.emissive('#ffd28a', 1.4)));
    this.root.add(this.user);
    this.addComponent({ id: 'user', name: 'User Terminal', sub: 'Ka-band ground station', object: this.user, desc: 'Flat-panel user terminal; its elevation angle to the satellite sets the slant range used in the link budget.', specs: ['G/T ≈ 12 dB/K (illustrative)', 'Rx gain 36 dBi'] });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8, 1, true), mat.emissive(COLORS.signal, 1.5, 0.7));
    this.root.add(this.beam);
    this.beamFlow = this.addFlow('signal', new FlowPath([v3(0, 0, 0), v3(0, 1, 0)], { color: COLORS.signal, count: 18, size: 0.05, speed: 0.6 }));
    this.coverage = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#8fb8e8', transparent: true, opacity: 0.45 }));
    this.root.add(this.coverage);

    // --- Van Allen belts (RADIATION mode) ---
    this.belts = new THREE.Group();
    const beltMat = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const inner = new THREE.Mesh(new THREE.TorusGeometry(RE * 1.55, RE * 0.32, 32, 128), beltMat('#b07cff', 0.12));
    const outer = new THREE.Mesh(new THREE.TorusGeometry(RE * 4.2, RE * 1.1, 32, 128), beltMat('#7c6cff', 0.06));
    for (const m of [inner, outer]) {
      m.rotation.x = Math.PI / 2;
      m.scale.set(1, 1, 0.75);
    }
    this.belts.add(inner, outer);
    this.belts.rotation.z = 0.19; // ~11° dipole tilt
    this.belts.userData.hidden = true;
    this.root.add(this.belts);
    this.addComponent({ id: 'belts', name: 'Van Allen Belts', sub: 'Trapped p⁺ / e⁻', object: this.belts, labelLocal: v3(RE * 1.55, 0, 0), desc: 'Trapped-particle belts. LEO spacecraft cross the South Atlantic Anomaly where the inner belt dips closest to Earth, raising single-event-effect rates.', specs: ['Inner belt: protons, ~1000–6000 km', 'Outer belt: electrons, ~13 000–60 000 km', 'Schematic geometry'] });

    // hero: a first-shell satellite over the morning side of the planet (sunlit, near the terminator)
    const sun = this.ctx.sunDir.clone().normalize();
    let best = Infinity;
    const tmp = new THREE.Vector3();
    this.slots.forEach((s, i) => {
      if (s.shell !== 0) return;
      orbitState(s.raan, s.inc, s.u0, s.r, tmp);
      const d = Math.abs(tmp.normalize().dot(sun) - 0.55);
      if (d < best) {
        best = d;
        this.heroIdx = i;
      }
    });
    this.modeFocus = {
      signal: ['constellation', 'hero', 'user'],
      power: ['earth', 'hero'],
      thermal: ['earth', 'hero'],
      radiation: ['belts', 'hero', 'earth'],
    };
    this.updateOrbits();
  }

  protected onModeChanged(mode: EngMode): void {
    if (!this.belts) return;
    this.belts.userData.hidden = mode !== 'radiation';
    (this.isl.material as THREE.LineBasicMaterial).opacity = mode === 'signal' ? 0.45 : 0.08;
    this.markOpacityDirty();
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'satellite') return null;
    this.updateOrbits();
    const y = this.heroPos.clone().normalize();
    const x = this.heroVel.clone();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    x.crossVectors(y, z).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    return { position: this.heroPos.clone(), size: 0.08, quaternion: q, focus: 'hero' };
  }

  onState(state: AppState, changed: Set<string>): void {
    if (changed.has('params.elevationDeg') || changed.has('params.altitudeKm')) this.updateUser(state);
  }

  private updateOrbits(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const up = new THREE.Vector3();
    const zAx = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const gp = this.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions: THREE.Vector3[] = [];
    this.slots.forEach((s, i) => {
      orbitState(s.raan, s.inc, s.u0 + this.omega * this.orbitT, s.r, pos, vel);
      up.copy(pos).normalize();
      zAx.crossVectors(vel, up).normalize();
      q.setFromRotationMatrix(m.makeBasis(vel, up, zAx));
      m.compose(pos, q, one);
      this.sats.setMatrixAt(i, m);
      gp.setXYZ(i, pos.x, pos.y, pos.z);
      if (s.shell === 0) positions.push(pos.clone());
      if (i === this.heroIdx) {
        this.heroPos.copy(pos);
        this.heroVel.copy(vel);
      }
    });
    this.sats.instanceMatrix.needsUpdate = true;
    gp.needsUpdate = true;
    const s0 = SHELLS[0];
    const ip = this.isl.geometry.getAttribute('position') as THREE.BufferAttribute;
    let k = 0;
    for (let p = 0; p < s0.planes; p++) {
      for (let j = 0; j < s0.perPlane; j++) {
        const a = positions[p * s0.perPlane + j];
        const b = positions[p * s0.perPlane + ((j + 1) % s0.perPlane)];
        const c = positions[((p + 1) % s0.planes) * s0.perPlane + j];
        ip.setXYZ(k++, a.x, a.y, a.z);
        ip.setXYZ(k++, b.x, b.y, b.z);
        ip.setXYZ(k++, a.x, a.y, a.z);
        ip.setXYZ(k++, c.x, c.y, c.z);
      }
    }
    ip.needsUpdate = true;
    // hero
    const y = this.heroPos.clone().normalize();
    const z = new THREE.Vector3().crossVectors(this.heroVel, y).normalize();
    this.hero.position.copy(this.heroPos);
    this.hero.quaternion.setFromRotationMatrix(m.makeBasis(this.heroVel, y, z));
    this.updateUser(this.ctx.store.get());
  }

  private updateUser(state: AppState): void {
    if (!this.user) return;
    const el = (state.params.elevationDeg * Math.PI) / 180;
    const rs = RE * (RE_KM + state.params.altitudeKm) / RE_KM;
    const nadir = this.heroPos.clone().normalize();
    const cross = new THREE.Vector3().crossVectors(this.heroVel, nadir).normalize();
    const gamma = Math.acos((RE * Math.cos(el)) / rs) - el;
    const u = nadir.clone().multiplyScalar(Math.cos(gamma)).addScaledVector(cross, Math.sin(gamma)).multiplyScalar(RE * 1.002);
    this.user.position.copy(u);
    const d = this.heroPos.clone().sub(u);
    this.beam.position.copy(u).addScaledVector(d, 0.5);
    this.beam.scale.set(1, d.length(), 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.beamFlow.group.position.copy(this.heroPos);
    this.beamFlow.group.scale.set(1, d.length(), 1);
    this.beamFlow.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize().negate());
    // coverage circle for min elevation 25°
    const elMin = (25 * Math.PI) / 180;
    const gMax = Math.acos((RE * Math.cos(elMin)) / rs) - elMin;
    const pts: THREE.Vector3[] = [];
    const a1 = cross;
    const a2 = new THREE.Vector3().crossVectors(nadir, a1).normalize();
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      const dir = a1.clone().multiplyScalar(Math.cos(t)).addScaledVector(a2, Math.sin(t));
      pts.push(nadir.clone().multiplyScalar(Math.cos(gMax)).addScaledVector(dir, Math.sin(gMax)).multiplyScalar(RE * 1.003));
    }
    this.coverage.geometry.dispose();
    this.coverage.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  protected tick(dt: number, state: AppState): void {
    this.earth.update(this.time);
    if (this.active) {
      this.orbitT += dt;
      this.updateOrbits();
    }
    syncPointScale(this.glow);
    const s = this.decorative ? 1 + 0.12 * Math.sin(this.time * 3) : 1;
    this.heroRing.scale.setScalar(s);
    this.heroRing.lookAt(this.hero.position.clone().multiplyScalar(2));
    void state;
  }
}
