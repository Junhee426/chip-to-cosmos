import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelId } from '../app/navigation';
import type { AppState, EngMode } from '../app/state';
import { createEarth } from '../graphics/earth';
import { COLORS, mat } from '../graphics/materials';
import { FlowPath, pointsMaterial, syncPointScale } from '../graphics/particles';
import { v3 } from '../graphics/geometry';
import { BaseLevel, type Anchor, type OrbitState } from './base';
import { beamSolution } from '../app/system';
import { POSTER_STATE, POSTER_STEER } from '../app/beam-presets';
import type { Vec3 } from '../models/frames';
import type { View } from '../graphics/camera';

const RE = 10; // scene units per Earth radius
const RE_KM = 6371;
/** scene units per km */
const S = RE / RE_KM;
/** footprint drawn slightly above the surface (≈ 6 km) to avoid z-fighting */
const LIFT = 1.001;
const MAX_FP = 96;
/** poster pose relative to the satellite–footprint midpoint, scene units (Re = 10) */
const POSTER_POSE = { side: 1.35, up: 0.10, along: -0.85, lift: 0.03 };
const POSTER_HERO_SCALE = 3.4;
/** Try-it sweep the poster frame must hold without moving the camera (reference steer = POSTER_STATE) */
const POSTER_FIT_STEERS = [POSTER_STEER.min, 25, POSTER_STEER.max];
const POSTER_FIT_MARGIN_PX = 10;
/** terminal marker size relative to the overview marker while the poster is shown */
const POSTER_TERMINAL_SCALE = 0.3;

