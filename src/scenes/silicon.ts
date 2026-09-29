import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { AppState } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { group, v3 } from '../graphics/geometry';
import { pointsMaterial, syncPointScale } from '../graphics/particles';
import { intrinsicCarrierDensity, SI } from '../models/semiconductor';
import { BaseLevel, type Anchor } from './base';

const A = SI.latticeConstantNm * 10; // lattice constant in scene units (0.1 nm)
const BOND = (A * Math.sqrt(3)) / 4;

/** Diamond-cubic lattice sites in [0, n·a]³, centred on the origin. */
export function diamondSites(n: number): THREE.Vector3[] {
  const fcc = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
  const out: THREE.Vector3[] = [];
  const eps = 1e-6;
  for (let i = -1; i <= n; i++) for (let j = -1; j <= n; j++) for (let k = -1; k <= n; k++) {
    for (const b of [[0, 0, 0], [0.25, 0.25, 0.25]]) for (const f of fcc) {
      const x = i + f[0] + b[0];
      const y = j + f[1] + b[1];
      const z = k + f[2] + b[2];
      if (x >= -eps && y >= -eps && z >= -eps && x <= n + eps && y <= n + eps && z <= n + eps) out.push(new THREE.Vector3((x - n / 2) * A, (y - n / 2) * A, (z - n / 2) * A));
    }
  }
  return out;
}

/**
 * LEVEL 7 — silicon crystal (units: 0.1 nm). Thermal vibration amplitude ∝ √T;
 * the number of broken bonds (electron–hole pairs) shown tracks log10 ni(T).
 */
export class SiliconLevel extends BaseLevel {
  readonly id = 'silicon' as const;
  readonly radius = 5.4;
  home = { pos: v3(15, 9.5, 19), target: v3(0, -0.3, 0) };
  private sites: THREE.Vector3[] = [];
  private bonds: [number, number][] = [];
  private atoms!: THREE.InstancedMesh;
  private bondMesh!: THREE.InstancedMesh;
  private donorIdx = 0;
  private donorE!: THREE.Points;
  private pairs!: THREE.Points;
  private holes!: THREE.Points;
  private pairState: { bond: number; t: number; dir: THREE.Vector3 }[] = [];
  private offsets: THREE.Vector3[] = [];

