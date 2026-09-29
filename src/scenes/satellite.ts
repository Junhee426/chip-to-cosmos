import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { AppState, EngMode } from '../app/state';
import { COLORS, mat } from '../graphics/materials';
import { box, cylinder, group, instancedGrid, tube, v3 } from '../graphics/geometry';
import { FlowPath } from '../graphics/particles';
import { RadiationShower, setHeat } from '../graphics/effects';
import { createEarth } from '../graphics/earth';
import { BaseLevel, type Anchor } from './base';
import { evaluateSystem } from '../models/system-model';
import { systemInput } from '../app/system';

/**
 * LEVEL 1 — generic LEO broadband communication satellite (units: metres).
 * Nadir (−Y) carries the phased arrays, zenith (+Y) the radiator,
 * ±Z the solar-array wings, −X the electric-propulsion thruster.
 * The design is generic and not a replica of any operator's spacecraft.
 */
export class SatelliteLevel extends BaseLevel {
  readonly id = 'satellite' as const;
  readonly radius = 5.5;
  home = { pos: v3(7.4, 2.6, 9.2), target: v3(0, -0.3, 0) };
  private wings: THREE.Group[] = [];
  private payload!: THREE.Group;
  private obc!: THREE.Group;
  private shower!: RadiationShower;
  private earth!: ReturnType<typeof createEarth>;
  private plume!: THREE.Mesh;
  private arrayTile = v3(0.55, -0.66, -0.02);