/** poster: the hero is shown at a fixed enlargement so its Earth-facing aperture reads (illustrative size) */
const posterHeroScale = (aspect: number) => POSTER_HERO_SCALE * Math.sqrt(Math.min(2.2, Math.max(1, 1.25 / aspect)));

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
  private constellation!: THREE.Group;
  private user!: THREE.Group;
  private beam!: THREE.Mesh;
  private beamFlow!: FlowPath;
  private coverage!: THREE.Line;
  private belts!: THREE.Group;
  private heroPos = new THREE.Vector3();
  /** footprint in the CANONICAL orbit frame (Earth-centred); rotated with the hero's orbit basis */
  private fp = new THREE.Group();
  private fpFill!: THREE.Mesh;
  private fpLine!: THREE.LineLoop;
  private fpRays!: THREE.LineSegments;
  private fpCenter!: THREE.Mesh;
  private fpLabel = new THREE.Object3D();
  private fpSecondary!: THREE.LineSegments;
  private fpLobeLabel = new THREE.Object3D();
  private fpKey = '';
  private heroBasis = new THREE.Matrix4();
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
    this.constellation = constellation;
    constellation.add(this.sats, this.glow, this.isl, rings);
    this.root.add(constellation);
    this.addComponent({ id: 'constellation', name: 'LEO Constellation', sub: '720 satellites · 2 shells', object: constellation, labelLocal: v3(-9, 7.5, 2), desc: 'Two Walker-delta shells (24×22 @ 53°, 550 km; 12×16 @ 70°, 570 km) meshed by optical inter-satellite links (ISLs).', specs: ['Orbital period ≈ 95.6 min (animated ×95)', 'In-plane + cross-plane ISLs', 'Markers enlarged ~2000× for visibility'] });

    // --- hero satellite ---
    this.hero = new THREE.Group();
    const heroBody = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.02), mat.mli('gold'));
    const heroWing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.16), mat.solarCell());
    // Earth-facing phased-array aperture on the nadir deck (local −Y = toward the Earth centre)
    const aperture = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.0016, 0.015), new THREE.MeshStandardMaterial({ color: '#0d1b2a', emissive: new THREE.Color(COLORS.signal), emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.5 }));
    aperture.position.y = -0.0098;
    aperture.name = 'earth-facing-array';
    aperture.userData.keep = true;
    const apEdge = new THREE.LineSegments(new THREE.EdgesGeometry(aperture.geometry), new THREE.LineBasicMaterial({ color: '#cfe9ff' }));
    apEdge.position.copy(aperture.position);
    this.hero.add(heroBody, heroWing, aperture, apEdge);
    // Visible tile seams identify the fixed aperture even at poster scale.
    const seams: THREE.Vector3[] = [];
    for (let i = 1; i < 4; i++) {
      const x = -0.013 + i * 0.0065, z = -0.0075 + i * 0.00375;
      seams.push(v3(x, -0.0107, -0.0075), v3(x, -0.0107, 0.0075));
      seams.push(v3(-0.013, -0.0107, z), v3(0.013, -0.0107, z));
    }
    this.hero.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seams), new THREE.LineBasicMaterial({ color: '#cfe9ff' })));
    this.heroRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.13, 64), new THREE.MeshBasicMaterial({ color: '#e8f1ff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    this.hero.add(this.heroRing);
    this.root.add(this.hero);
    this.addComponent({ id: 'hero', name: 'Satellite', sub: 'LEO-BB-01 · enter ›', object: this.hero, desc: 'The satellite followed through every scale of this visualization.', specs: ['Altitude 550 km, inclination 53°', 'v ≈ 7.6 km/s', 'Enter to see the spacecraft'], child: 'satellite' });
    this.addComponent({ id: 'hero-array', name: 'Earth-facing array', sub: 'Fixed to nadir · beam steers electronically', object: aperture, labelLocal: v3(0, -0.0008, 0), desc: 'The physical aperture is fixed on the nadir deck. Its normal points toward the Earth centre; steering changes element phase only.', specs: ['Fixed panel orientation', 'Satellite size enlarged for visibility'], essential: true });

    // --- −3 dB footprint on the spherical Earth (shared BeamSolution) ---
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FP * 9), 3));
    this.fpFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    this.fpLine = new THREE.LineLoop(posBuffer(MAX_FP), new THREE.LineBasicMaterial({ color: '#e8f6ff' }));
    this.fpRays = new THREE.LineSegments(posBuffer(18), new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.55, depthWrite: false }));
    this.fpSecondary = new THREE.LineSegments(posBuffer(4 * 2 * 64 + 8), new THREE.LineDashedMaterial({ color: '#f0b44c', dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.85 }));
    this.fpCenter = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 12, 8), mat.emissive('#ffffff', 0.9));
    this.fp.add(this.fpFill, this.fpLine, this.fpRays, this.fpSecondary, this.fpCenter, this.fpLabel, this.fpLobeLabel);
    this.fp.matrixAutoUpdate = false;
    this.root.add(this.fp);
    this.addComponent({ id: 'grating-area', name: 'Grating Lobe', sub: 'unintended illumination', object: this.fpLobeLabel, desc: 'Footprint of a grating lobe (dashed): a second area on the ground that receives the signal although the beam was steered elsewhere. Only drawn when the model finds a lobe ≥ −10 dB that intersects the Earth.', specs: ['Calculated lobe direction and contour'], essential: true });
    this.addComponent({ id: 'footprint', name: '−3 dB Footprint', sub: 'main beam · spherical Earth', object: this.fpLabel, desc: 'The −3 dB contour of the BEAM LAB array pattern, carried array → spacecraft → Earth frame and intersected with the spherical Earth. Steering moves it; array size and taper resize it. Amber contours are grating-lobe footprints (only when the model finds a lobe that reaches the ground).', specs: ['Same array factor as BEAM LAB', 'Ray–sphere intersection per contour direction'], essential: true });

    // --- user terminal, downlink, coverage ---
    this.user = new THREE.Group();
    this.user.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8), mat.emissive('#ffd28a', 1.4)));
    this.root.add(this.user);
    this.addComponent({ id: 'user', name: 'Ground Terminal', sub: 'beam centre · link target', object: this.user, desc: 'Flat-panel user terminal placed at the centre of the calculated footprint. Its elevation angle and slant range come from that geometry and feed the link budget, so the drawn link and the numbers are the same link.', specs: ['Rx noise temperature 250 K', 'Rx gain from link settings'] });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8, 1, true), mat.emissive(COLORS.signal, 1.5, 0.7));
    this.root.add(this.beam);
    this.addComponent({ id: 'downlink', name: 'Downlink path', sub: 'free-space propagation', object: this.beam, desc: 'Line of sight from the satellite to the user terminal at the beam centre; its length is the slant range that sets the free-space path loss.', label: false });
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
      signal: ['constellation', 'hero', 'hero-array', 'user', 'footprint', 'downlink', 'grating-area'],
      power: ['earth', 'hero'],
      thermal: ['earth', 'hero'],
      radiation: ['belts', 'hero', 'earth'],
    };
    this.updateOrbits();
  }

  protected onModeChanged(mode: EngMode): void {
    this.setPoster(this.ctx.store.get().presentation);
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
    if (changed.has('presentation')) this.setPoster(state.presentation);
    // applied once per rendered frame in tick (a drag never runs the model per input event)
    if (['params.arrayN', 'params.spacingLambda', 'params.steerDeg', 'params.steerAzDeg', 'params.weighting', 'params.altitudeKm', 'params.freqGHz'].some((k) => changed.has(k))) this.fpDirty = true;
    void state;
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
    // hero: drawn at the link altitude (the shell slot sets its ground track)
    const y = this.heroPos.clone().normalize();
    this.heroPos.copy(y).multiplyScalar(RE * (RE_KM + this.ctx.store.get().params.altitudeKm) / RE_KM);
    const z = new THREE.Vector3().crossVectors(this.heroVel, y).normalize();
    this.heroVel.crossVectors(y, z).normalize();
    this.hero.position.copy(this.heroPos);
    this.heroBasis.makeBasis(this.heroVel, y, z);
    this.hero.quaternion.setFromRotationMatrix(this.heroBasis);
    // canonical orbit frame → this orbit position is a pure rotation about the Earth centre
    this.fp.matrix.copy(this.heroBasis);
    this.fp.matrixWorldNeedsUpdate = true;
    this.updateFootprint(this.ctx.store.get());
  }

  /** Footprint, rays, user terminal and downlink — all from the shared BeamSolution. */
  private updateFootprint(state: AppState): void {
    if (!this.user) return;
    const p = state.params;
    const sol = beamSolution(p);
    const key = [p.arrayN, p.spacingLambda, p.steerDeg, p.steerAzDeg, p.weighting, p.altitudeKm, p.freqGHz].join('|');
    if (key !== this.fpKey) {
      this.fpKey = key;
      const f = sol.footprint;
      const sat = new THREE.Vector3(0, (RE_KM + p.altitudeKm) * S, 0);
      const lift = (g: Vec3) => new THREE.Vector3(g[0], g[1], g[2]).multiplyScalar(S * LIFT);
      const pts = f.contour.map(lift);
      const centre = f.center ? lift(f.center) : null;
      const ok = pts.length >= 3;
      writeLine(this.fpLine.geometry, ok ? pts : []);
      const fan: THREE.Vector3[] = [];
      if (ok) {
        const c = centre ?? pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
        pts.forEach((q, i) => fan.push(c, q, pts[(i + 1) % pts.length]));
      }
      writeLine(this.fpFill.geometry, fan);
      const rays: THREE.Vector3[] = [];
      if (centre) rays.push(sat, centre);
      if (ok) for (let e = 0; e < 8; e++) rays.push(sat, pts[Math.floor((e * pts.length) / 8)]);
      writeLine(this.fpRays.geometry, rays);
      const sec: THREE.Vector3[] = [];
      for (const s2 of sol.secondary.slice(0, 4)) {
        const sp = s2.earth.contour.map(lift);
        sp.forEach((q, i) => sec.push(q, sp[(i + 1) % sp.length]));
        if (s2.earth.center) sec.push(sat, lift(s2.earth.center));
      }
      writeLine(this.fpSecondary.geometry, sec);
      this.fpSecondary.computeLineDistances();
      const s0 = sol.secondary[0];
      this.fpLobeLabel.visible = !!s0?.earth.center;
      if (s0?.earth.center) this.fpLobeLabel.position.copy(lift(s0.earth.center));
      this.fpCenter.visible = !!centre;
      if (centre) this.fpCenter.position.copy(centre);
      this.fpLabel.position.copy(centre ?? (ok ? pts[0] : sat));
    }
    // user terminal at the beam centre; the downlink is the same geometry the link budget uses
    const c = sol.footprint.center;
    this.user.visible = this.beam.visible = !!c;
    this.beamFlow.group.visible = !!c;
    if (!c) return;
    const u = new THREE.Vector3(c[0], c[1], c[2]).multiplyScalar(S * LIFT).applyMatrix4(this.heroBasis);
    this.user.position.copy(u);
    const d = this.heroPos.clone().sub(u);
    this.beam.position.copy(u).addScaledVector(d, 0.5);
    this.beam.scale.set(1, d.length(), 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.beamFlow.group.position.copy(this.heroPos);
    this.beamFlow.group.scale.set(1, d.length(), 1);
    this.beamFlow.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize().negate());
    // coverage circle for min elevation 25° (context)
    const rs = RE * (RE_KM + p.altitudeKm) / RE_KM;
    const nadir = this.heroPos.clone().normalize();
    const cross = new THREE.Vector3().crossVectors(this.heroVel, nadir).normalize();
    const elMin = (25 * Math.PI) / 180;
    const gMax = Math.acos((RE * Math.cos(elMin)) / rs) - elMin;
    const ring: THREE.Vector3[] = [];
    const a2 = new THREE.Vector3().crossVectors(nadir, cross).normalize();
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      const dir = cross.clone().multiplyScalar(Math.cos(t)).addScaledVector(a2, Math.sin(t));
      ring.push(nadir.clone().multiplyScalar(Math.cos(gMax)).addScaledVector(dir, Math.sin(gMax)).multiplyScalar(RE * 1.003));
    }
    this.coverage.geometry.dispose();
    this.coverage.geometry = new THREE.BufferGeometry().setFromPoints(ring);
  }

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  /**
   * Hero, user terminal and downlink are enlarged for the orbital overview. Close
   * to the hero they shrink with camera distance, so they never hide a ~100 km
   * footprint (the footprint and rays themselves are never rescaled).
   */
  private scaleMarkers(): void {
    const cam = this.ctx.camera;
    if (!cam || !this.user) return;
    const rootScale = this.root.getWorldScale(this.tmpA).x || 1;
    const d = cam.getWorldPosition(this.tmpA).distanceTo(this.hero.getWorldPosition(this.tmpB)) / rootScale;
    const k = THREE.MathUtils.clamp(d / 8, 0.04, 1);
    const aspect = (cam as THREE.PerspectiveCamera).aspect;
    this.hero.scale.setScalar(this.poster ? posterHeroScale(aspect) : k);
    // poster: the terminal is a small point inside the contour, never a glow that covers it
    this.user.scale.setScalar(this.poster ? k * POSTER_TERMINAL_SCALE : k);
    this.fpCenter.scale.setScalar(this.poster ? 0.3 : Math.max(k, 0.3));

    this.beam.scale.x = this.beam.scale.z = k;
  }

  private poster = false;

  /** Presentation look: a denser −3 dB fill so the contour reads as an area at poster scale. */
  private setPoster(v: boolean): void {
    this.poster = v;
    const m = this.fpFill?.material as THREE.MeshBasicMaterial | undefined;
    if (!m) return;
    const base = v ? 0.5 : 0.28;
    const fade = m.userData.fade as { baseOpacity: number } | undefined;
    if (fade) fade.baseOpacity = base;
    m.opacity = base;
    this.markOpacityDirty();
  }

  /**
   * Hero-demo framings. 'poster' is the project's signature frame: the satellite (Earth-facing
   * aperture), its beam and the −3 dB footprint on the curved Earth, with the limb and space above.
   */
  demoView(stage: string): View | null {
    if (stage === 'poster') {
      this.updateOrbits();
      const up = this.heroPos.clone().normalize();
      const along = this.heroVel.clone();
      const side = new THREE.Vector3().crossVectors(along, up).normalize();
      const params = this.ctx.store.get().params;
      // Anchor on the reference steer so the frame does not depend on where the Try-it slider is.
      const ref = beamSolution({ ...params, steerDeg: POSTER_STATE.steerDeg! }).footprint.center;
      const ground = ref ? this.toWorld(ref) : this.fpLabel.position.clone().applyMatrix4(this.heroBasis);
      const mid = ground.clone().lerp(this.heroPos, 0.5);
      const cam = this.ctx.camera as THREE.PerspectiveCamera | undefined;
      const aspect = cam?.aspect ?? 1.6;
      // Reserve vertical room for the title and the metrics/controls card.
      // Portrait also reserves the 0–50° Try-it sweep; the camera stays fixed
      // while the beam moves, so steering never appears to move the panel.
      const k0 = Math.min(3.2, Math.max(1.65, 1.45 / aspect));
      if (aspect < 0.8) mid.addScaledVector(along, 0.22);
      // Camera below the nadir deck sees the radiating face; local radial up makes
      // Earth read as ground beneath the satellite at every orbit position.
      const target = mid.clone().addScaledVector(up, POSTER_POSE.lift);
      const dir = new THREE.Vector3().addScaledVector(side, POSTER_POSE.side).addScaledVector(up, POSTER_POSE.up).addScaledVector(along, POSTER_POSE.along);
      const at = (k: number) => mid.clone().addScaledVector(dir, k);
      // Back off only as far as needed for the satellite and every −3 dB contour point of
      // the 0/25/50° sweep to sit inside the safe viewport (computed from scratch: no drift).
      const k = cam ? this.fitPoster(cam, at, target, up, this.posterFitPoints(params, aspect), k0) : k0;
      return { pos: at(k), target, up };
    }
    if (stage !== 'earth-footprint' && stage !== 'link') return null;
    this.updateOrbits();
    const up = this.heroPos.clone().normalize();
    const along = this.heroVel.clone();
    const side = new THREE.Vector3().crossVectors(along, up).normalize();
    // frame the satellite, its rays, the footprint and any grating-lobe footprints together
    const sol = beamSolution(this.ctx.store.get().params);
    const pts = [this.heroPos.clone(), this.fpLabel.position.clone().applyMatrix4(this.heroBasis)];
    for (const s2 of sol.secondary) if (s2.earth.center) pts.push(new THREE.Vector3(...s2.earth.center).multiplyScalar(S * LIFT).applyMatrix4(this.heroBasis));
    const mid = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
    const extent = Math.max(...pts.map((q) => q.distanceTo(mid)));
    // portrait screens: back off so the satellite → footprint line still fits across the width
    const aspect = (this.ctx.camera as THREE.PerspectiveCamera | undefined)?.aspect ?? 1.6;
    const k = Math.max(0.6, extent / 0.36) * (stage === 'link' ? 1.25 : 1) * Math.min(3, Math.max(1, 1.3 / aspect));
    // look across the ground track (perpendicular to the satellite → footprint line), slightly from above
    return { pos: mid.clone().addScaledVector(side, 1.15 * k).addScaledVector(up, 0.42 * k).addScaledVector(along, -0.2 * k), target: mid };
  }

  /** canonical-frame km (Earth centred) → this level's units at the current orbit position */
  private toWorld(g: Vec3): THREE.Vector3 {
    return new THREE.Vector3(g[0], g[1], g[2]).multiplyScalar(S * LIFT).applyMatrix4(this.heroBasis);
  }

  /** Satellite body corners (at poster enlargement) and the −3 dB contours of the Try-it sweep. */
  private posterFitPoints(params: AppState['params'], aspect: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const h = posterHeroScale(aspect);
    for (const x of [-0.0175, 0.0175]) for (const y of [-0.011, 0.009]) for (const z of [-0.01, 0.01]) pts.push(new THREE.Vector3(x * h, y * h, z * h).applyQuaternion(this.hero.quaternion).add(this.heroPos));
    const steers = new Set([...POSTER_FIT_STEERS, Math.min(POSTER_STEER.max, Math.max(POSTER_STEER.min, params.steerDeg))]);
    for (const steerDeg of steers) {
      // sample solutions only — the store parameters are never touched
      const f = beamSolution({ ...params, steerDeg }).footprint;
      for (const g of f.contour) pts.push(this.toWorld(g));
      if (f.center) pts.push(this.toWorld(f.center));
    }
    return pts;
  }

  private fitCam = new THREE.PerspectiveCamera();
  /** Smallest pose scale ≥ k0 that keeps every point inside the safe viewport (label insets). */
  private fitPoster(cam: THREE.PerspectiveCamera, at: (k: number) => THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, pts: THREE.Vector3[], k0: number): number {
    const W = innerWidth;
    const H = innerHeight;
    const ins = this.ctx.labels.insets;
    const ex = this.ctx.labels.exclusions;
    const m = POSTER_FIT_MARGIN_PX;
    const fc = this.fitCam;
    fc.fov = cam.fov;
    fc.aspect = W / H;
    fc.near = 0.001;
    fc.far = 1000;
    // same principal-point shift the viewport controller applies for these insets
    fc.setViewOffset(W, H, -((ins.left + W - ins.right) / 2 - W / 2), -((ins.top + H - ins.bottom) / 2 - H / 2), W, H);
    const v = new THREE.Vector3();
    const fits = (k: number) => {
      fc.position.copy(at(k));
      fc.up.copy(up);
      fc.lookAt(target);
      fc.updateMatrixWorld(true);
      fc.updateProjectionMatrix();
      for (const p of pts) {
        v.copy(p).project(fc);
        if (v.z <= -1 || v.z >= 1) return false;
        const sx = (v.x * 0.5 + 0.5) * W;
        const sy = (-v.y * 0.5 + 0.5) * H;
        if (sx < ins.left + m || sx > W - ins.right - m || sy < ins.top + m || sy > H - ins.bottom - m) return false;
        for (const e of ex) if (sx > e.left - m && sx < e.right + m && sy > e.top - m && sy < e.bottom + m) return false;
      }
      return true;
    };
    if (fits(k0)) return k0;
    let lo = k0;
    let hi = k0 * 1.5;
    while (!fits(hi)) {
      lo = hi;
      hi *= 1.5;
      if (hi > k0 * 8) return k0; // safe area too small to hold everything: keep the designed frame
    }
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** Reproducible poster: back to the reference orbit position. */
  resetOrbit(): void {
    this.orbitT = 0;
    this.updateOrbits();
  }

  /** Freeze/resume orbital motion (hero demo framing). */
  set orbitPaused(v: boolean) {
    this.paused = v;
  }
  private paused = false;

  orbitState(): OrbitState {
    return { time: this.orbitT, paused: this.paused };
  }

  setOrbitState(s: Partial<OrbitState>): void {
    if (s.paused !== undefined) this.paused = s.paused;
    if (s.time !== undefined && s.time !== this.orbitT) {
      this.orbitT = s.time;
      this.updateOrbits();
    }
  }

  private fpDirty = false;

  protected tick(dt: number, state: AppState): void {
    this.earth.update(this.time);
    if (this.active && !this.paused) {
      this.orbitT += dt;
      this.updateOrbits();
    } else if (this.fpDirty) this.updateFootprint(state);
    this.fpDirty = false;
    syncPointScale(this.glow);
    this.scaleMarkers();
    this.constellation.visible = !this.poster;
    this.coverage.visible = !this.poster;
    const s = this.decorative ? 1 + 0.12 * Math.sin(this.time * 3) : 1;
    this.heroRing.scale.setScalar(s);
    this.heroRing.visible = !this.poster; // the selection ring would dominate the enlarged poster marker
    this.heroRing.lookAt(this.hero.position.clone().multiplyScalar(2));
    void state;
  }
}

function posBuffer(capacity: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  return g;
}

/** Rewrite a fixed-capacity position buffer in place (no reallocation per update). */
function writeLine(g: THREE.BufferGeometry, pts: THREE.Vector3[]): void {
  const a = g.getAttribute('position') as THREE.BufferAttribute;
  const n = Math.min(pts.length, a.count);
  for (let i = 0; i < n; i++) a.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
  a.needsUpdate = true;
  g.setDrawRange(0, n);
  g.computeBoundingSphere();
}
