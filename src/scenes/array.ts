import * as THREE from 'three';
import type { AppState } from '../app/state';
import { beamSolution } from '../app/system';
import type { GraphicsConfig } from '../app/quality';
import { COLORS, mat } from '../graphics/materials';
import { box, group, v3 } from '../graphics/geometry';
import { magnitudeColor, phaseColor } from '../graphics/effects';
import { elementPattern, planarAF, weights, type ArrayParams } from '../models/array-factor';
import type { BeamSolution } from '../models/beam-solution';
import type { Vec3 } from '../models/frames';
import { wavelengthM } from '../models/units';
import { BaseLevel } from './base';

const DR = 30; // dynamic range shown on the 3D radiation surface (dB)
const R_MAX = 11; // radius of the 0 dB point (scene units)
const NT = 72;
const NP = 144;
/** ground plane height in the lab (directions are projected exactly; the distance is not to scale) */
const GROUND_Y = 14;
const MAX_WAVES = 12;
const MAX_CONTOUR = 96;
const EDGE_RAYS = 8;
const LOBE_COLOR = '#f0b44c';

/** Flat-ground point of an ARRAY LOCAL direction at the lab ground plane. */
const toGround = (d: Vec3, out: THREE.Vector3): THREE.Vector3 => out.set((d[0] / d[1]) * GROUND_Y, GROUND_Y - 0.02, (d[2] / d[1]) * GROUND_Y);
const surfaceRadius = (db: number): number => R_MAX * Math.max(0, (db + DR) / DR);

/** Fixed-capacity line buffer: positions are rewritten in place, never reallocated. */
function lineBuffer(capacity: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  return g;
}
function writePoints(g: THREE.BufferGeometry, pts: THREE.Vector3[]): void {
  const a = g.getAttribute('position') as THREE.BufferAttribute;
  const n = Math.min(pts.length, a.count);
  for (let i = 0; i < n; i++) a.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
  a.needsUpdate = true;
  g.setDrawRange(0, n);
  g.computeBoundingSphere();
}

/**
 * BEAM LAB — planar phased array (units: cm). Every visual reads one
 * BeamSolution: element phase colours, wavefront tilt, the 3D radiation surface
 * (sampled from the same |AF·EP|), its −3 dB ring, the beam axis, edge rays,
 * the flat-ground footprint and any grating lobes. Nothing here is a decorative cone.
 */
export class ArrayLevel extends BaseLevel {
  readonly id = 'array' as const;
  readonly radius = 6;
  home = { pos: v3(33, 6, 38), target: v3(1, 8, 0) };
  private panel = new THREE.Group();
  private patches: THREE.InstancedMesh | null = null;
  private surface!: THREE.Mesh;
  private wire!: THREE.LineSegments;
  private waves: THREE.Mesh[] = [];
  private waveCount = MAX_WAVES;
  private beamAxis = new THREE.Vector3(0, 1, 0);
  private beamLabel = new THREE.Object3D();
  private sideLabel = new THREE.Object3D();
  private panelSize = 12;
  private key = '';
  private lambdaCm = 1.52;
  private axisLine!: THREE.Line;
  private ring3db!: THREE.LineLoop;
  private footFill!: THREE.Mesh;
  private footLine!: THREE.LineLoop;
  private footEdges!: THREE.LineSegments;
  private footCenter!: THREE.Mesh;
  private footLabel = new THREE.Object3D();
  private lobeGroup = new THREE.Group();
  private lobeAxes!: THREE.LineSegments;
  private lobeLines: THREE.LineLoop[] = [];
  private lobeLabel = new THREE.Object3D();
  private dirty = true;
  /** last solution drawn (exposed for the hero demo / tests) */
  solution: BeamSolution | null = null;

