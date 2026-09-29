import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { AppState, EngMode } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, instancedGrid, v3 } from '../graphics/geometry';
import { FlowPath } from '../graphics/particles';
import { RadiationShower, setHeat } from '../graphics/effects';
import { dieTexture, sramTexture } from '../graphics/textures';
import { evaluateSystem } from '../models/system-model';
import { systemInput } from '../app/system';
import { BaseLevel, type Anchor } from './base';

interface Block {
  id: string;
  name: string;
  sub: string;
  x0: number; x1: number; z0: number; z1: number;
  h: number;
  tint: number;
  sram?: boolean;
  desc: string;
  specs: string[];
}

const BLOCKS: Block[] = [
  { id: 'rf', name: 'RF Transceivers', sub: '4 channels', x0: -6.4, x1: -3.6, z0: -6.4, z1: 6.4, h: 0.06, tint: 0xc0a080, desc: 'Analog/RF: LNAs, mixers, filters and VGAs. Needs quiet supplies and guard rings.', specs: ['SiGe-like analog devices', 'Deep-N-well isolation'] },
  { id: 'adc', name: 'ADC Array', sub: 'Pipelined / SAR', x0: -3.4, x1: -1.0, z0: -6.4, z1: -0.2, h: 0.07, tint: 0xa9b8a0, desc: 'Time-interleaved ADCs converting IF to digital. Power grows with 2^ENOB × fs (Walden FOM).', specs: ['8–12 bit', 'fs ≈ 1 GS/s per channel'] },
  { id: 'dac', name: 'DAC Array', sub: 'Current-steering', x0: -3.4, x1: -1.0, z0: 0.2, z1: 6.4, h: 0.07, tint: 0xa0aab8, desc: 'Transmit DACs generating the per-element waveforms for the beamformer.', specs: ['14 bit', 'Current-steering'] },
  { id: 'dsp', name: 'DSP Cores', sub: 'Channeliser / FFT', x0: -0.8, x1: 3.6, z0: -6.4, z1: -0.2, h: 0.09, tint: 0x8fb6c4, desc: 'Vector DSP cores performing digital down-conversion, channelisation and filtering. Dynamic power ∝ C·V²·f·activity.', specs: ['4 × vector cores', 'Local SRAM'] },
  { id: 'bf', name: 'Beamformer Engine', sub: 'Complex weights', x0: -0.8, x1: 3.6, z0: 0.2, z1: 3.6, h: 0.1, tint: 0x9fc4d0, desc: 'Multiplies every element stream by a complex weight wₙ·e^{jφₙ} and sums them to form many simultaneous beams.', specs: ['16-bit complex MACs', '> 1 TMAC/s'] },
  { id: 'sram', name: 'SRAM (L2)', sub: 'On-chip memory', x0: -0.8, x1: 3.6, z0: 3.8, z1: 6.4, h: 0.08, tint: 0x7fa0c0, sram: true, desc: 'Dense 6-transistor SRAM arrays. The most radiation-sensitive area (single-event upsets) → protected with ECC and scrubbing.', specs: ['6T bit-cells', 'SECDED ECC'] },
  { id: 'serdes', name: 'SerDes', sub: '25 Gb/s lanes', x0: 3.8, x1: 6.4, z0: -6.4, z1: -3.4, h: 0.07, tint: 0xb0a0c0, desc: 'High-speed serial transceivers to the backplane.', specs: ['NRZ/PAM4', 'CDR + equaliser'] },
  { id: 'cpu', name: 'Control CPU', sub: 'Lock-step cores', x0: 3.8, x1: 6.4, z0: -3.2, z1: -0.2, h: 0.08, tint: 0x9cb0bc, desc: 'Lock-step control processors for configuration and fault management.', specs: ['Dual-core lock-step', 'TMR registers'] },
  { id: 'pmu', name: 'PMU / LDO', sub: 'On-die regulation', x0: 3.8, x1: 6.4, z0: 0.2, z1: 2.6, h: 0.06, tint: 0xc8b070, desc: 'Power management: LDOs, power gating, voltage/temperature sensors.', specs: ['Per-domain LDOs', 'On-die temp sensors'] },
  { id: 'pll', name: 'PLL / Clock', sub: 'LO synthesis', x0: 3.8, x1: 6.4, z0: 2.8, z1: 4.4, h: 0.06, tint: 0xc0a0a0, desc: 'Phase-locked loops generating sampling clocks and LO references; jitter limits ADC SNR.', specs: ['Jitter < 50 fs rms', 'LC-VCO'] },
];

