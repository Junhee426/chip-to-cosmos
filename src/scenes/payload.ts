import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { EngMode } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, cylinder, group, v3 } from '../graphics/geometry';
import { FlowPath } from '../graphics/particles';
import { RadiationShower, setHeat } from '../graphics/effects';
import { pcbTextures } from '../graphics/textures';
import { SIGNAL_CHAIN } from '../models/rf';
import { BaseLevel, type Anchor } from './base';

interface ModuleSpec {
  id: string;
  name: string;
  sub: string;
  chain: string;
  color: number;
  build: (g: THREE.Group) => void;
  child?: LevelId;
}

const PITCH = 0.82;
const MH = 2.6; // module height (units: 0.1 m)
const MD = 3.0; // module depth

/**
 * LEVEL 2 — communication payload (units: 0.1 m). Line-replaceable modules are
 * ordered along +X in signal-chain order; the beamformer card is an open PCB
 * that becomes the PCB level.
 */
export class PayloadLevel extends BaseLevel {
  readonly id = 'payload' as const;
  readonly radius = 4;
  home = { pos: v3(7.5, 5.5, 10.5), target: v3(0, -0.2, 0) };
  private modules = new Map<string, THREE.Group>();
  private shower!: RadiationShower;
  private cardBoard!: THREE.Object3D;

  build(): void {
    const r = this.root;
    // ---------- enclosure ----------
    const coverMat = mat.aluminum();
    const lidMat = mat.anodized(0x4a505a);
    this.registerCutaway([coverMat, lidMat]);
    this.cutawayLocal = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.2);
    const enclosure = group(
      box(8.2, 0.12, 3.6, mat.anodized(0x30353d), [0, -1.66, 0]),
      box(8.2, 0.08, 3.6, lidMat, [0, 1.62, 0]),
      box(0.1, 3.3, 3.6, coverMat, [-4.1, 0, 0]),
      box(0.1, 3.3, 3.6, coverMat, [4.1, 0, 0]),
      box(8.2, 3.3, 0.08, coverMat, [0, 0, 1.8]),
      box(8.2, 3.3, 0.1, mat.anodized(0x262a31), [0, 0, -1.8]),
    );
    // backplane connectors
    for (let i = 0; i < 9; i++) enclosure.add(box(0.5, 1.8, 0.2, mat.moldCompound(), [-3.28 + i * PITCH, -0.2, -1.65]));
    // mounting feet
    for (const x of [-3.9, 3.9]) for (const z of [-1.6, 1.6]) enclosure.add(box(0.5, 0.1, 0.5, mat.aluminum(), [x, -1.75, z]));
    r.add(enclosure);
    this.addComponent({ id: 'enclosure', name: 'Payload Chassis', sub: 'Al enclosure · backplane', object: enclosure, labelLocal: v3(-4.1, 1.6, 1.8), desc: 'Machined aluminium enclosure with a backplane; each function is a line-replaceable module conducting heat into the base plate.', specs: ['≈ 80 × 33 × 36 cm', 'Conduction-cooled modules', 'EMI-tight cover'] });

