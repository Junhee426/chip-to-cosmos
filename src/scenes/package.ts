import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { EngMode } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, group, instancedGrid, v3 } from '../graphics/geometry';
import { FlowPath } from '../graphics/particles';
import { RadiationShower, setHeat } from '../graphics/effects';
import { dieTexture, pcbTextures } from '../graphics/textures';
import { BaseLevel, type Anchor } from './base';

const DIE_X = -1.6;
const DIE_TOP = 1.26;

/**
 * LEVEL 4 — 2.5D advanced package (units: 2.5 mm). Every layer has real
 * thickness. Vertical dimensions of thin layers (interposer, TIM) are exaggerated.
 */
export class PackageLevel extends BaseLevel {
  readonly id = 'package' as const;
  readonly radius = 7;
  home = { pos: v3(15, 11.5, 19), target: v3(0, 0.3, 0) };
  private die!: THREE.Group;
  private shower!: RadiationShower;

  build(): void {
    const r = this.root;
    const { map, rough } = pcbTextures();

    // PCB coupon
    const pcbTop = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), mat.pcb(map, rough));
    pcbTop.rotation.x = -Math.PI / 2;
    pcbTop.position.y = 0.001;
    const pcb = group(box(18, 0.64, 18, mat.fr4(), [0, -0.32, 0]), pcbTop);
    r.add(pcb);
    this.addComponent({ id: 'pcb', name: 'PCB', sub: 'Host board', object: pcb, labelLocal: v3(-9, 0, 6), desc: 'Host printed circuit board; BGA lands connect to internal power planes and SerDes routing.', specs: ['1.6 mm, 10 layers', 'Via-in-pad under BGA'] });

    // BGA solder balls
    const balls = instancedGrid(new THREE.SphereGeometry(0.11, 10, 6), mat.solder(), 32, 32, 0.4, 0.4, 0.1);
    const bga = group(balls);
    r.add(bga);
    this.addComponent({ id: 'bga', name: 'BGA Balls', sub: 'SAC305 · 1.0 mm pitch', object: bga, labelLocal: v3(6.2, 0.1, 6.2), desc: 'Ball-grid-array solder joints connecting package substrate to PCB.', specs: ['1024 balls (illustrative)', 'Pitch 1.0 mm', 'Underfill for thermal cycling'] });

    // substrate with layer lines
    const substrate = group(box(14, 0.48, 14, mat.substrate(), [0, 0.44, 0]));
    for (let i = 1; i < 6; i++) substrate.add(box(14.01, 0.012, 14.01, mat.copper(), [0, 0.2 + i * 0.08, 0]));
    r.add(substrate);
    this.addComponent({ id: 'substrate', name: 'Substrate', sub: 'Organic build-up', object: substrate, labelLocal: v3(-7, 0.44, 7), desc: 'Organic build-up substrate fanning out the dense interposer C4 grid to the coarse BGA pitch; contains power planes and decoupling.', specs: ['12-layer ABF build-up', '35 × 35 mm', 'Embedded capacitors'] });

    // C4 bumps
    const c4 = group(instancedGrid(new THREE.SphereGeometry(0.045, 6, 4), mat.solder(), 50, 50, 0.2, 0.2, 0.72));
    r.add(c4);
    this.addComponent({ id: 'c4', name: 'C4 Bumps', sub: '≈150 µm pitch', object: c4, labelLocal: v3(5, 0.72, 5), desc: 'Controlled-collapse chip-connection bumps joining the interposer to the substrate.', specs: ['Pitch ≈ 150–200 µm', 'SnAg solder'] });

    // interposer + TSVs + RDL
    const interposer = group(box(10, 0.14, 10, mat.interposer(), [0, 0.83, 0]));
    interposer.add(instancedGrid(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), mat.copper(), 25, 25, 0.4, 0.4, 0.83));
    for (let i = 0; i < 16; i++) interposer.add(box(3.2, 0.01, 0.04, mat.copper(), [(DIE_X + 2.8) / 2 + 0.6, 0.905, -2.8 + i * 0.37]));
    r.add(interposer);
    this.addComponent({ id: 'interposer', name: 'Silicon Interposer', sub: 'TSV + RDL', object: interposer, labelLocal: v3(5, 0.83, -4), desc: 'Passive silicon interposer with through-silicon vias (TSVs) and fine redistribution layers (RDL) providing thousands of short die-to-die wires.', specs: ['TSV Ø 10 µm, 100 µm deep', 'RDL line/space 0.4/0.4 µm', 'Thickness exaggerated ×3'] });

    // micro-bumps
    const ub = new THREE.Group();
    ub.add(instancedGrid(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 6), mat.copper(), 46, 46, 0.12, 0.12, 0.93, undefined, (_i, _j, m) => m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).add(v3(DIE_X, 0, 0)))));
    for (const z of [-1.9, 1.9]) ub.add(instancedGrid(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 6), mat.copper(), 17, 23, 0.12, 0.12, 0.93, undefined, (_i, _j, m) => m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).add(v3(2.8, 0, z)))));
    r.add(ub);
    this.addComponent({ id: 'ubumps', name: 'Micro-bumps', sub: 'Cu pillar · 40 µm pitch', object: ub, labelLocal: v3(DIE_X - 2.6, 0.93, 2.6), desc: 'Copper-pillar micro-bumps: the fine-pitch joints between each die and the interposer.', specs: ['Pitch ≈ 40 µm (shown coarser)', 'Cu pillar + SnAg cap'] });

    // logic die (face-down) and memory stacks
    this.die = group(box(5.6, 0.3, 5.6, mat.die(dieTexture()), [0, 0, 0]));
    this.die.position.set(DIE_X, DIE_TOP - 0.15, 0);
    r.add(this.die);
    this.addComponent({ id: 'die', name: 'Logic Die', sub: 'RF-SoC · 14 × 14 mm', object: this.die, labelLocal: v3(0, 0.15, 2.8), desc: 'The RF-SoC silicon die, mounted face-down (flip-chip). Double-click to see its functional blocks.', specs: ['5 nm-class logic (illustrative)', '≈ 20 B transistors', 'TDP ≈ 25 W'], child: 'die' });

    const mem = new THREE.Group();
    for (const z of [-1.9, 1.9]) {
      const st = new THREE.Group();
      for (let k = 0; k < 5; k++) st.add(box(2.2, 0.052, 3.0, k === 0 ? mat.silicon() : mat.die(dieTexture()), [0, 0.03 + k * 0.06, 0]));
      st.position.set(2.8, 0.96, z);
      mem.add(st);
    }
    r.add(mem);
    this.addComponent({ id: 'memory', name: 'Memory Stacks', sub: '4-high DRAM + base', object: mem, labelLocal: v3(2.8, 1.2, 3.4), desc: 'Stacked DRAM dies joined by TSVs, placed millimetres from the logic die for bandwidth.', specs: ['4-high stack + logic base die', '> 400 GB/s per stack'] });

    // TIM, lid ring, heat spreader
    const tim = group(box(9.2, 0.035, 8.4, mat.anodized(0x7a7e85), [0.2, DIE_TOP + 0.018, 0]));
    r.add(tim);
    this.addComponent({ id: 'tim', name: 'TIM', sub: 'Thermal interface', object: tim, labelLocal: v3(4.8, DIE_TOP, -4), desc: 'Thermal interface material (indium or polymer) filling microscopic gaps between dies and heat spreader.', specs: ['k ≈ 5–80 W/m·K', 'Bond line ≈ 50 µm'] });

    const lidMat = mat.nickel();
    const ring = group(
      box(13, 0.62, 0.9, lidMat, [0, 0.99, 6.05]),
      box(13, 0.62, 0.9, lidMat, [0, 0.99, -6.05]),
      box(0.9, 0.62, 11.2, lidMat, [6.05, 0.99, 0]),
      box(0.9, 0.62, 11.2, lidMat, [-6.05, 0.99, 0]),
    );
    r.add(ring);
    this.addComponent({ id: 'lid', name: 'Package Lid', sub: 'Stiffener ring', object: ring, labelLocal: v3(-6.5, 1.1, -6), desc: 'Lid skirt / stiffener bonded to the substrate: limits warpage and supports the heat spreader.', specs: ['Ni-plated Cu', 'Adhesive seal'] });

    const ihsMat = mat.nickel();
    ihsMat.roughness = 0.5;
    const ihs = group(box(13, 0.3, 13, ihsMat, [0, DIE_TOP + 0.19, 0], 0.08));
    r.add(ihs);
    this.addComponent({ id: 'ihs', name: 'Heat Spreader', sub: 'Integrated (IHS)', object: ihs, labelLocal: v3(-3, DIE_TOP + 0.34, 6.5), desc: 'Integrated heat spreader distributing die hot-spots over a large area before the payload cold plate.', specs: ['Cu, k ≈ 390 W/m·K', 'Ni plating'] });

    // exploded view (bottom goes down, top goes up)
    this.explode.add(pcb, v3(0, -3.2, 0), 0.0, 0.7);
    this.explode.add(bga, v3(0, -2.0, 0), 0.05, 0.75);
    this.explode.add(substrate, v3(0, -1.0, 0), 0.1, 0.8);
    this.explode.add(c4, v3(0, -0.25, 0), 0.15, 0.85);
    this.explode.add(interposer, v3(0, 0.6, 0), 0.2, 0.85);
    this.explode.add(ub, v3(0, 1.4, 0), 0.25, 0.9);
    this.explode.add(this.die, v3(0, 2.3, 0), 0.3, 0.9);
    this.explode.add(mem, v3(0, 2.3, 0), 0.3, 0.9);
    this.explode.add(tim, v3(0, 3.2, 0), 0.35, 0.95);
    this.explode.add(ring, v3(0, 4.2, 0), 0.4, 1.0);
    this.explode.add(ihs, v3(0, 5.4, 0), 0.4, 1.0);

    // modes
    this.modeFocus = {
      signal: ['die', 'memory', 'interposer', 'ubumps', 'c4', 'substrate', 'bga', 'pcb'],
      power: ['pcb', 'bga', 'substrate', 'c4', 'interposer', 'die'],
      thermal: ['die', 'memory', 'tim', 'ihs', 'lid'],
      radiation: ['die', 'memory', 'ihs'],
    };
    this.addFlow('signal', new FlowPath([v3(DIE_X + 1.5, 1.1, -1), v3(DIE_X + 2.8, 0.92, -1.2), v3(2.8, 0.92, -1.9), v3(2.8, 1.15, -1.9)], { color: COLORS.signal, count: 16, size: 0.1, speed: 0.4, tube: 0.015 }));
    this.addFlow('signal', new FlowPath([v3(DIE_X + 1.5, 1.1, 1), v3(DIE_X + 2.8, 0.92, 1.2), v3(2.8, 0.92, 1.9), v3(2.8, 1.15, 1.9)], { color: COLORS.signal, count: 16, size: 0.1, speed: 0.4, tube: 0.015 }));
    this.addFlow('signal', new FlowPath([v3(DIE_X - 2, 1.0, 0), v3(DIE_X - 2, 0.83, 0), v3(DIE_X - 2.4, 0.5, 0), v3(-5.2, 0.1, 0), v3(-7.5, -0.1, 0)], { color: '#9fd7ff', count: 16, size: 0.1, speed: 0.35, tube: 0.015 }));
    for (const x of [-3.5, -1.6, 0.3, 2.8]) this.addFlow('power', new FlowPath([v3(x, -0.3, 0.6), v3(x, 0.1, 0.6), v3(x, 0.72, 0.6), v3(x, 0.83, 0.6), v3(x, 1.1, 0.6)], { color: COLORS.power, count: 10, size: 0.1, speed: 0.5, tube: 0.015 }));
    for (const [x, z] of [[-2.8, -1.5], [-0.6, 1.2], [2.8, 0], [-1.6, 0]]) this.addFlow('thermal', new FlowPath([v3(x, 1.1, z), v3(x, DIE_TOP + 0.35, z), v3(x * 1.3, 4, z * 1.3)], { color: COLORS.thermal, count: 12, size: 0.14, speed: 0.35 }));
    this.shower = new RadiationShower([v3(DIE_X, 1.2, 0), v3(DIE_X + 1, 1.2, 1), v3(2.8, 1.2, 1.9)], 6, 14, COLORS.radiation, 0.1);
    r.add(this.shower.group);
    this.showers.push(this.shower);
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'die') return null;
    return { position: this.die.position.clone().add(v3(0, 0.15, 0)), size: 2.8, focus: 'die' };
  }

  protected onModeChanged(mode: EngMode): void {
    this.shower?.setActive(mode === 'radiation');
    if (this.die) setHeat(this.die, mode === 'thermal' ? 0.95 : 0);
  }

  protected tick(dt: number): void {
    this.shower.setLevelAlpha(this.alpha);
    this.shower.update(dt);
  }
}
