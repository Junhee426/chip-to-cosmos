import * as THREE from 'three';
import type { AppState } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, group, v3 } from '../graphics/geometry';
import { magnitudeColor, phaseColor } from '../graphics/effects';
import { beamFootprint, elementPattern, planarAF, progressivePhase, weights, type ArrayParams } from '../models/array-factor';
import { wavelengthM } from '../models/units';
import { BaseLevel } from './base';

const DR = 30; // dynamic range shown on the 3D radiation surface (dB)
const R_MAX = 11; // radius of the 0 dB point (scene units)
const NT = 72;
const NP = 144;
/** ground plane height in the lab (directions are projected exactly; the distance is not to scale) */
const GROUND_Y = 14;
const MAX_WAVES = 12;

/**
 * BEAM LAB — planar phased array (units: cm). The 3D radiation surface is
 * generated vertex-by-vertex from the calculated array factor × element
 * pattern; it is NOT a decorative cone.
 */
export class ArrayLevel extends BaseLevel {
  readonly id = 'array' as const;
  readonly radius = 6;
  home = { pos: v3(27, 9, 31), target: v3(0, 6.5, 0) };
  private panel = new THREE.Group();
  private patches: THREE.InstancedMesh | null = null;
  private surface!: THREE.Mesh;
  private wire!: THREE.LineSegments;
  private waves: THREE.Mesh[] = [];
  private beamAxis = new THREE.Vector3(0, 1, 0);
  private beamLabel = new THREE.Object3D();
  private sideLabel = new THREE.Object3D();
  private panelSize = 12;
  private key = '';
  private lambdaCm = 1.52;
  private footFill!: THREE.Mesh;
  private footLine!: THREE.LineLoop;
  private footEdges!: THREE.LineSegments;
  private footLabel = new THREE.Object3D();