  build(): void {
    const r = this.root;
    const W = 2.4, H = 1.2, D = 1.4; // bus envelope (m)

    // ---------- Bus structure & shell ----------
    const shellGold = mat.mli('gold');
    const shellSilver = mat.mli('silver');
    const panelMat = mat.aerospace();
    this.registerCutaway([shellGold, shellSilver, panelMat]);
    this.cutawayLocal = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.15);
    const t = 0.035;
    const bus = group(
      box(W, t, D, panelMat, [0, -H / 2, 0]), // nadir deck
      box(t, H, D, shellGold, [W / 2, 0, 0]),
      box(t, H, D, shellGold, [-W / 2, 0, 0]),
      box(W, H, t, shellSilver, [0, 0, D / 2]),
      box(W, H, t, shellSilver, [0, 0, -D / 2]),
    );
    // aluminium frame edges
    const frameMat = mat.aluminum();
    const e = 0.05;
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) bus.add(box(e, H + e, e, frameMat, [(x * W) / 2, 0, (z * D) / 2]));
    for (const y of [1, -1]) for (const z of [1, -1]) bus.add(box(W + e, e, e, frameMat, [0, (y * H) / 2, (z * D) / 2]));
    for (const y of [1, -1]) for (const x of [1, -1]) bus.add(box(e, e, D + e, frameMat, [(x * W) / 2, (y * H) / 2, 0]));
    // internal shear panel & reaction wheels
    const inner = mat.anodized(0x3a3f47);
    bus.add(box(0.03, H - 0.1, D - 0.1, inner, [-0.2, 0, 0]));
    const wheelMat = mat.anodized(0x22262c);
    for (const [x, z, ax] of [[0.05, -0.45, 'x'], [0.05, -0.15, 'y'], [0.25, -0.45, 'z']] as const) bus.add(cylinder(0.11, 0.07, wheelMat, [x, 0.38, z], 32, ax));
    // star trackers with baffles, GNSS patch, TT&C antenna
    for (const x of [-0.8, -0.45]) {
      const st = group(cylinder(0.06, 0.12, mat.anodized(0x16181c), [0, 0.06, 0]), cylinder(0.08, 0.14, mat.darkPanel(), [0, 0.18, 0]));
      st.position.set(x, H / 2, 0.45);
      st.rotation.z = 0.35;
      bus.add(st);
    }
    bus.add(cylinder(0.07, 0.02, mat.ceramic(0xd7d2c4), [0.9, H / 2 + 0.01, 0.5]));
    const helix = tube(Array.from({ length: 40 }, (_, i) => v3(1.0 + 0.05 * Math.cos(i * 0.6), -H / 2 - 0.05 - i * 0.006, -0.5 + 0.05 * Math.sin(i * 0.6))), 0.006, mat.gold());
    bus.add(helix);
    // optical inter-satellite link terminal
    const isl = group(
      cylinder(0.14, 0.12, mat.anodized(0x2b2f36), [0, 0.06, 0]),
      new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat.aluminum()),
      cylinder(0.05, 0.22, mat.darkPanel(), [0.12, 0.2, 0], 24, 'x'),
    );
    isl.children[1].position.y = 0.12;
    isl.position.set(0.7, H / 2, -0.35);
    bus.add(isl);
    r.add(bus);
    this.addComponent({ id: 'bus', name: 'Bus Structure', sub: 'Al honeycomb · MLI', object: bus, labelLocal: v3(W / 2, 0.2, D / 2), desc: 'Primary structure carrying launch loads, wrapped in multi-layer insulation (MLI). Houses avionics, power, propulsion and the payload.', specs: ['Envelope 2.4 × 1.2 × 1.4 m', 'Al honeycomb panels, CFRP frame', 'Gold / silver MLI blankets'] });

    // ---------- Phased arrays (nadir) ----------
    const arrays = new THREE.Group();
    for (const x of [-0.55, 0.55]) {
      const tile = new THREE.Group();
      tile.add(box(1.0, 0.05, 1.2, mat.darkPanel(), [0, 0, 0]));
      tile.add(box(1.04, 0.02, 1.24, mat.aluminum(), [0, 0.03, 0]));
      const patch = new THREE.BoxGeometry(0.022, 0.006, 0.022);
      tile.add(instancedGrid(patch, mat.gold(), 32, 38, 0.03, 0.03, -0.028));
      tile.position.set(x, -H / 2 - 0.06, 0);
      arrays.add(tile);
    }
    r.add(arrays);
    this.addComponent({ id: 'phased-array', name: 'Phased Array', sub: 'Ka-band user beams', object: arrays, labelLocal: v3(0.55, -0.1, 0.6), desc: 'Electronically steered planar arrays forming many narrow user beams. Each element has its own phase shifter and amplifier (see BEAM LAB).', specs: ['2 × 1216 elements (illustrative)', 'Element spacing ≈ λ/2 @ 19.7 GHz', 'Scan ±60°'], child: 'array' });

    // ---------- Radiator (zenith) ----------
    const rad = new THREE.Group();
    rad.add(box(W - 0.1, 0.03, D - 0.1, mat.radiator(), [0, 0, 0]));
    for (let i = -5; i <= 5; i++) rad.add(box(0.012, 0.04, D - 0.14, mat.aluminum(), [i * 0.2, 0.02, 0]));
    rad.position.set(0, H / 2 + 0.02, 0);
    r.add(rad);
    this.addComponent({ id: 'radiator', name: 'Radiator', sub: 'Zenith OSR panel', object: rad, labelLocal: v3(-0.9, 0.05, -0.4), desc: 'Optical solar reflector panel rejecting waste heat to deep space by thermal radiation (σεT⁴). Heat pipes spread load from PA and processor.', specs: ['ε ≈ 0.85, α ≈ 0.1', 'Area sized by Q/(εσT⁴)', 'Embedded heat pipes'] });

    // ---------- Internals ----------
    const payload = group(
      box(0.82, 0.33, 0.36, mat.anodized(0x3b4250), [0, 0, 0], 0.015),
      box(0.83, 0.02, 0.37, mat.aluminum(), [0, 0.165, 0]),
    );
    for (let i = 0; i < 9; i++) payload.add(box(0.01, 0.28, 0.34, mat.anodized(0x5a6272), [-0.328 + i * 0.082, 0, 0.012]));
    for (let i = 0; i < 6; i++) payload.add(cylinder(0.014, 0.04, mat.gold(), [-0.3 + i * 0.12, -0.08, 0.19], 12, 'z'));
    payload.position.set(0.55, -0.4, 0.05);
    this.payload = payload;
    r.add(payload);
    this.addComponent({ id: 'payload', name: 'Payload', sub: 'Regenerative processor', object: payload, labelLocal: v3(0.4, 0.2, 0.28), desc: 'The communication payload: RF front-ends, frequency conversion, ADC/DAC, digital beamformer, modem and on-board processor (OBP).', specs: ['Ka-band user / Ku-band gateway', 'Digital beamforming', 'On-board packet switching'], child: 'payload' });

    const obc = group(box(0.3, 0.2, 0.26, mat.anodized(0x2e3440), [0, 0, 0], 0.01));
    for (let i = 0; i < 5; i++) obc.add(box(0.01, 0.16, 0.2, mat.aluminum(), [-0.12 + i * 0.06, 0, 0]));
    obc.position.set(-0.7, 0.3, 0.2);
    this.obc = obc;
    r.add(obc);
    this.addComponent({ id: 'obc', name: 'OBC', sub: 'On-board computer', object: obc, labelLocal: v3(0, 0.1, 0.13), desc: 'Radiation-tolerant on-board computer running flight software: attitude control, FDIR, command & telemetry, payload scheduling.', specs: ['Rad-tolerant SoC, EDAC memory', 'Watchdog + TMR critical logic', 'CAN / SpaceWire buses'] });

    const pcdu = group(box(0.42, 0.24, 0.3, mat.anodized(0x3a3530), [0, 0, 0], 0.01));
    for (let i = 0; i < 7; i++) pcdu.add(box(0.4, 0.008, 0.02, mat.aluminum(), [0, -0.1 + i * 0.033, 0.155]));
    pcdu.position.set(-0.7, -0.25, 0.25);
    r.add(pcdu);
    this.addComponent({ id: 'pcdu', name: 'PCDU', sub: 'Power conditioning', object: pcdu, labelLocal: v3(0, -0.12, 0.15), desc: 'Power Conditioning & Distribution Unit: regulates the solar-array bus (MPPT), charges the battery and distributes switched, protected power to all loads.', specs: ['100 V regulated bus', 'MPPT solar regulation', 'LCL/FCL protected outputs'] });

    const battery = new THREE.Group();
    battery.add(box(0.5, 0.26, 0.34, mat.anodized(0x262a31), [0, 0, 0], 0.01));
    const cell = new THREE.CylinderGeometry(0.018, 0.018, 0.07, 16);
    const cells = instancedGrid(cell, mat.nickel(), 10, 7, 0.045, 0.045, 0.165);
    battery.add(cells);
    battery.position.set(-0.2, 0.3, -0.35);
    r.add(battery);
    this.addComponent({ id: 'battery', name: 'Battery', sub: 'Li-ion · eclipse power', object: battery, labelLocal: v3(0, 0.15, 0), desc: 'Li-ion battery (18650-class cells in series-parallel strings) supplies the loads during eclipse (~35 % of each LEO orbit).', specs: ['≈ 3 kWh (illustrative)', 'Depth of discharge ≤ 30 %', '> 30 000 cycles over 5 yr'] });

    const prop = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.25, 48, 24), mat.nickel());
    tank.position.set(-0.8, -0.05, -0.3);
    tank.castShadow = true;
    prop.add(tank);
    const thruster = group(
      cylinder(0.11, 0.16, mat.anodized(0x2a2d33), [0, 0, 0], 32, 'x'),
      cylinder(0.085, 0.02, mat.ceramic(0xe8e0d0), [-0.09, 0, 0], 32, 'x'),
      cylinder(0.035, 0.03, mat.aluminum(), [-0.1, 0, 0], 24, 'x'),
    );
    thruster.position.set(-W / 2 - 0.09, -0.15, 0.1);
    prop.add(thruster);
    prop.add(tube([v3(-0.8, -0.2, -0.3), v3(-1.0, -0.25, -0.05), v3(-1.12, -0.15, 0.1)], 0.01, mat.aluminum()));
    const plumeMat = new THREE.MeshBasicMaterial({ color: '#6f8cff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.plume = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 32, 1, true), plumeMat);
    this.plume.rotation.z = Math.PI / 2;
    this.plume.position.set(-W / 2 - 0.65, -0.15, 0.1);
    this.plume.userData.noFade = true;
    prop.add(this.plume);
    r.add(prop);
    this.addComponent({ id: 'propulsion', name: 'Propulsion', sub: 'Hall-effect thruster', object: prop, labelLocal: v3(-W / 2 - 0.15, -0.15, 0.1), desc: 'Electric propulsion (Hall-effect thruster, krypton/xenon) for orbit raising, station-keeping, collision avoidance and de-orbit.', specs: ['Isp ≈ 1500 s', 'Thrust ≈ 50 mN', 'Pressurised propellant tank'] });

    // harness
    const harnessMat = mat.anodized(0x6b5a3a);
    r.add(tube([v3(-0.5, -0.25, 0.25), v3(0, -0.35, 0.3), v3(0.2, -0.3, 0.2)], 0.012, harnessMat));
    r.add(tube([v3(-0.55, 0.3, 0.2), v3(-0.35, 0.35, -0.1), v3(-0.25, 0.3, -0.3)], 0.012, harnessMat));

    // ---------- Solar array wings (±Z) ----------
    const solar = new THREE.Group();
    for (const s of [1, -1]) {
      const wing = new THREE.Group();
      wing.add(cylinder(0.03, 0.7, mat.aluminum(), [0, 0, s * 0.35], 12, 'z'));
      wing.add(cylinder(0.08, 0.1, mat.anodized(0x2a2d33), [0, 0, 0.02 * s], 24, 'z'));
      for (let k = 0; k < 3; k++) {
        const zc = s * (0.7 + 0.73 + k * 1.46);
        const panel = new THREE.Group();
        panel.add(box(2.0, 0.025, 1.4, mat.darkPanel(), [0, -0.014, 0]));
        const cellsMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 1.36), mat.solarCell());
        cellsMesh.rotation.x = -Math.PI / 2;
        cellsMesh.position.y = 0.0;
        cellsMesh.receiveShadow = true;
        panel.add(cellsMesh);
        panel.add(box(2.02, 0.03, 0.02, mat.aluminum(), [0, -0.01, 0.71]));
        panel.add(box(2.02, 0.03, 0.02, mat.aluminum(), [0, -0.01, -0.71]));
        panel.position.set(0, 0, zc);
        wing.add(panel);
      }
      wing.position.set(0, 0.05, (s * D) / 2);
      wing.rotation.z = 0.25;
      this.wings.push(wing);
      solar.add(wing);
    }
    r.add(solar);
    this.addComponent({ id: 'solar', name: 'Solar Array', sub: '2 wings · 16.8 m²', object: solar, labelLocal: v3(0, 0.05, 3.6), desc: 'Two deployable wings of triple-junction GaAs cells (~30 % efficient), rotated by a solar-array drive to track the Sun.', specs: ['6 panels × 2.8 m²', 'η ≈ 30 % (BOL)', 'Orbit-average ≈ 3.5 kW'] });

    // ---------- Earth backdrop (not to scale in distance; correct limb geometry) ----------
    this.earth = createEarth({ radius: 3000, sunDir: this.ctx.sunDir, segments: 192, glow: 0.45 });
    this.earth.group.position.set(0, -3259, 0);
    this.earth.group.rotation.set(0.4, 0, 0.2);
    this.earth.group.userData.noFade = true;
    this.earth.group.userData.backdrop = true;
    r.add(this.earth.group);

    // ---------- Exploded view ----------
    this.explode.add(arrays, v3(0, -1.2, 0), 0.0, 0.55);
    this.explode.add(rad, v3(0, 1.2, 0), 0.05, 0.6);
    this.explode.add(payload, v3(0.4, -0.3, 2.2), 0.2, 0.8);
    this.explode.add(obc, v3(-0.2, 0.7, 2.0), 0.25, 0.85);
    this.explode.add(pcdu, v3(-0.3, -0.5, 2.3), 0.3, 0.9);
    this.explode.add(battery, v3(0, 1.0, 1.4), 0.35, 0.95);
    this.explode.add(prop, v3(-1.2, 0, 0.6), 0.4, 1.0);
    this.explode.add(solar, v3(0, 0, 0), 0, 1);
    this.wings.forEach((w, i) => this.explode.add(w, v3(0, 0, (i === 0 ? 1 : -1) * 1.2), 0.1, 0.7));

    // ---------- Engineering modes ----------
    this.modeFocus = {
      signal: ['phased-array', 'payload', 'obc'],
      power: ['solar', 'pcdu', 'battery', 'payload', 'obc'],
      thermal: ['payload', 'obc', 'radiator', 'pcdu', 'bus'],
      radiation: ['obc', 'payload', 'pcdu', 'bus'],
    };
    // DATA VIEW: Antenna → RF FE → ADC → Modem → Beamformer/OBP → TX
    this.addFlow('signal', new FlowPath([v3(-0.3, -3.5, 0.3), v3(-0.55, -0.7, 0.1), v3(0.25, -0.35, 0.1), v3(0.55, -0.2, 0.05), v3(0.85, -0.3, 0.0), v3(0.6, -0.72, -0.1), v3(1.0, -3.5, -0.3)], { color: COLORS.signal, count: 70, size: 0.05, speed: 0.12, tube: 0.008 }));
    this.addFlow('signal', new FlowPath([v3(0.55, -0.1, 0), v3(0.7, 0.4, -0.3), v3(0.75, 0.75, -0.35), v3(3.5, 1.2, -0.6)], { color: '#9fd7ff', count: 25, size: 0.04, speed: 0.15, tube: 0.005 }));
    // POWER VIEW: Solar → PCDU → Battery → Loads
    for (const s of [1, -1]) this.addFlow('power', new FlowPath([v3(0, 0.05, s * 3.6), v3(0, 0.05, s * 1.0), v3(-0.5, -0.1, s * 0.4), v3(-0.7, -0.25, 0.25)], { color: COLORS.power, count: 30, size: 0.05, speed: 0.2, tube: 0.008 }));
    this.addFlow('power', new FlowPath([v3(-0.7, -0.25, 0.25), v3(-0.45, 0.1, -0.1), v3(-0.2, 0.3, -0.35)], { color: COLORS.power, count: 14, size: 0.045, speed: 0.25, tube: 0.006 }));
    this.addFlow('power', new FlowPath([v3(-0.7, -0.25, 0.25), v3(-0.1, -0.4, 0.3), v3(0.55, -0.23, 0.1)], { color: COLORS.power, count: 18, size: 0.045, speed: 0.25, tube: 0.006 }));
    this.addFlow('power', new FlowPath([v3(-0.7, -0.25, 0.25), v3(-0.75, 0.05, 0.25), v3(-0.7, 0.3, 0.2)], { color: COLORS.power, count: 10, size: 0.045, speed: 0.25, tube: 0.006 }));
    // THERMAL VIEW: PA/processor → structure → radiator → space
    this.addFlow('thermal', new FlowPath([v3(0.55, -0.1, 0), v3(0.6, 0.3, 0), v3(0.2, 0.58, 0), v3(-0.6, 0.62, 0)], { color: COLORS.thermal, count: 30, size: 0.05, speed: 0.18, tube: 0.008 }));
    this.addFlow('thermal', new FlowPath([v3(-0.7, 0.3, 0.2), v3(-0.7, 0.58, 0.1), v3(0.3, 0.62, -0.2)], { color: COLORS.thermal, count: 16, size: 0.045, speed: 0.18, tube: 0.006 }));
    for (let i = 0; i < 5; i++) this.addFlow('thermal', new FlowPath([v3(-0.9 + i * 0.45, 0.65, -0.3 + (i % 2) * 0.5), v3(-0.9 + i * 0.45, 2.4, -0.3 + (i % 2) * 0.5)], { color: '#ff9a6a', count: 8, size: 0.06, speed: 0.35 }));

    this.shower = new RadiationShower([v3(0.55, -0.23, 0), v3(-0.7, 0.3, 0.2), v3(-0.7, -0.25, 0.25)], 4, 16, COLORS.radiation, 0.06);
    r.add(this.shower.group);
  }

  anchorFor(child: LevelId): Anchor | null {
    if (child === 'payload') return { position: this.payload.position.clone(), size: 0.4, focus: 'payload' };
    if (child === 'array') {
      // one sub-array tile of the nadir panel; the beam lab radiates along +Y, so flip.
      return { position: this.arrayTile.clone(), size: 0.06, quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), focus: 'phased-array' };
    }
    return null;
  }

  protected onModeChanged(mode: EngMode): void {
    this.shower?.setActive(mode === 'radiation');
    this.applyHeat();
  }

  onState(state: AppState, changed: Set<string>): void {
    if (changed.has('params') || changed.has('mode')) this.applyHeat(state);
  }

  private applyHeat(state = this.ctx.store.get()): void {
    if (!this.payload) return;
    if (this.mode !== 'thermal') {
      setHeat(this.payload, 0);
      setHeat(this.obc, 0);
      return;
    }
    const sys = evaluateSystem(systemInput(state.params));
    setHeat(this.payload, Math.min(1, sys.payloadDcW / 2500));
    setHeat(this.obc, 0.35);
  }

  protected tick(dt: number): void {
    this.earth.update(this.time);
    const ea = THREE.MathUtils.smoothstep(this.alpha, 0.85, 1);
    this.earth.setOpacity(ea);
    this.earth.group.visible = ea > 0.01;
    this.shower.setLevelAlpha(this.alpha);
    this.shower.update(dt);
    const sunTrack = 0.25 + Math.sin(this.time * 0.05) * 0.08;
    for (const w of this.wings) w.rotation.z = sunTrack;
    (this.plume.material as THREE.MeshBasicMaterial).opacity = (this.mode === 'power' || this.mode === 'structure' ? 0.3 : 0.08) * (0.85 + 0.15 * Math.sin(this.time * 30)) * this.alpha;
  }
}