  build(): void {
    this.sites = diamondSites(2);
    for (let i = 0; i < this.sites.length; i++) for (let j = i + 1; j < this.sites.length; j++) {
      if (Math.abs(this.sites[i].distanceTo(this.sites[j]) - BOND) < 0.05) this.bonds.push([i, j]);
    }
    this.offsets = this.sites.map(() => new THREE.Vector3());
    const atomMat = new THREE.MeshPhysicalMaterial({ color: 0x8fa3b8, metalness: 0.6, roughness: 0.25, clearcoat: 0.8 });
    this.atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 32, 16), atomMat, this.sites.length);
    this.atoms.castShadow = true;
    this.donorIdx = this.sites.reduce((best, s, i) => (s.length() < this.sites[best].length() && i !== 0 ? i : best), 1);
    const c = new THREE.Color();
    this.sites.forEach((_, i) => this.atoms.setColorAt(i, c.set(i === this.donorIdx ? 0xe0a040 : 0x8fa3b8)));
    const lattice = group(this.atoms);
    this.root.add(lattice);
    this.addComponent({ id: 'atoms', name: 'Si Atoms', sub: 'diamond cubic', object: lattice, labelLocal: this.sites[3], desc: 'Each silicon atom shares four covalent bonds with tetrahedral neighbours (sp³). Two interpenetrating FCC lattices offset by (¼,¼,¼)a.', specs: ['a = 0.5431 nm', 'Nearest-neighbour 0.235 nm', '5.0 × 10²² atoms/cm³'] });

    this.bondMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 10), mat.glass(0xa9c8e8, 0.55), this.bonds.length);
    const bondsG = group(this.bondMesh);
    this.root.add(bondsG);
    this.addComponent({ id: 'bonds', name: 'Covalent Bonds', sub: '2 shared electrons', object: bondsG, labelLocal: this.sites[this.bonds[5][0]].clone().lerp(this.sites[this.bonds[5][1]], 0.5), desc: 'Each bond holds two valence electrons. Breaking one (≥ Eg ≈ 1.12 eV) frees an electron and leaves a hole.', specs: ['Bond energy relates to Eg', 'Tetrahedral angle 109.5°'] });

    // unit cell outline
    const cell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(A, A, A)), new THREE.LineBasicMaterial({ color: '#8fb8e8', transparent: true, opacity: 0.5 }));
    cell.position.set(-A / 2, -A / 2, -A / 2);
    const cellG = group(cell);
    this.root.add(cellG);
    this.addComponent({ id: 'cell', name: 'Unit Cell', sub: 'a = 0.543 nm', object: cellG, labelLocal: v3(-A, A * 0, -A / 2), desc: 'Conventional cubic unit cell containing 8 atoms.', specs: ['8 atoms / cell'] });

    // donor atom & its loosely bound 5th electron
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    dg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([1]), 1));
    this.donorE = new THREE.Points(dg, pointsMaterial(COLORS.electron, 0.5));
    this.donorE.frustumCulled = false;
    const donor = group(this.donorE);
    donor.userData.noFade = true;
    const donorAnchor = new THREE.Object3D();
    donorAnchor.position.copy(this.sites[this.donorIdx]);
    donor.add(donorAnchor);
    this.root.add(donor);
    this.addComponent({ id: 'donor', name: 'P Donor', sub: '5th electron, Ed ≈ 45 meV', object: donorAnchor, desc: 'A phosphorus atom substitutes for silicon. Its fifth valence electron is only weakly bound (≈ 45 meV below Ec) and is ionised at room temperature → n-type.', specs: ['Ionisation energy ≈ 0.045 eV', 'Orbit radius shrunk for display (real ≈ 2 nm)'] });

    // thermally generated electron-hole pairs
    const nMax = 14;
    const mk = (color: THREE.Color, size: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nMax * 3), 3));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(nMax).fill(0), 1));
      const p = new THREE.Points(g, pointsMaterial(color, size));
      p.frustumCulled = false;
      return p;
    };
    this.pairs = mk(COLORS.electron, 0.45);
    this.holes = mk(COLORS.hole, 0.45);
    const carriers = group(this.pairs, this.holes);
    carriers.userData.noFade = true;
    this.root.add(carriers);
    for (let i = 0; i < nMax; i++) this.pairState.push({ bond: (i * 17) % this.bonds.length, t: (i * 0.37) % 1, dir: v3(Math.sin(i * 2.1), Math.cos(i * 1.3), Math.sin(i * 0.7)).normalize() });
    this.updateLattice();
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'energy') return null;
    return { position: v3(0, 0, 0), size: 5.4, focus: 'bonds' };
  }

  private visiblePairs(tempK: number): number {
    const ni = intrinsicCarrierDensity(tempK);
    return THREE.MathUtils.clamp(Math.round((Math.log10(ni) - 6) * 1.3), 0, 14);
  }

  private updateLattice(): void {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = v3(0, 1, 0);
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    this.sites.forEach((s, i) => {
      m4.makeTranslation(s.x + this.offsets[i].x, s.y + this.offsets[i].y, s.z + this.offsets[i].z);
      this.atoms.setMatrixAt(i, m4);
    });
    this.atoms.instanceMatrix.needsUpdate = true;
    this.bonds.forEach(([a, b], k) => {
      pa.copy(this.sites[a]).add(this.offsets[a]);
      pb.copy(this.sites[b]).add(this.offsets[b]);
      const d = pb.clone().sub(pa);
      q.setFromUnitVectors(up, d.clone().normalize());
      m4.compose(pa.clone().add(pb).multiplyScalar(0.5), q, v3(1, d.length(), 1));
      this.bondMesh.setMatrixAt(k, m4);
    });
    this.bondMesh.instanceMatrix.needsUpdate = true;
  }

  protected tick(dt: number, state: AppState): void {
    const T = state.params.tempK;
    const amp = 0.07 * Math.sqrt(T / 300);
    this.sites.forEach((_, i) => {
      const t = this.time * 7 + i * 1.7;
      this.offsets[i].set(Math.sin(t) * amp, Math.sin(t * 1.3 + 1) * amp, Math.sin(t * 0.9 + 2) * amp);
    });
    this.updateLattice();
    for (const p of [this.donorE, this.pairs, this.holes]) {
      syncPointScale(p);
      (p.material as THREE.ShaderMaterial).uniforms.uOpacity.value = this.alpha;
      p.visible = this.alpha > 0.02;
    }
    // donor electron orbit
    const d = this.sites[this.donorIdx];
    const dp = this.donorE.geometry.getAttribute('position') as THREE.BufferAttribute;
    dp.setXYZ(0, d.x + Math.cos(this.time * 1.8) * 3.2, d.y + Math.sin(this.time * 2.3) * 1.2, d.z + Math.sin(this.time * 1.8) * 3.2);
    dp.needsUpdate = true;
    // e-h pairs
    const n = this.visiblePairs(T);
    const ep = this.pairs.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ea = this.pairs.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    const hp = this.holes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ha = this.holes.geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    this.pairState.forEach((s, i) => {
      s.t += dt * 0.12;
      if (s.t > 1) {
        s.t = 0;
        s.bond = (s.bond + 23) % this.bonds.length;
      }
      const [a, b] = this.bonds[s.bond];
      const mid = this.sites[a].clone().lerp(this.sites[b], 0.5);
      const e = mid.clone().addScaledVector(s.dir, s.t * 6);
      const fade = i < n ? Math.sin(Math.PI * s.t) : 0;
      ep.setXYZ(i, e.x, e.y, e.z);
      hp.setXYZ(i, mid.x, mid.y, mid.z);
      ea.setX(i, fade);
      ha.setX(i, fade * 0.9);
    });
    ep.needsUpdate = ea.needsUpdate = hp.needsUpdate = ha.needsUpdate = true;
  }
}