    // ---------- modules ----------
    const specs: ModuleSpec[] = [
      { id: 'rf-fe', name: 'RF Front End', sub: 'Ka-band Rx', chain: 'antenna', color: 0x3d4452, build: (g) => {
        g.add(box(0.5, 0.35, 0.9, mat.copper(), [0, MH / 2 + 0.17, 0.4]));
        g.add(box(0.36, 0.2, 0.76, mat.darkPanel(), [0, MH / 2 + 0.26, 0.4]));
      } },
      { id: 'lna', name: 'LNA', sub: 'NF 1.2 dB · G 22 dB', chain: 'lna', color: 0x3a4150, build: (g) => {
        g.add(box(0.5, 0.6, 1.0, mat.gold(), [0.0, 0.3, 0.4]));
      } },
      { id: 'filter', name: 'Filter', sub: 'Cavity BPF', chain: 'filter', color: 0x40454d, build: (g) => {
        const f = box(0.6, 1.6, 2.2, mat.aluminum(), [0, 0.1, 0]);
        g.add(f);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 5; b++) g.add(cylinder(0.05, 0.14, mat.nickel(), [0.34, -0.5 + a * 0.6, -0.8 + b * 0.4], 12, 'x'));
      } },
      { id: 'mixer', name: 'Mixer / LO', sub: 'Down-conversion', chain: 'mixer', color: 0x3b4050, build: (g) => {
        g.add(box(0.5, 0.5, 0.5, mat.nickel(), [0, 0.6, 0.6]));
        g.add(box(0.5, 0.35, 0.8, mat.gold(), [0, -0.4, -0.3]));
      } },
      { id: 'adc', name: 'ADC / DAC', sub: 'Sampling & quantisation', chain: 'adc', color: 0x353c49, build: (g) => {
        g.add(box(0.1, 1.9, 2.4, mat.fr4(), [0.25, 0, 0]));
        for (let i = 0; i < 4; i++) g.add(box(0.08, 0.35, 0.35, mat.moldCompound(), [0.33, -0.6 + i * 0.4, 0.4]));
      } },
      { id: 'modem', name: 'Modem', sub: 'LDPC · BPSK–64QAM', chain: 'modem', color: 0x363d4a, build: (g) => {
        g.add(box(0.1, 1.9, 2.4, mat.fr4(), [0.25, 0, 0]));
        const hs = new THREE.Group();
        for (let i = 0; i < 7; i++) hs.add(box(0.2, 0.9, 0.04, mat.aluminum(), [0.42, 0.2, -0.3 + i * 0.1]));
        g.add(hs);
      } },
      { id: 'beamformer', name: 'Beamformer', sub: 'Digital BF card → PCB', chain: 'beamformer', color: 0x2f3542, child: 'pcb', build: () => {} },
      { id: 'obp', name: 'OBP', sub: 'On-board processor', chain: 'dsp', color: 0x363b46, build: (g) => {
        for (let i = 0; i < 9; i++) g.add(box(0.36, 1.8, 0.05, mat.aluminum(), [0.1, 0.1, -1.1 + i * 0.27]));
      } },
      { id: 'pa', name: 'PA', sub: 'GaN SSPA', chain: 'pa', color: 0x3d4351, build: (g) => {
        for (let i = 0; i < 6; i++) g.add(box(0.5, 0.05, 2.4, mat.gold(), [0, -0.9 + i * 0.36, 0]));
        g.add(box(0.36, 0.3, 0.6, mat.copper(), [0, MH / 2 + 0.15, 0.6]));
      } },
    ];

    const { map, rough, emissive } = pcbTextures();
    specs.forEach((s, i) => {
      const g = new THREE.Group();
      const x = -3.28 + i * PITCH;
      if (s.id === 'beamformer') {
        // open card: frame rails + exposed PCB (rotated into the YZ plane)
        g.add(box(0.1, MH, 0.12, mat.aluminum(), [0, 0, MD / 2 - 0.06]));
        g.add(box(0.1, MH, 0.12, mat.aluminum(), [0, 0, -MD / 2 + 0.06]));
        g.add(box(0.1, 0.12, MD, mat.aluminum(), [0, -MH / 2 + 0.06, 0]));
        const board = new THREE.Group();
        const pcbMat = mat.pcb(map, rough, emissive);
        const plate = box(2.4, 0.03, 2.0, pcbMat, [0, 0, 0]);
        board.add(plate);
        board.add(box(0.35, 0.05, 0.35, mat.nickel(), [0.2, 0.04, 0]));
        board.add(box(0.14, 0.04, 0.1, mat.moldCompound(), [0.75, 0.035, 0.3]));
        board.add(box(0.14, 0.04, 0.1, mat.moldCompound(), [0.75, 0.035, -0.3]));
        board.add(box(0.1, 0.09, 1.4, mat.moldCompound(), [1.15, 0.06, 0]));
        board.add(box(0.55, 0.05, 1.6, mat.aluminum(), [-0.75, 0.04, 0]));
        // PCB level frame: X→Z, Y→X, Z→Y
        board.quaternion.copy(PayloadLevel.cardRotation());
        board.position.set(0.05, 0.1, 0);
        this.cardBoard = board;
        g.add(board);
      } else {
        g.add(box(0.7, MH, MD, mat.anodized(s.color), [0, 0, 0], 0.03));
        // front panel with connectors & handle
        g.add(box(0.72, MH, 0.06, mat.aluminum(), [0, 0, MD / 2 + 0.02]));
        g.add(box(0.1, 0.1, 0.5, mat.aluminum(), [0, MH / 2 - 0.25, MD / 2 + 0.25]));
        for (let k = 0; k < 2; k++) g.add(cylinder(0.07, 0.18, mat.gold(), [0, -0.5 + k * 0.5, MD / 2 + 0.12], 16, 'z'));
        s.build(g);
      }
      g.position.set(x, -0.1, 0);
      r.add(g);
      this.modules.set(s.id, g);
      const chain = SIGNAL_CHAIN.find((c) => c.id === s.chain);
      this.addComponent({ id: s.id, name: s.name, sub: s.sub, object: g, labelLocal: v3(0, MH / 2 + 0.1, MD / 2), desc: chain?.func ?? '', specs: chain?.params, chain: s.chain, child: s.child });
      // explode: spread along X, lift alternate modules
      this.explode.add(g, v3((i - 4) * 0.42, (i % 2 === 0 ? 0.9 : -0.1) * 0.8, 0.8 + (i % 3) * 0.25), 0.08 + i * 0.05, 0.55 + i * 0.05);
    });
    this.explode.add(enclosure.children[1], v3(0, 2.8, 0), 0, 0.45);
    this.explode.add(enclosure.children[4], v3(0, 0, 3.5), 0, 0.45);

    // ---------- waveguide & coax interconnect ----------
    const wg = mat.copper();
    const inter = new THREE.Group();
    for (let i = 0; i < 8; i++) inter.add(box(PITCH - 0.1, 0.06, 0.06, wg, [-3.28 + (i + 0.5) * PITCH, 1.4, 1.35]));
    r.add(inter);

    // ---------- modes ----------
    const ids = specs.map((s) => s.id);
    this.modeFocus = {
      signal: ids,
      power: ['enclosure', 'pa', 'obp', 'modem', 'adc', 'beamformer', 'lna'],
      thermal: ['enclosure', 'pa', 'obp', 'beamformer', 'modem'],
      radiation: ['adc', 'modem', 'beamformer', 'obp'],
    };
    const chainPts = [v3(-3.28, 3.0, 0.4), v3(-3.28, 1.45, 1.1)];
    for (let i = 0; i < 9; i++) chainPts.push(v3(-3.28 + i * PITCH, 0.4 + 0.25 * Math.sin(i), 1.2));
    chainPts.push(v3(3.28, 1.45, 1.1), v3(3.28, 3.0, 0.6));
    this.addFlow('signal', new FlowPath(chainPts, { color: COLORS.signal, count: 90, size: 0.09, speed: 0.08, tube: 0.02 }));
    this.addFlow('power', new FlowPath(Array.from({ length: 10 }, (_, i) => v3(-4.0 + i * 0.9, -1.2, -1.5)), { color: COLORS.power, count: 40, size: 0.08, speed: 0.1, tube: 0.018 }));
    for (const i of [0, 4, 5, 6, 7, 8]) this.addFlow('power', new FlowPath([v3(-3.28 + i * PITCH, -1.2, -1.5), v3(-3.28 + i * PITCH, 0, -0.8)], { color: COLORS.power, count: 6, size: 0.07, speed: 0.4 }));
    for (const id of ['pa', 'obp', 'beamformer']) {
      const x = -3.28 + ids.indexOf(id) * PITCH;
      this.addFlow('thermal', new FlowPath([v3(x, 0.4, 0), v3(x, -1.5, 0), v3(x + (x > 0 ? 1 : -1) * 0.8, -1.65, 0.5), v3(x, -2.8, 0.5)], { color: COLORS.thermal, count: 18, size: 0.09, speed: 0.22, tube: 0.015 }));
    }
    this.shower = new RadiationShower(['adc', 'modem', 'beamformer', 'obp'].map((id) => v3(-3.28 + ids.indexOf(id) * PITCH, 0.2, 0.5)), 6, 14, COLORS.radiation, 0.08);
    r.add(this.shower.group);
  }

  static cardRotation(): THREE.Quaternion {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(0, 0, 1), v3(1, 0, 0), v3(0, 1, 0)));
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'pcb') return null;
    this.root.updateMatrixWorld();
    const inv = this.root.matrixWorld.clone().invert();
    const pos = this.cardBoard.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    return { position: pos, size: 1.2, quaternion: PayloadLevel.cardRotation(), focus: 'beamformer' };
  }

  protected onModeChanged(mode: EngMode): void {
    this.shower?.setActive(mode === 'radiation');
    for (const [id, g] of this.modules) setHeat(g, mode === 'thermal' ? ({ pa: 1, obp: 0.75, beamformer: 0.55, modem: 0.4 } as Record<string, number>)[id] ?? 0.08 : 0);
  }

  protected tick(dt: number): void {
    this.shower.setLevelAlpha(this.alpha);
    this.shower.update(dt);
  }
}
