import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { AppState } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, cylinder, group, v3 } from '../graphics/geometry';
import { pointsMaterial, syncPointScale } from '../graphics/particles';
import { mosfet, type MosfetResult } from '../models/mosfet';
import { mulberry32 } from '../models/units';
import { BaseLevel, type Anchor } from './base';

const L = 3.0; // channel length (units: 100 nm) → 300 nm long-channel illustration
const XS = -L / 2;
const XD = L / 2;
const Z = 3; // half device width shown
const TOX = 0.3; // exaggerated oxide thickness for visibility
const NS_REF = 3e12; // electrons/cm² that maps to full channel thickness

/**
 * Normalised inversion charge along the channel from the gradual-channel
 * approximation: Q(x)/Q(0) = √(1 − (x/L)·(2·Vov·Vde − Vde²)/Vov²),  Vde = min(Vds, Vov).
 */
export function channelProfile(vov: number, vds: number, xOverL: number): number {
  if (vov <= 0) return 0;
  const vde = Math.min(vds, vov);
  const k = (2 * vov * vde - vde * vde) / (vov * vov);
  return Math.sqrt(Math.max(0, 1 - xOverL * k));
}

/**
 * LEVEL 6 — planar NMOS cross-section (units: 100 nm). Channel thickness,
 * pinch-off, carrier density and drift speed are driven by the Simplified
 * Educational Model; geometry is not to scale (oxide exaggerated).
 */
export class MosfetLevel extends BaseLevel {
  readonly id = 'mosfet' as const;
  readonly radius = 6;
  home = { pos: v3(11, 7.5, 16), target: v3(0, -0.6, 0) };
  private channel!: THREE.Mesh;
  private channelGeo!: THREE.BoxGeometry;
  private channelMat!: THREE.MeshStandardMaterial;
  private depletion!: THREE.Mesh;
  private drainDep!: THREE.Mesh;
  private arrows!: THREE.InstancedMesh;
  private arrowMat!: THREE.MeshStandardMaterial;
  private electrons!: THREE.Points;
  private holes!: THREE.Points;
  private eState: { region: 0 | 1 | 2; x: number; y: number; z: number; phase: number }[] = [];
  private hState: { x: number; y: number; z: number; phase: number }[] = [];
  private result!: MosfetResult;
  private rand = mulberry32(42);
  private baseY: Float32Array | null = null;