/**
 * LEVEL 5 — silicon die floorplan (units: mm). Shown active-side up
 * (in the package the die is mounted face-down).
 */
export class DieLevel extends BaseLevel {
  readonly id = 'die' as const;
  readonly radius = 7;
  home = { pos: v3(12, 13.5, 16.5), target: v3(0, -0.3, 0) };
  private blocks = new Map<string, THREE.Group>();
  private shower!: RadiationShower;
  private readonly mosfetSite = v3(-2.2, 0.075, -4.9);

  build(): void {
    const r = this.root;
    const slab = new THREE.Group();
    slab.add(box(14, 0.75, 14, mat.silicon(), [0, -0.375, 0]));
    const top = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), mat.die(dieTexture()));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    top.receiveShadow = true;
    slab.add(top);
    // bump pads (face side)
    slab.add(instancedGrid(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), mat.nickel(), 44, 44, 0.3, 0.3, 0.01, (i, j) => i < 2 || j < 2 || i > 41 || j > 41));
    r.add(slab);
    this.addComponent({ id: 'substrate', name: 'Silicon Substrate', sub: '775 µm bulk Si', object: slab, labelLocal: v3(-7, -0.4, 7), desc: 'Bulk p-type silicon wafer piece; transistors are built in the top micrometre, interconnect (BEOL) above it.', specs: ['14 × 14 mm', 'p-type, ~10 Ω·cm'] });

    for (const b of BLOCKS) {
      const g = new THREE.Group();
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const m = mat.die(b.sram ? sramTexture() : dieTexture());
      m.color.set(b.tint);
      if (b.sram && m.map) {
        m.map = m.map.clone();
        m.map.repeat.set(w / 2, d / 2);
        m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
        m.map.needsUpdate = true;
        m.map.userData.shared = false;
      }
      g.add(box(w, b.h, d, m, [0, b.h / 2, 0]));
      g.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      r.add(g);
      this.blocks.set(b.id, g);
      this.addComponent({ id: b.id, name: b.name, sub: b.sub, object: g, labelLocal: v3(0, b.h, 0), desc: b.desc, specs: b.specs, child: b.id === 'adc' ? 'mosfet' : undefined });
      this.explode.add(g, v3(g.position.x * 0.12, 0.6 + b.h * 6, g.position.z * 0.12), 0.1, 0.8);
    }

    // DSP sub-cores & SRAM tiles inside the DSP block
    const dsp = this.blocks.get('dsp')!;
    for (const [x, z] of [[-1.1, -1.55], [1.1, -1.55], [-1.1, 1.55], [1.1, 1.55]]) {
      const sm = mat.die(sramTexture());
      dsp.add(box(1.4, 0.03, 0.8, sm, [x, 0.105, z]));
    }

    // BEOL metal stack exhibit at the die corner (vertical scale exaggerated)
    const beol = new THREE.Group();
    const layers = 8;
    for (let l = 0; l < layers; l++) {
      const wLine = 0.05 + l * 0.02;
      const pitch = 0.12 + l * 0.05;
      const n = Math.floor(1.8 / pitch);
      const geo = new THREE.BoxGeometry(l % 2 ? 1.8 : wLine, 0.04, l % 2 ? wLine : 1.8);
      const inst = new THREE.InstancedMesh(geo, mat.copper(), n);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < n; k++) {
        const o = -0.9 + (k + 0.5) * pitch;
        m4.makeTranslation(l % 2 ? 0 : o, 0.2 + l * 0.12, l % 2 ? o : 0);
        inst.setMatrixAt(k, m4);
      }
      beol.add(inst);
    }
    beol.add(box(1.9, 1.15, 1.9, mat.glass(0x9fc5d8, 0.12), [0, 0.65, 0]));
    beol.position.set(5.1, 0, 5.4);
    r.add(beol);
    this.addComponent({ id: 'beol', name: 'BEOL Metal Stack', sub: 'M1–M8 · exaggerated', object: beol, labelLocal: v3(0, 1.2, 0.9), desc: 'Back-end-of-line interconnect: alternating-direction copper layers in low-k dielectric, widening towards the top global/power layers.', specs: ['8 metal layers shown (real: 12–16)', 'Vertical scale ×200'] });
    this.explode.add(beol, v3(0.8, 1.4, 0.8), 0.2, 0.9);

    // Transistor array hint around the MOSFET site (visible when zooming in)
    const gates = instancedGrid(new THREE.BoxGeometry(0.004, 0.003, 0.03), mat.nickel(), 24, 6, 0.012, 0.045, 0);
    gates.position.copy(this.mosfetSite).add(v3(0, 0.002, 0));
    gates.castShadow = false;
    r.add(gates);

    // modes
    this.modeFocus = {
      signal: ['rf', 'adc', 'dsp', 'bf', 'serdes', 'pll'],
      power: ['pmu', 'rf', 'adc', 'dac', 'dsp', 'bf', 'cpu', 'serdes'],
      thermal: BLOCKS.map((b) => b.id),
      radiation: ['sram', 'cpu', 'dsp'],
    };
    const c = (id: string, y = 0.25) => {
      const b = BLOCKS.find((k) => k.id === id)!;
      return v3((b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2);
    };
    this.addFlow('signal', new FlowPath([c('rf').add(v3(0, 0, -3)), c('adc'), c('dsp'), c('bf'), c('dsp').add(v3(2.5, 0, 0)), c('serdes')], { color: COLORS.signal, count: 60, size: 0.12, speed: 0.12, tube: 0.02 }));
    this.addFlow('signal', new FlowPath([c('pll'), c('dac').add(v3(3, 0.1, 0)), c('adc').add(v3(0, 0.1, 2))], { color: '#9fd7ff', count: 20, size: 0.1, speed: 0.2, tube: 0.012 }));
    for (const id of ['rf', 'adc', 'dsp', 'bf', 'cpu', 'serdes', 'dac']) this.addFlow('power', new FlowPath([c('pmu'), c('pmu').add(v3(-1.8, 0.1, 0)), c(id)], { color: COLORS.power, count: 10, size: 0.1, speed: 0.35, tube: 0.012 }));
    for (const id of ['dsp', 'bf', 'adc']) this.addFlow('thermal', new FlowPath([c(id, 0.2), c(id, 3)], { color: COLORS.thermal, count: 10, size: 0.16, speed: 0.35 }));
    this.shower = new RadiationShower([c('sram', 0.1), c('cpu', 0.1), c('dsp', 0.12)], 6, 10, COLORS.radiation, 0.1);
    r.add(this.shower.group);
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child !== 'mosfet') return null;
    return { position: this.mosfetSite.clone(), size: 0.0006, focus: 'adc' };
  }

  onState(state: AppState, changed: Set<string>): void {
    if (changed.has('params') && this.mode === 'thermal') this.applyHeat(state);
  }

  protected onModeChanged(mode: EngMode): void {
    this.shower?.setActive(mode === 'radiation');
    this.applyHeat(this.ctx.store.get());
  }

  /** Thermal map from the cross-scale model: ADC & DSP power density track ADC bits and fs. */
  private applyHeat(state: AppState): void {
    if (!this.blocks.size) return;
    if (this.mode !== 'thermal') {
      for (const g of this.blocks.values()) setHeat(g, 0);
      return;
    }
    const sys = evaluateSystem(systemInput(state.params));
    const area = (id: string) => {
      const b = BLOCKS.find((k) => k.id === id)!;
      return (b.x1 - b.x0) * (b.z1 - b.z0);
    };
    const density: Record<string, number> = {
      adc: sys.adcPowerW / 32 / area('adc'),
      dsp: sys.dspPowerW / 32 / area('dsp'),
      bf: (sys.dspPowerW / 32) * 0.8 / area('bf'),
      rf: 1.2 / area('rf'),
      serdes: 1.5 / area('serdes'),
      cpu: 0.8 / area('cpu'),
      pmu: 0.6 / area('pmu'),
      pll: 0.3 / area('pll'),
      dac: 1.0 / area('dac'),
      sram: 0.5 / area('sram'),
    };
    const max = Math.max(...Object.values(density));
    for (const [id, g] of this.blocks) setHeat(g, Math.max(0.05, density[id] / max));
  }

  protected tick(dt: number): void {
    this.shower.setLevelAlpha(this.alpha);
    this.shower.update(dt);
  }
}
