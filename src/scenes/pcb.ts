import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { EngMode } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, cylinder, group, instancedGrid, trace, v3 } from '../graphics/geometry';
import { FlowPath } from '../graphics/particles';
import { RadiationShower, setHeat } from '../graphics/effects';
import { pcbTextures } from '../graphics/textures';
import { mulberry32 } from '../models/units';
import { BaseLevel, type Anchor } from './base';

const BW = 24; // board X (cm)
const BD = 20; // board Z (cm)

/**
 * LEVEL 3 — beamformer / modem PCB (units: cm). A 10-layer stack-up with RF,
 * digital and power sections. The exploded view lifts parts and separates
 * the copper/dielectric layers.
 */
export class PcbLevel extends BaseLevel {
  readonly id = 'pcb' as const;
  readonly radius = 12;
  home = { pos: v3(18, 20, 25), target: v3(0, -0.5, 0) };
  private soc!: THREE.Group;
  private pcbMat!: THREE.MeshStandardMaterial;
  private shower!: RadiationShower;
  private power!: THREE.Group;

  build(): void {
    const r = this.root;
    const { map, rough, emissive } = pcbTextures();

    // ---------- stack-up ----------
    const stack = new THREE.Group();
    const layers = 10;
    const cuT = 0.012;
    const dT = 0.028;
    let y = 0;
    for (let i = 0; i < layers; i++) {
      const cu = box(BW - 0.02, cuT, BD - 0.02, i === 0 || i === layers - 1 ? mat.copper() : mat.copper(), [0, 0, 0]);
      const lay = group(cu);
      lay.position.y = -y;
      stack.add(lay);
      this.explode.add(lay, v3(0, -i * 0.32, 0), 0.0, 0.6);
      y += cuT;
      if (i < layers - 1) {
        const di = box(BW, dT, BD, mat.fr4(), [0, 0, 0]);
        const dl = group(di);
        dl.position.y = -y - dT / 2;
        stack.add(dl);
        this.explode.add(dl, v3(0, -i * 0.32 - 0.16, 0), 0.0, 0.6);
        y += dT;
      }
    }
    this.pcbMat = mat.pcb(map, rough, emissive);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), this.pcbMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = cuT / 2 + 0.002;
    top.receiveShadow = true;
    stack.add(top);
    // plated mounting holes
    for (const x of [-BW / 2 + 0.8, BW / 2 - 0.8]) for (const z of [-BD / 2 + 0.8, BD / 2 - 0.8]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.32, 32), mat.gold());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, cuT / 2 + 0.004, z);
      stack.add(ring);
    }
    r.add(stack);
    this.addComponent({ id: 'board', name: 'Multilayer PCB', sub: '10-layer · RF laminate + FR-4', object: stack, labelLocal: v3(-BW / 2, 0, BD / 2 - 2), desc: 'Ten copper layers separated by dielectric: RF microstrip on a low-loss top laminate, ground planes for return current, power planes, and high-speed digital routing.', specs: ['Board 240 × 200 mm, 1.6 mm (thickness exaggerated)', 'Stack: SIG/GND/SIG/PWR/GND…', 'Blind & buried vias'] });

    // vias (instanced)
    const rand = mulberry32(8);
    const viaGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10);
    const viaMesh = new THREE.InstancedMesh(viaGeo, mat.gold(), 700);
    const m4 = new THREE.Matrix4();
    let vc = 0;
    while (vc < 700) {
      const x = (rand() - 0.5) * (BW - 1);
      const z = (rand() - 0.5) * (BD - 1);
      if (Math.abs(x - 2) < 2.4 && Math.abs(z) < 2.4) continue;
      m4.makeTranslation(x, 0.012, z);
      viaMesh.setMatrixAt(vc++, m4);
    }
    viaMesh.userData.lodScatter = true;
    r.add(viaMesh);

    // ---------- hero RF-SoC (flip-chip BGA with lid) ----------
    this.soc = group(
      box(3.5, 0.12, 3.5, mat.substrate(), [0, 0.18, 0]),
      box(3.1, 0.2, 3.1, mat.nickel(), [0, 0.34, 0], 0.08),
    );
    const balls = instancedGrid(new THREE.SphereGeometry(0.05, 8, 6), mat.solder(), 20, 20, 0.16, 0.16, 0.07);
    this.soc.add(balls);
    this.soc.position.set(2, 0, 0);
    r.add(this.soc);
    this.addComponent({ id: 'soc', name: 'RF-SoC Package', sub: 'Beamformer ASIC · 35 mm BGA', object: this.soc, labelLocal: v3(0, 0.45, 1.5), desc: 'Flip-chip BGA containing the digital beamformer SoC and memory on a silicon interposer. Double-click to open the package.', specs: ['35 × 35 mm, 1156 balls (illustrative)', 'TDP ≈ 25 W', 'Ni-plated Cu heat spreader'], child: 'package' });
    this.explode.add(this.soc, v3(0, 2.4, 0), 0.3, 0.9);

    // ---------- memory ----------
    const mem = new THREE.Group();
    for (const z of [-3, 3]) mem.add(box(1.4, 0.14, 1.0, mat.moldCompound(), [7.2, 0.1, z]));
    r.add(mem);
    this.addComponent({ id: 'ddr', name: 'DDR Memory', sub: 'Packet buffers', object: mem, labelLocal: v3(7.2, 0.2, 3.5), desc: 'Radiation-tolerant DDR memory with EDAC for packet buffering and beam-weight tables.', specs: ['EDAC / scrubbing', 'Length-matched byte lanes'] });
    this.explode.add(mem, v3(0, 1.6, 0), 0.35, 0.85);

    // ---------- RF section: SMA → LNA → transceiver → SoC ----------
    const rf = new THREE.Group();
    const copper = mat.copper();
    const smaGroup = new THREE.Group();
    for (const z of [-6, -2, 2, 6]) {
      const sma = group(
        cylinder(0.32, 0.6, mat.gold(), [0, 0, 0], 6, 'x'),
        cylinder(0.22, 0.9, mat.gold(), [-0.6, 0, 0], 24, 'x'),
        box(0.2, 0.7, 0.7, mat.gold(), [0.35, 0, 0]),
      );
      sma.position.set(-BW / 2 + 0.3, 0.35, z);
      smaGroup.add(sma);
      rf.add(box(0.5, 0.1, 0.5, mat.moldCompound(), [-8.8, 0.06, z]));
      rf.add(box(0.8, 0.12, 0.8, mat.moldCompound(), [-6.4, 0.07, z]));
      rf.add(trace([v3(-BW / 2 + 0.6, 0.02, z), v3(-9.05, 0.02, z)], 0.14, 0.012, copper));
      rf.add(trace([v3(-8.55, 0.02, z), v3(-6.8, 0.02, z)], 0.14, 0.012, copper));
      rf.add(trace([v3(-6.0, 0.02, z), v3(-3.2, 0.02, z), v3(-1.6, 0.02, z * 0.25)], 0.08, 0.012, copper));
    }
    r.add(rf, smaGroup);
    this.addComponent({ id: 'rf', name: 'RF Front-End ICs', sub: 'LNA · transceiver', object: rf, labelLocal: v3(-8.8, 0.1, -6), desc: 'Four receive channels: GaAs/SiGe LNAs followed by integrated transceivers. 50 Ω microstrip lines on the RF laminate.', specs: ['Microstrip Z0 = 50 Ω', 'LNA NF 1.2 dB', 'Channel isolation > 50 dB'] });
    this.addComponent({ id: 'sma', name: 'RF Connectors', sub: 'SMA / 2.92 mm', object: smaGroup, labelLocal: v3(-0.6, 0.2, 0), desc: 'Precision coaxial connectors bringing RF from the antenna feeds onto the board.', specs: ['DC–40 GHz (2.92 mm)', 'Edge-launch'] });
    this.explode.add(rf, v3(0, 1.2, 0), 0.25, 0.8);

    // shield can (cutaway-able)
    const canMat = mat.aluminum();
    this.registerCutaway([canMat]);
    this.cutawayLocal = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.45);
    const can = group(
      box(5.6, 0.04, 15.6, canMat, [-7.6, 0.6, 0]),
      box(5.6, 0.6, 0.04, canMat, [-7.6, 0.3, 7.8]),
      box(5.6, 0.6, 0.04, canMat, [-7.6, 0.3, -7.8]),
      box(0.04, 0.6, 15.6, canMat, [-10.4, 0.3, 0]),
      box(0.04, 0.6, 15.6, canMat, [-4.8, 0.3, 0]),
    );
    r.add(can);
    this.addComponent({ id: 'shield', name: 'RF Shield Can', sub: 'EMI isolation', object: can, labelLocal: v3(-7.6, 0.6, -7.8), desc: 'Stamped metal can isolating sensitive receive channels from digital switching noise.', specs: ['Nickel-silver', 'Soldered fence with via stitching'] });
    this.explode.add(can, v3(0, 3.2, 0), 0.0, 0.5);

    // ---------- power ----------
    const pwr = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      pwr.add(box(0.6, 0.1, 0.6, mat.moldCompound(), [5 + i * 1.8, 0.06, 7.2]));
      pwr.add(box(0.8, 0.5, 0.8, mat.anodized(0x3a3d42), [5 + i * 1.8, 0.26, 8.5]));
      pwr.add(box(0.7, 0.35, 0.45, mat.ceramic(0xb08b3a), [5.9 + i * 1.8, 0.18, 6.1]));
    }
    r.add(pwr);
    this.power = pwr;
    this.addComponent({ id: 'power', name: 'Point-of-Load Power', sub: 'Buck converters', object: pwr, labelLocal: v3(6.8, 0.5, 8.5), desc: 'Synchronous buck converters generate the SoC core (0.8 V), I/O and RF supply rails from the 12 V backplane rail.', specs: ['η ≈ 90 %', 'Core rail 0.8 V @ 25 A', 'Remote sense'] });
    this.explode.add(pwr, v3(0, 1.5, 0), 0.4, 0.95);

    // decoupling capacitors (instanced 0402)
    const capGeo = new THREE.BoxGeometry(0.1, 0.05, 0.05);
    const caps = new THREE.InstancedMesh(capGeo, mat.ceramic(0x9a7c56), 320);
    for (let i = 0; i < 320; i++) {
      const ang = (i / 80) * Math.PI * 2;
      const ring = 2.1 + (i % 4) * 0.22;
      const x = 2 + Math.cos(ang) * ring * (Math.abs(Math.cos(ang)) > 0.7 ? 1 : 1.02);
      const z = Math.sin(ang) * ring;
      m4.makeRotationY(ang).setPosition(x, 0.035, z);
      caps.setMatrixAt(i, m4);
    }
    caps.userData.lodScatter = true;
    r.add(caps);

    // backplane connector + crystal
    const conn = group(box(1.0, 0.9, 14, mat.moldCompound(), [BW / 2 - 0.7, 0.45, 0]));
    conn.add(instancedGrid(new THREE.BoxGeometry(0.05, 0.1, 0.05), mat.gold(), 4, 60, 0.2, 0.22, 0.95, undefined, (_i, _j, mm) => mm.setPosition(new THREE.Vector3().setFromMatrixPosition(mm).add(v3(BW / 2 - 0.7, 0, 0)))));
    r.add(conn);
    this.addComponent({ id: 'connector', name: 'Backplane Connector', sub: 'Power + SerDes', object: conn, labelLocal: v3(BW / 2 - 0.7, 0.9, -7), desc: 'High-density connector carrying 12 V power and multi-gigabit SerDes lanes to the rest of the payload.', specs: ['25 Gb/s lanes', '12 V / 40 A'] });
    r.add(box(0.5, 0.18, 0.32, mat.nickel(), [-2, 0.1, 5.5]));

    // ---------- modes ----------
    this.modeFocus = {
      signal: ['sma', 'rf', 'soc', 'ddr', 'connector', 'board'],
      power: ['connector', 'power', 'soc', 'board'],
      thermal: ['soc', 'power', 'board'],
      radiation: ['soc', 'ddr', 'rf'],
    };
    for (const z of [-6, -2, 2, 6]) this.addFlow('signal', new FlowPath([v3(-BW / 2 - 0.8, 0.35, z), v3(-8.8, 0.25, z), v3(-6.4, 0.25, z), v3(-3.2, 0.2, z), v3(0.3, 0.45, z * 0.25)], { color: COLORS.signal, count: 22, size: 0.18, speed: 0.22, tube: 0.03 }));
    this.addFlow('signal', new FlowPath([v3(3.8, 0.45, 0), v3(6.5, 0.3, 3), v3(7.2, 0.3, 3)], { color: '#9fd7ff', count: 10, size: 0.16, speed: 0.4, tube: 0.025 }));
    this.addFlow('signal', new FlowPath([v3(3.8, 0.45, -0.5), v3(8, 0.3, -1), v3(BW / 2 - 0.7, 0.9, -1)], { color: '#9fd7ff', count: 14, size: 0.16, speed: 0.35, tube: 0.025 }));
    this.addFlow('power', new FlowPath([v3(BW / 2 - 0.7, 0.9, 6), v3(9, 0.3, 7.2), v3(5, 0.3, 7.2)], { color: COLORS.power, count: 20, size: 0.18, speed: 0.3, tube: 0.03 }));
    this.addFlow('power', new FlowPath([v3(5, 0.3, 7.2), v3(3, 0.3, 4), v3(2, 0.5, 1.2)], { color: COLORS.power, count: 18, size: 0.18, speed: 0.35, tube: 0.03 }));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.addFlow('thermal', new FlowPath([v3(2, 0.5, 0), v3(2 + Math.cos(a) * 3, 0.05, Math.sin(a) * 3), v3(2 + Math.cos(a) * 8, -0.1, Math.sin(a) * 7)], { color: COLORS.thermal, count: 12, size: 0.2, speed: 0.25 }));
    }
    this.addFlow('thermal', new FlowPath([v3(2, 0.5, 0), v3(2, 3.5, 0)], { color: '#ff9a6a', count: 10, size: 0.22, speed: 0.4 }));
    this.shower = new RadiationShower([v3(2, 0.4, 0), v3(7.2, 0.2, 3), v3(7.2, 0.2, -3), v3(1, 0.4, 1)], 10, 16, COLORS.radiation, 0.16);
    r.add(this.shower.group);
    this.showers.push(this.shower);
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'package') return null;
    return { position: this.soc.position.clone().add(v3(0, 0.02, 0)), size: 1.75, focus: 'soc' };
  }

  protected onModeChanged(mode: EngMode): void {
    this.shower?.setActive(mode === 'radiation');
    if (this.pcbMat) {
      this.pcbMat.emissive.set(mode === 'signal' ? '#1f6fae' : '#000000');
      this.pcbMat.emissiveIntensity = mode === 'signal' ? 0.9 : 0;
    }
    if (this.soc) {
      setHeat(this.soc, mode === 'thermal' ? 0.9 : 0);
      setHeat(this.power, mode === 'thermal' ? 0.45 : 0);
    }
  }

  protected tick(dt: number): void {
    this.shower.setLevelAlpha(this.alpha);
    this.shower.update(dt);
  }
}