  build(): void {
    this.root.add(this.panel);
    this.addComponent({ id: 'panel', name: 'Array Tile', sub: 'N × N patch elements', object: this.panel, labelLocal: v3(-6, 0, 6), desc: 'Sub-array tile of the nadir phased array. Each patch element is driven with its own amplitude wₙ and phase φₙ (colour = phase).', specs: ['Patch elements on low-loss laminate', 'Element pattern ≈ cos^1.3 θ'] });

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
    const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.78, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.45, emissive: new THREE.Color('#0b2540'), emissiveIntensity: 0.6, depthWrite: false });
    this.surface = new THREE.Mesh(geo, surfMat);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', geo.getAttribute('position'));
    wgeo.setIndex(lineIdx);
    this.wire = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.14, depthWrite: false }));
    const pattern = group(this.surface, this.wire, this.beamLabel, this.sideLabel);
    this.root.add(pattern);
    this.addComponent({ id: 'beam', name: 'Main Beam', sub: 'calculated |AF·EP|', object: this.beamLabel, desc: '3D radiation surface: radius ∝ gain in dB (30 dB range) computed for every direction from the array factor and element pattern.', specs: ['Recomputed on every parameter change', 'Colour = normalised gain'] });
    this.addComponent({ id: 'sidelobe', name: 'Sidelobes / Grating Lobes', sub: 'depend on taper & spacing', object: this.sideLabel, desc: 'Secondary maxima. Tapering (Hann, Hamming) lowers sidelobes at the cost of a wider beam; spacing d > λ/(1+|sin θ₀|) creates grating lobes.', specs: ['Uniform: first SLL ≈ −13.3 dB'] });
    // container object so the pattern participates in fading
    this.addComponent({ id: 'pattern', name: 'Radiation Surface', object: pattern, desc: '', label: false });

    // Earth footprint: the calculated −3 dB contour projected onto a ground plane
    const ground = new THREE.Mesh(new THREE.CircleGeometry(26, 96), new THREE.MeshBasicMaterial({ color: '#1b3a5c', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    ground.rotation.x = Math.PI / 2;
    ground.position.y = GROUND_Y;
    const grid = new THREE.PolarGridHelper(26, 12, 6, 96, '#3d6a96', '#2a4d70');
    grid.position.y = GROUND_Y - 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.footFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.footLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#cfe9ff' }));
    this.footEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.45 }));
    const footprint = group(ground, grid, this.footFill, this.footLine, this.footEdges, this.footLabel);
    this.root.add(footprint);
    this.addComponent({ id: 'footprint', name: 'Earth Footprint', sub: '−3 dB contour · calculated', object: this.footLabel, desc: 'Where the beam lands: the −3 dB contour of the same |AF·EP| pattern, intersected with the ground at the orbit altitude (flat-Earth approximation). Lines from the array trace the beam edge. Distance is compressed for display; shape and position are exact projections.', specs: ['Calculated from array state', 'Flat-Earth, altitude from link settings'], essential: true });

    // wavefronts: plane fronts normal to the beam, spaced by one wavelength (1 unit = 1 cm)
    const wmat = () => new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
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

  onState(state: AppState, changed: Set<string>): void {
    if (['params.arrayN', 'params.spacingLambda', 'params.steerDeg', 'params.steerAzDeg', 'params.weighting', 'params.freqGHz', 'params.altitudeKm'].some((k) => changed.has(k))) this.applyParams(state);
  }

  private params(state: AppState): ArrayParams {
    const p = state.params;
    return { n: p.arrayN, spacingLambda: p.spacingLambda, steerThetaDeg: p.steerDeg, steerPhiDeg: p.steerAzDeg, weighting: p.weighting };
  }

  private applyParams(state: AppState): void {
    const ap = this.params(state);
    const lambdaCm = wavelengthM(state.params.freqGHz * 1e9) * 100;
    this.lambdaCm = lambdaCm;
    const d = ap.spacingLambda * lambdaCm;
    const w = weights(ap.n, ap.weighting);
    const key = `${ap.n}|${d.toFixed(4)}`;
    // --- panel & patches ---
    if (key !== this.key) {
      this.key = key;
      this.panel.clear();
      this.patches?.geometry.dispose();
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
    // phase & amplitude per element
    const t0 = (ap.steerThetaDeg * Math.PI) / 180;
    const p0 = (ap.steerPhiDeg * Math.PI) / 180;
    const bx = progressivePhase(ap.spacingLambda, ap.steerThetaDeg) * Math.cos(p0);
    const by = progressivePhase(ap.spacingLambda, ap.steerThetaDeg) * Math.sin(p0);
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < ap.n; i++) for (let j = 0; j < ap.n; j++) {
      phaseColor(i * bx + j * by, c).multiplyScalar(0.35 + 0.65 * w[i] * w[j]);
      this.patches!.setColorAt(k++, c);
    }
    this.patches!.instanceColor!.needsUpdate = true;

    // --- radiation surface ---
    const pos = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.surface.geometry.getAttribute('color') as THREE.BufferAttribute;
    let best = -Infinity;
    let side = { db: -Infinity, dir: new THREE.Vector3() };
    const mainDir = new THREE.Vector3(Math.sin(t0) * Math.cos(p0), Math.cos(t0), Math.sin(t0) * Math.sin(p0)).normalize();
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * (Math.PI / 2);
      const ep = elementPattern(th, 1.3);
      for (let j = 0; j <= NP; j++) {
        const ph = (j / NP) * Math.PI * 2;
        const f = planarAF(ap, w, th, ph) * ep;
        const db = 20 * Math.log10(Math.max(f, 1e-6));
        const rr = R_MAX * Math.max(0, (db + DR) / DR);
        const dir = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        const vi = i * (NP + 1) + j;
        pos.setXYZ(vi, dir.x * rr, dir.y * rr, dir.z * rr);
        magnitudeColor((db + DR) / DR, c);
        col.setXYZ(vi, c.r, c.g, c.b);
        if (db > best) best = db;
        if (dir.angleTo(mainDir) > 0.35 && db > side.db) side = { db, dir };
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.surface.geometry.computeVertexNormals();
    this.surface.geometry.computeBoundingSphere();
    this.beamAxis.copy(mainDir);
    this.beamLabel.position.copy(mainDir).multiplyScalar(R_MAX * 1.02);
    const sideR = R_MAX * Math.max(0.05, (side.db + DR) / DR);
    this.sideLabel.position.copy(side.dir).multiplyScalar(sideR);
    this.updateFootprint(ap, state.params.altitudeKm);
    this.markOpacityDirty();
  }

  /** Same array state → footprint on the ground plane (directions projected exactly). */
  private updateFootprint(ap: ArrayParams, altitudeKm: number): void {
    const f = beamFootprint(ap, altitudeKm, 96);
    const pts = f.directions.filter((d) => d[1] > 0.05).map((d) => new THREE.Vector3((d[0] / d[1]) * GROUND_Y, GROUND_Y - 0.02, (d[2] / d[1]) * GROUND_Y));
    if (pts.length < 3) return;
    this.footLine.geometry.dispose();
    this.footLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const c = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
    const fan: THREE.Vector3[] = [];
    pts.forEach((p, i) => fan.push(c, p, pts[(i + 1) % pts.length]));
    this.footFill.geometry.dispose();
    this.footFill.geometry = new THREE.BufferGeometry().setFromPoints(fan);
    const edges: THREE.Vector3[] = [];
    for (let k = 0; k < 4; k++) edges.push(new THREE.Vector3(), pts[Math.floor((k * pts.length) / 4)]);
    this.footEdges.geometry.dispose();
    this.footEdges.geometry = new THREE.BufferGeometry().setFromPoints(edges);
    this.footLabel.position.copy(c);
  }

  protected tick(dt: number): void {
    // wavefronts travel along the beam axis; spacing = λ (scaled for display)
    const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), this.beamAxis);
    // fronts advance one wavelength per cycle (speed illustrative), spacing = λ
    const n = Math.min(MAX_WAVES, Math.max(3, Math.floor(14 / this.lambdaCm)));
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