  build(): void {
    const r = this.root;
    // substrate (p-type)
    const sub = group(box(12, 5, 2 * Z, mat.doped('#8a4a5a', 0.55), [0, -2.5, 0]));
    r.add(sub);
    this.addComponent({ id: 'substrate', name: 'p-Substrate', sub: 'Na ≈ 10¹⁷ cm⁻³', object: sub, labelLocal: v3(-4, -4, Z), desc: 'Lightly doped p-type silicon body. Majority carriers are holes; the channel forms at its surface by inversion.', specs: ['Boron doped', 'Body tied to source (0 V)'] });
    // STI
    const sti = group(box(0.8, 2.2, 2 * Z, mat.glass(0xcfe3f0, 0.3), [-5.6, -1.1, 0]), box(0.8, 2.2, 2 * Z, mat.glass(0xcfe3f0, 0.3), [5.6, -1.1, 0]));
    r.add(sti);
    this.addComponent({ id: 'sti', name: 'STI', sub: 'Shallow trench isolation', object: sti, labelLocal: v3(5.6, 0, Z), desc: 'Oxide-filled trenches isolating neighbouring transistors.', specs: ['SiO₂ fill'] });
    // source / drain n+
    const nplus = () => mat.doped('#2e6fd0', 0.7);
    const source = group(box(3.7, 1.2, 2 * Z, nplus(), [-3.35, -0.6, 0], 0.25));
    const drain = group(box(3.7, 1.2, 2 * Z, nplus(), [3.35, -0.6, 0], 0.25));
    source.add(box(3.0, 0.06, 2 * Z - 0.2, mat.anodized(0x505560), [-3.5, 0.03, 0]));
    drain.add(box(3.0, 0.06, 2 * Z - 0.2, mat.anodized(0x505560), [3.5, 0.03, 0]));
    r.add(source, drain);
    this.addComponent({ id: 'source', name: 'Source (n⁺)', sub: 'electron reservoir', object: source, labelLocal: v3(-4.2, 0, Z), desc: 'Heavily doped n⁺ region that supplies electrons to the channel.', specs: ['Nd ≈ 10²⁰ cm⁻³', 'NiSi contact'] });
    this.addComponent({ id: 'drain', name: 'Drain (n⁺)', sub: 'collects electrons', object: drain, labelLocal: v3(4.2, 0, Z), desc: 'n⁺ region biased at Vds that collects channel electrons.', specs: ['Nd ≈ 10²⁰ cm⁻³', 'Reverse-biased to body'] });
    // depletion regions (illustrative)
    this.depletion = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 1, 2 * Z - 0.02), mat.doped('#c9a0ff', 0.14));
    this.depletion.position.set(0, -0.5, 0);
    const dep = group(this.depletion);
    this.drainDep = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2 * Z - 0.04), mat.doped('#c9a0ff', 0.12));
    dep.add(this.drainDep);
    r.add(dep);
    this.addComponent({ id: 'depletion', name: 'Depletion Region', sub: 'illustrative extent', object: dep, labelLocal: v3(0, -1.0, Z), desc: 'Region swept of mobile holes by the gate field (and around the reverse-biased drain junction), leaving fixed negative acceptor ions. Extent is schematic.', specs: ['Grows with Vgs until inversion', 'Drain side widens with Vds'] });

    // channel (inversion layer) — thickness driven by computed charge profile
    this.channelGeo = new THREE.BoxGeometry(L, 1, 2 * Z - 0.05, 48, 1, 1);
    this.channelGeo.translate(0, -0.5, 0);
    this.channelMat = mat.emissive(COLORS.electron, 1.1, 0.75);
    this.channelMat.depthWrite = false;
    this.channel = new THREE.Mesh(this.channelGeo, this.channelMat);
    const ch = group(this.channel);
    r.add(ch);
    this.addComponent({ id: 'channel', name: 'Inversion Channel', sub: 'thickness ∝ Qinv(x)', object: ch, labelLocal: v3(0.6, -0.05, Z), desc: 'Thin electron layer induced at the surface when Vgs > Vth. Its charge per area Qinv(x) = Cox(Vgs − Vth − V(x)) falls toward the drain; at Vds ≥ Vgs − Vth it pinches off.', specs: ['Calculated from gradual-channel model', 'Thickness scale illustrative'] });

    // gate stack
    const oxide = group(box(L + 0.2, TOX, 2 * Z, mat.glass(0xe0f0ff, 0.35), [0, TOX / 2, 0]));
    r.add(oxide);
    this.addComponent({ id: 'oxide', name: 'Gate Oxide', sub: 'tox = 5 nm (exaggerated)', object: oxide, labelLocal: v3(-L / 2, TOX / 2, Z), desc: 'Thin insulating dielectric. Cox = εox/tox sets how much channel charge each volt of gate overdrive induces.', specs: ['SiO₂ / high-k', 'Cox ≈ 0.69 µF/cm²'] });
    const gate = group(box(L, 1.7, 2 * Z, mat.aluminum(), [0, TOX + 0.85, 0], 0.04));
    gate.add(box(L - 0.02, 0.08, 2 * Z - 0.02, mat.anodized(0x4a4f58), [0, TOX + 1.74, 0]));
    r.add(gate);
    this.addComponent({ id: 'gate', name: 'Gate', sub: 'metal / poly-Si', object: gate, labelLocal: v3(0, TOX + 1.7, Z), desc: 'Control electrode. Vgs sets the vertical field through the oxide that attracts electrons to the surface.', specs: ['L = 300 nm (long-channel)', 'TiN / poly-Si'] });
    const spacers = group(box(0.5, 1.9, 2 * Z, mat.glass(0xd8dde8, 0.5), [-L / 2 - 0.25, 0.95, 0]), box(0.5, 1.9, 2 * Z, mat.glass(0xd8dde8, 0.5), [L / 2 + 0.25, 0.95, 0]));
    r.add(spacers);
    this.addComponent({ id: 'spacer', name: 'Spacers', sub: 'Si₃N₄', object: spacers, labelLocal: v3(-L / 2 - 0.25, 1.8, Z), desc: 'Nitride sidewall spacers that self-align the source/drain implants to the gate.', specs: ['Si₃N₄'] });
    // contacts + metal-1
    const w = mat.tungsten();
    const contacts = group(
      cylinder(0.28, 3.1, w, [-3.6, 1.55, 0.8]), cylinder(0.28, 3.1, w, [-3.6, 1.55, -0.8]),
      cylinder(0.28, 3.1, w, [3.6, 1.55, 0.8]), cylinder(0.28, 3.1, w, [3.6, 1.55, -0.8]),
      cylinder(0.28, 1.2, w, [0, TOX + 2.3, -1.8]),
    );
    const cu = mat.copper();
    const m1 = group(box(1.2, 0.5, 2 * Z + 1, cu, [-3.6, 3.35, 0.5]), box(1.2, 0.5, 2 * Z + 1, cu, [3.6, 3.35, 0.5]), box(2.2, 0.5, 1.2, cu, [0, 3.35, -1.8]));
    const interconnect = group(contacts, m1);
    r.add(interconnect);
    this.addComponent({ id: 'metal', name: 'Contacts + Metal-1', sub: 'W plugs · Cu', object: interconnect, labelLocal: v3(3.6, 3.6, Z), desc: 'Tungsten contact plugs connect silicided source, drain and gate to the first copper interconnect layer.', specs: ['W plugs', 'Cu damascene M1'] });

    // oxide field arrows (instanced cones)
    const cone = new THREE.ConeGeometry(0.07, 0.22, 10);
    cone.rotateX(Math.PI);
    this.arrowMat = mat.emissive('#ffd28a', 1.0, 0.8);
    this.arrows = new THREE.InstancedMesh(cone, this.arrowMat, 7 * 4);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) {
      m4.makeTranslation(-1.2 + i * 0.4, TOX / 2, -2.2 + j * 1.45);
      this.arrows.setMatrixAt(k++, m4);
    }
    const field = group(this.arrows);
    field.userData.noFade = false;
    r.add(field);
    this.addComponent({ id: 'field', name: 'Oxide Field', sub: 'E ≈ Vgs / tox', object: field, labelLocal: v3(1.2, TOX / 2, -2.2), desc: 'Vertical electric field in the gate oxide (simplified as Vgs/tox). It repels holes, then attracts electrons once Vgs > Vth.', specs: ['MV/cm range', 'Arrow size ∝ |E|'], label: false });

    // carriers
    const nE = 420;
    const ep = new Float32Array(nE * 3);
    const ea = new Float32Array(nE).fill(1);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('aPhase', new THREE.BufferAttribute(ea, 1));
    this.electrons = new THREE.Points(eg, pointsMaterial(COLORS.electron, 0.22));
    this.electrons.frustumCulled = false;
    for (let i = 0; i < nE; i++) this.eState.push(this.spawnReservoir(i % 2 === 0 ? 0 : 2));
    const nH = 90;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nH * 3), 3));
    hg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(nH).fill(0.8), 1));
    this.holes = new THREE.Points(hg, pointsMaterial(COLORS.hole, 0.2));
    this.holes.frustumCulled = false;
    for (let i = 0; i < nH; i++) this.hState.push({ x: (this.rand() - 0.5) * 10, y: -0.4 - this.rand() * 4.4, z: (this.rand() - 0.5) * 2 * Z * 0.9, phase: this.rand() * 10 });
    const carriers = group(this.electrons, this.holes);
    carriers.userData.noFade = true;
    r.add(carriers);

    // explode: lift the gate stack and interconnect
    this.explode.add(interconnect, v3(0, 4.5, 0), 0.0, 0.7);
    this.explode.add(gate, v3(0, 2.6, 0), 0.15, 0.8);
    this.explode.add(spacers, v3(0, 1.8, 0), 0.2, 0.85);
    this.explode.add(oxide, v3(0, 1.1, 0), 0.25, 0.9);
    this.explode.add(sti, v3(0, 0, 0), 0, 1);
    this.explode.add(source, v3(-1.2, 0, 0), 0.3, 1.0);
    this.explode.add(drain, v3(1.2, 0, 0), 0.3, 1.0);

    this.modeFocus = {
      signal: ['channel', 'source', 'drain', 'gate', 'oxide'],
      power: ['source', 'drain', 'metal', 'channel'],
      thermal: ['channel', 'drain', 'substrate'],
      radiation: ['oxide', 'substrate', 'drain', 'depletion'],
    };
    this.applyParams(this.ctx.store.get());
  }

  private spawnReservoir(region: 0 | 2) {
    const cx = region === 0 ? -3.35 : 3.35;
    return { region, x: cx + (this.rand() - 0.5) * 3.2, y: -0.1 - this.rand() * 1.0, z: (this.rand() - 0.5) * 2 * Z * 0.92, phase: this.rand() * 10 } as { region: 0 | 1 | 2; x: number; y: number; z: number; phase: number };
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'silicon') return null;
    return { position: v3(0, -0.8, 0.5), size: 0.0054, focus: 'substrate' };
  }

  onState(state: AppState, changed: Set<string>): void {
    if (['params.vgs', 'params.vds', 'params.wOverL', 'params.tempK'].some((k) => changed.has(k))) this.applyParams(state);
  }

  get model(): MosfetResult {
    return this.result;
  }

  private applyParams(state: AppState): void {
    const p = state.params;
    this.result = mosfet({ vgs: p.vgs, vds: p.vds, wOverL: p.wOverL, tempK: p.tempK });
    const res = this.result;
    // channel thickness profile
    const pos = this.channelGeo.getAttribute('position') as THREE.BufferAttribute;
    if (!this.baseY) this.baseY = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
    const tMax = 0.55 * Math.min(1.4, res.nsSource / NS_REF);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const q = channelProfile(res.vov, p.vds, (x - XS) / L);
      const t = Math.max(tMax * q, 0.001);
      pos.setY(i, this.baseY[i] < -0.5 ? -t : -0.0005);
    }
    pos.needsUpdate = true;
    this.channelGeo.computeVertexNormals();
    const on = res.vov > 0;
    this.channel.userData.hidden = !on;
    this.channelMat.emissiveIntensity = 0.5 + 1.2 * Math.min(1, res.nsSource / NS_REF);
    // depletion (schematic): grows with gate voltage up to threshold, then pinned
    const vEff = Math.max(0, Math.min(p.vgs, res.vth));
    const wd = 0.25 + 1.1 * Math.sqrt(vEff / Math.max(res.vth, 0.1));
    this.depletion.scale.y = wd;
    this.depletion.position.y = -wd / 2;
    const wdd = 0.4 * Math.sqrt(1 + p.vds / 0.8);
    this.drainDep.scale.set(3.7 + 2 * wdd, 1.2 + wdd, 1);
    this.drainDep.position.set(3.35, -0.6 - wdd / 2 + 0.01, 0);
    // oxide field arrows
    const e = Math.min(1.5, Math.abs(p.vgs) / 2);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) {
      m4.compose(v3(-1.2 + i * 0.4, TOX / 2, -2.2 + j * 1.45), new THREE.Quaternion(), v3(1, Math.max(0.05, e), 1));
      this.arrows.setMatrixAt(k++, m4);
    }
    this.arrows.instanceMatrix.needsUpdate = true;
    this.arrowMat.emissiveIntensity = 0.3 + e;
    this.markOpacityDirty();
  }

  protected tick(dt: number): void {
    const res = this.result;
    const p = this.ctx.store.get().params;
    syncPointScale(this.electrons);
    syncPointScale(this.holes);
    const emat = this.electrons.material as THREE.ShaderMaterial;
    const hmat = this.holes.material as THREE.ShaderMaterial;
    emat.uniforms.uOpacity.value = this.alpha;
    hmat.uniforms.uOpacity.value = this.alpha * 0.9;
    this.electrons.visible = this.holes.visible = this.alpha > 0.02;
    if (!this.electrons.visible) return;
    // number of electrons in the channel ∝ sheet density; drift speed ∝ Id / Qinv (continuity)
    const frac = Math.min(1, res.nsSource / NS_REF);
    const inChannelTarget = res.vov > 0 ? Math.floor(40 + 200 * frac) : 0;
    const idNorm = Math.min(3, res.id / 1e-3);
    const tMax = 0.55 * Math.min(1.4, res.nsSource / NS_REF);
    let inChannel = this.eState.filter((s) => s.region === 1).length;
    const pos = this.electrons.geometry.getAttribute('position') as THREE.BufferAttribute;
    const temp = Math.sqrt(p.tempK / 300);
    this.eState.forEach((s, i) => {
      s.phase += dt;
      if (s.region === 1) {
        const q = Math.max(channelProfile(res.vov, p.vds, (s.x - XS) / L), 0.12);
        const v = (0.4 + 2.2 * idNorm) / q; // continuity: v(x) ∝ 1/Q(x)
        s.x += v * dt * 0.6;
        const t = Math.max(tMax * channelProfile(res.vov, p.vds, (s.x - XS) / L), 0.02);
        s.y = THREE.MathUtils.lerp(s.y, -t * (0.2 + 0.6 * ((i * 37) % 10) / 10), 0.2);
        if (s.x > XD + 0.1 || res.vov <= 0) {
          Object.assign(s, this.spawnReservoir(2));
          inChannel--;
        }
      } else {
        // thermal jiggle inside reservoirs
        s.x += Math.sin(s.phase * 3.1 + i) * dt * 0.3 * temp;
        s.z += Math.cos(s.phase * 2.3 + i) * dt * 0.3 * temp;
        const cx = s.region === 0 ? -3.35 : 3.35;
        s.x = THREE.MathUtils.clamp(s.x, cx - 1.7, cx + 1.7);
        s.z = THREE.MathUtils.clamp(s.z, -Z * 0.95, Z * 0.95);
        if (s.region === 0 && inChannel < inChannelTarget && this.rand() < dt * 6 && s.x > -2.6) {
          s.region = 1;
          s.x = XS;
          s.y = -0.05;
          inChannel++;
        }
        if (s.region === 2 && this.rand() < dt * 0.4) Object.assign(s, this.spawnReservoir(0));
      }
      pos.setXYZ(i, s.x, s.y, s.z);
    });
    pos.needsUpdate = true;
    // holes: jiggle, repelled from depletion region under the gate
    const hp = this.holes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const depth = this.depletion.scale.y;
    this.hState.forEach((h, i) => {
      h.phase += dt;
      h.x += Math.sin(h.phase * 2 + i) * dt * 0.4 * temp;
      h.z += Math.cos(h.phase * 1.7 + i) * dt * 0.4 * temp;
      h.x = THREE.MathUtils.clamp(h.x, -5.1, 5.1);
      h.z = THREE.MathUtils.clamp(h.z, -Z * 0.95, Z * 0.95);
      const underGate = Math.abs(h.x) < L / 2 + 0.3;
      const minDepth = underGate ? -depth - 0.1 : -1.4;
      if (h.y > minDepth) h.y += (minDepth - 0.05 - h.y) * Math.min(1, dt * 3);
      hp.setXYZ(i, h.x, h.y, h.z);
    });
    hp.needsUpdate = true;
  }
}