  build(): void {
    this.root.add(this.panel);
    this.addComponent({ id: 'panel', name: 'Array Tile', sub: 'N × N patch elements · colour = phase', object: this.panel, labelLocal: v3(-6, 0, 6), desc: 'Sub-array tile of the nadir phased array. Each patch element is driven with its own amplitude wₙ and phase φₙ; colour = the calculated progressive phase βx·i + βy·j.', specs: ['Patch elements on low-loss laminate', 'Element pattern ≈ cos^1.3 θ'] });

    const geo = new THREE.BufferGeometry();
    const n = (NT + 1) * (NP + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx: number[] = [];
    const lineIdx: number[] = [];
    for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) {
      const a = i * (NP + 1) + j;
      const b = a + NP + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
      if (j % 6 === 0) lineIdx.push(a, b);
      if (i % 6 === 0) lineIdx.push(a, a + 1);
    }
    geo.setIndex(idx);
    const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.45, emissive: new THREE.Color('#0b2540'), emissiveIntensity: 0.45, depthWrite: false });
    this.surface = new THREE.Mesh(geo, surfMat);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', geo.getAttribute('position'));
    wgeo.setIndex(lineIdx);
    this.wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.12, depthWrite: false }));
    // beam axis and the −3 dB ring on the surface: the same contour that lands on the ground
    this.axisLine = new THREE.Line(lineBuffer(2), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    this.ring3db = new THREE.LineLoop(lineBuffer(MAX_CONTOUR), new THREE.LineBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.95 }));
    const pattern = group(this.surface, this.wire, this.axisLine, this.ring3db, this.beamLabel, this.sideLabel);
    this.root.add(pattern);
    this.addComponent({ id: 'beam', name: 'Main Beam', sub: 'calculated |AF·EP| · white ring = −3 dB', object: this.beamLabel, desc: '3D radiation surface: radius ∝ gain in dB (30 dB range), computed for every direction from the array factor × element pattern. The white line is the beam axis (true maximum); the white ring is the −3 dB contour — the same contour that is projected onto the ground.', specs: ['Recomputed on every parameter change', 'Colour = normalised gain'], essential: true });
    this.addComponent({ id: 'sidelobe', name: 'Sidelobes', sub: 'depend on taper', object: this.sideLabel, desc: 'Secondary maxima of the array factor. Tapering (Hann, Hamming) lowers sidelobes at the cost of a wider main beam and a larger footprint.', specs: ['Uniform: first SLL ≈ −13.3 dB'] });
    // container object so the pattern participates in fading
    this.addComponent({ id: 'pattern', name: 'Radiation Surface', object: pattern, desc: '', label: false });

    // ground plane with the flat-ground projection of the −3 dB contour
    const ground = new THREE.Mesh(new THREE.CircleGeometry(26, 96), new THREE.MeshBasicMaterial({ color: '#1b3a5c', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    ground.rotation.x = Math.PI / 2;
    ground.position.y = GROUND_Y;
    const grid = new THREE.PolarGridHelper(26, 12, 6, 96, '#3d6a96', '#2a4d70');
    grid.position.y = GROUND_Y - 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CONTOUR * 9), 3).setUsage(THREE.DynamicDrawUsage));
    this.footFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    this.footLine = new THREE.LineLoop(lineBuffer(MAX_CONTOUR), new THREE.LineBasicMaterial({ color: '#e8f6ff' }));
    this.footEdges = new THREE.LineSegments(lineBuffer(EDGE_RAYS * 2 + 2), new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.5 }));
    this.footCenter = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.32, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.footCenter.rotation.x = Math.PI / 2;
    const footprint = group(ground, grid, this.footFill, this.footLine, this.footEdges, this.footCenter, this.footLabel);
    this.root.add(footprint);
    this.addComponent({ id: 'footprint', name: 'Footprint (flat-ground)', sub: '−3 dB contour · distance compressed', object: this.footLabel, desc: 'Where the beam lands: the −3 dB contour of the same |AF·EP| pattern, projected onto a flat ground plane. Edge rays run from the array through the −3 dB ring to the ground. Directions are exact; distance is compressed for display. COSMOS shows the same contour intersected with the spherical Earth.', specs: ['Calculated from array state', 'Flat-ground projection (BEAM LAB pedagogy)'], essential: true });

    // grating lobes (only when the model finds them in visible space)
    this.lobeAxes = new THREE.LineSegments(lineBuffer(8), new THREE.LineDashedMaterial({ color: LOBE_COLOR, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.9 }));
    this.lobeGroup.add(this.lobeAxes, this.lobeLabel);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.LineLoop(lineBuffer(64), new THREE.LineBasicMaterial({ color: LOBE_COLOR }));
      this.lobeLines.push(l);
      this.lobeGroup.add(l);
    }
    this.lobeGroup.visible = false;
    this.root.add(this.lobeGroup);
    this.addComponent({ id: 'grating', name: 'Grating Lobe', sub: 'spacing too large', object: this.lobeLabel, desc: 'With element spacing d/λ ≥ 1/(1+|sin θ₀|) the array factor repeats inside visible space: a second full-strength beam appears. Power leaves in the wrong direction (lower gain), the receiver cannot tell the two directions apart, and a second area on the ground is illuminated (interference).', specs: ['Calculated lobe positions u = u₀ + m·λ/d', 'Amber = grating lobe and its −3 dB contour'], essential: true });

    // wavefronts: plane fronts normal to the beam, spaced by one wavelength (1 unit = 1 cm)
    const wmat = () => new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const waves = new THREE.Group();
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96), wmat());
      this.waves.push(w);
      waves.add(w);
    }
    waves.userData.noFade = true;
    this.root.add(waves);
    this.applyParams(this.ctx.store.get());
  }

  applyGraphics(g: GraphicsConfig): void {
    super.applyGraphics(g);
    // fewer fronts on constrained tiers — never fewer than 3, the tilt stays readable
    this.waveCount = Math.max(3, Math.round(MAX_WAVES * Math.min(1, g.particles)));
  }

  onState(_state: AppState, changed: Set<string>): void {
    // geometry is rebuilt at most once per frame (tick), so slider drags stay smooth
    if (['params.arrayN', 'params.spacingLambda', 'params.steerDeg', 'params.steerAzDeg', 'params.weighting', 'params.freqGHz', 'params.altitudeKm'].some((k) => changed.has(k))) this.dirty = true;
  }

  private params(state: AppState): ArrayParams {
    const p = state.params;
    return { n: p.arrayN, spacingLambda: p.spacingLambda, steerThetaDeg: p.steerDeg, steerPhiDeg: p.steerAzDeg, weighting: p.weighting };
  }

  private applyParams(state: AppState): void {
    this.dirty = false;
    const sol = beamSolution(state.params);
    this.solution = sol;
    const ap = this.params(state);
    const lambdaCm = wavelengthM(state.params.freqGHz * 1e9) * 100;
    this.lambdaCm = lambdaCm;
    const d = ap.spacingLambda * lambdaCm;
    const w = weights(ap.n, ap.weighting);
    const key = `${ap.n}|${d.toFixed(4)}`;
    // --- panel & patches (rebuilt only when N or the physical spacing changes) ---
    if (key !== this.key) {
      this.key = key;
      for (const c of this.panel.children) (c as THREE.Mesh).geometry?.dispose();
      this.panel.clear();
      this.panelSize = ap.n * d;
      this.panel.add(box(this.panelSize + d, 0.3, this.panelSize + d, mat.darkPanel(), [0, -0.15, 0]));
      this.panel.add(box(this.panelSize + d * 1.2, 0.12, this.panelSize + d * 1.2, mat.aluminum(), [0, -0.36, 0]));
      const pg = new THREE.BoxGeometry(d * 0.55, 0.06, d * 0.55);
      this.patches = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.3, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25 }), ap.n * ap.n);
      const m4 = new THREE.Matrix4();
      let k = 0;
      for (let i = 0; i < ap.n; i++) for (let j = 0; j < ap.n; j++) {
        m4.makeTranslation((i - (ap.n - 1) / 2) * d, 0.03, (j - (ap.n - 1) / 2) * d);
        this.patches.setMatrixAt(k++, m4);
      }
      this.panel.add(this.patches);
      this.markOpacityDirty();
    }
    // phase & amplitude per element: βx = −kd sinθ0 cosφ0, βy = −kd sinθ0 sinφ0 (from the solution)
    const bx = sol.pattern.phaseStepX;
    const by = sol.pattern.phaseStepY;
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < ap.n; i++) for (let j = 0; j < ap.n; j++) {
      phaseColor(i * bx + j * by, c).multiplyScalar(0.35 + 0.65 * w[i] * w[j]);
      this.patches!.setColorAt(k++, c);
    }
    this.patches!.instanceColor!.needsUpdate = true;

    // --- radiation surface: |AF·EP| sampled in every direction (same functions as the solution) ---
    const pos = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.surface.geometry.getAttribute('color') as THREE.BufferAttribute;
    const mainDir = new THREE.Vector3(...sol.pattern.axis);
    const lobeDirs = sol.lobes.map((l) => new THREE.Vector3(...l.axis));
    let side = { db: -Infinity, x: 0, y: 1, z: 0 };
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * (Math.PI / 2);
      const ep = elementPattern(th, 1.3);
      const st = Math.sin(th);
      const ct = Math.cos(th);
      for (let j = 0; j <= NP; j++) {
        const ph = (j / NP) * Math.PI * 2;
        const f = planarAF(ap, w, th, ph) * ep;
        const db = 20 * Math.log10(Math.max(f, 1e-6));
        const rr = surfaceRadius(db);
        const x = st * Math.cos(ph), y = ct, z = st * Math.sin(ph);
        const vi = i * (NP + 1) + j;
        pos.setXYZ(vi, x * rr, y * rr, z * rr);
        magnitudeColor((db + DR) / DR, c);
        col.setXYZ(vi, c.r, c.g, c.b);
        const off = x * mainDir.x + y * mainDir.y + z * mainDir.z;
        if (off < Math.cos(0.35) && !lobeDirs.some((l) => x * l.x + y * l.y + z * l.z > Math.cos(0.3)) && db > side.db) side = { db, x, y, z };
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.surface.geometry.computeVertexNormals();
    this.surface.geometry.computeBoundingSphere();
    this.beamAxis.copy(mainDir);
    const peakDb = 20 * Math.log10(Math.max(sol.pattern.peakField, 1e-6));
    this.beamLabel.position.copy(mainDir).multiplyScalar(surfaceRadius(peakDb) * 1.02);
    this.sideLabel.position.set(side.x, side.y, side.z).multiplyScalar(surfaceRadius(side.db));
    writePoints(this.axisLine.geometry, [v3(0, 0, 0), mainDir.clone().multiplyScalar(surfaceRadius(peakDb) + 1.2)]);
    const r3 = surfaceRadius(peakDb - 3);
    writePoints(this.ring3db.geometry, sol.contour.map((q) => v3(q[0] * r3, q[1] * r3, q[2] * r3)));
    this.updateFootprint(sol);
    this.updateLobes(sol);
    this.markOpacityDirty();
  }

  /** Same contour → flat-ground footprint, edge rays from the array through the −3 dB ring. */
  private updateFootprint(sol: BeamSolution): void {
    const tmp = new THREE.Vector3();
    const dirs = sol.contour.filter((d) => d[1] > 0.05);
    const pts = dirs.map((d) => toGround(d, tmp).clone());
    if (pts.length < 3) {
      this.footLine.geometry.setDrawRange(0, 0);
      this.footFill.geometry.setDrawRange(0, 0);
      this.footEdges.geometry.setDrawRange(0, 0);
      return;
    }
    writePoints(this.footLine.geometry, pts);
    const centre = sol.pattern.axis[1] > 0.05 ? toGround(sol.pattern.axis, new THREE.Vector3()) : pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
    const fan: THREE.Vector3[] = [];
    pts.forEach((p, i) => fan.push(centre, p, pts[(i + 1) % pts.length]));
    writePoints(this.footFill.geometry, fan);
    const edges: THREE.Vector3[] = [v3(0, 0, 0), centre];
    for (let e = 0; e < EDGE_RAYS; e++) edges.push(v3(0, 0, 0), pts[Math.floor((e * pts.length) / EDGE_RAYS)]);
    writePoints(this.footEdges.geometry, edges);
    this.footCenter.position.copy(centre).setY(GROUND_Y - 0.03);
    this.footLabel.position.copy(centre);
  }

  private updateLobes(sol: BeamSolution): void {
    const shown = sol.lobes.filter((l) => l.axis[1] > 0.05 && l.levelDb > -10).slice(0, 4);
    this.lobeGroup.visible = shown.length > 0;
    if (!shown.length) return;
    const peakDb = 20 * Math.log10(Math.max(sol.pattern.peakField, 1e-6));
    const axes: THREE.Vector3[] = [];
    const tmp = new THREE.Vector3();
    shown.forEach((l, i) => {
      axes.push(v3(0, 0, 0), toGround(l.axis, tmp).clone());
      const sec = sol.secondary.find((s) => s.lobe === l);
      const line = this.lobeLines[i];
      if (sec) writePoints(line.geometry, sec.directions.filter((d) => d[1] > 0.05).map((d) => toGround(d, tmp).clone()));
      else line.geometry.setDrawRange(0, 0);
    });
    for (let i = shown.length; i < this.lobeLines.length; i++) this.lobeLines[i].geometry.setDrawRange(0, 0);
    writePoints(this.lobeAxes.geometry, axes);
    this.lobeAxes.computeLineDistances();
    const top = shown[0];
    this.lobeLabel.position.set(...top.axis).multiplyScalar(surfaceRadius(peakDb + top.levelDb) * 1.02);
  }

  /** Camera framings used by the hero demo (scene units, cm). */
  demoView(stage: string): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
    const a = this.beamAxis;
    switch (stage) {
      case 'phase':
        return { pos: v3(9, 13, 15), target: v3(0, 0.5, 0) };
      case 'wavefront':
        return { pos: v3(24, 6, 6).addScaledVector(a, 2), target: a.clone().multiplyScalar(5) };
      case 'pattern':
        return { pos: v3(26, 10, 26), target: a.clone().multiplyScalar(5) };
      case 'footprint':
        return { pos: v3(30, 30, 30), target: v3(0, GROUND_Y * 0.62, 0).add(this.footLabel.position.clone().setY(0).multiplyScalar(0.5)) };
      default:
        return null;
    }
  }

  protected tick(dt: number): void {
    if (this.dirty) this.applyParams(this.ctx.store.get());
    // wavefronts travel along the beam axis; spacing = λ. The front is perpendicular to the
    // axis because the element phases advance by β per element (phase gradient → tilt).
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), this.beamAxis);
    const n = Math.min(this.waveCount, Math.max(3, Math.floor(14 / this.lambdaCm)));
    this.waves.forEach((w, i) => {
      w.visible = i < n;
      if (i >= n) return;
      const s = (this.time * 0.25 + i / n) % 1;
      const dist = 1 + s * n * this.lambdaCm;
      w.position.copy(this.beamAxis).multiplyScalar(dist);
      w.quaternion.copy(q);
      const rad = this.panelSize * 0.3 + dist * 0.04;
      w.scale.setScalar(rad);
      (w.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.sin(Math.PI * s) * (1 - s) * this.alpha;
    });
    void dt;
  }
}
