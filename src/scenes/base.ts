import * as THREE from 'three';
import type { LevelId } from '../app/navigation';
import type { AppState, EngMode, Quality, Store } from '../app/state';
import type { View } from '../graphics/camera';
import { ExplodeRig } from '../graphics/explode';
import { applyOpacity, disposeTree } from '../graphics/fade';
import type { LabelLayer } from '../graphics/labels';
import type { FlowPath } from '../graphics/particles';
import type { RadiationShower } from '../graphics/effects';
import type { GraphicsConfig } from '../app/quality';
import { applyLod, applyShadowPolicy, mergeStatic } from '../graphics/optimize';

export interface LevelContext {
  labels: LabelLayer;
  sunDir: THREE.Vector3;
  store: Store;
  quality: Quality;
  select: (id: string | null) => void;
  /** the render camera (for screen-size-aware markers); optional so tests can omit it */
  camera?: THREE.Camera;
}

export interface ComponentDef {
  id: string;
  name: string;
  sub?: string;
  object: THREE.Object3D;
  /** label anchor in object-local coordinates */
  labelLocal?: THREE.Vector3;
  desc: string;
  specs?: string[];
  /** zoom target level */
  child?: LevelId;
  /** id of an RF signal-chain block with detailed info */
  chain?: string;
  label?: boolean;
  /** essential engineering part: its callout outlives contextual ones when space is short */
  essential?: boolean;
}

/** Where a child level lives inside this level (local coordinates). */
export interface Anchor {
  position: THREE.Vector3;
  /** half-extent (in this level's units) that the child's `radius` maps onto */
  size: number;
  quaternion?: THREE.Quaternion;
  /** component that visually contains the child (cross-faded during zoom) */
  focus?: string;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Base class for one scale level. Subclasses build geometry in `build()` and
 * register components; this class provides mode dimming, exploded view,
 * cutaway clipping, zoom-focus fading, labels and disposal.
 */
export abstract class BaseLevel {
  abstract readonly id: LevelId;
  /** half-extent of the level's main object in local units */
  abstract readonly radius: number;
  abstract home: View;
  readonly root = new THREE.Group();
  readonly components: ComponentDef[] = [];
  readonly explode = new ExplodeRig();
  protected flows: Partial<Record<EngMode, FlowPath[]>> = {};
  protected modeFocus: Partial<Record<EngMode, string[]>> = {};
  protected cutawayMats: THREE.Material[] = [];
  protected showers: RadiationShower[] = [];
  /** purely decorative motion (flicker, pulses) — switched off by the degradation ladder */
  protected decorative = true;
  protected cutawayLocal: THREE.Plane | null = null;
  private cutawayWorld = new THREE.Plane();
  private modeDim = new Map<string, { cur: number; target: number }>();
  private focusDim = new Map<string, number>();
  private levelAlpha = 1;
  private opacityDirty = true;
  private guides: THREE.LineSegments | null = null;
  private guideValue = -1;
  mode: EngMode = 'structure';
  /** true when this level is the current, interactive level */
  active = false;
  time = 0;

  constructor(protected ctx: LevelContext) {
    this.root.name = 'level';
  }

  abstract build(): void;

  /** Called each frame while visible. */
  protected tick(_dt: number, _state: AppState): void {}

  /** Optional camera framing for a hero-demo stage (this level's units); null = keep the current view. */
  demoView(_stage: string): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
    return null;
  }

  /** React to parameter changes. */
  onState(_state: AppState, _changed: Set<string>): void {}

  anchorFor(_child: LevelId): Anchor | null {
    return null;
  }

  init(): void {
    this.build();
    this.root.userData.levelId = this.id;
    for (const c of this.components) {
      c.object.userData.componentId = c.id;
      c.object.userData.dim = 1;
      this.modeDim.set(c.id, { cur: 1, target: 1 });
    }
    this.setMode(this.mode);
    for (const list of Object.values(this.flows)) list?.forEach((f) => this.root.add(f.group));
    if (this.explode.objects.length) {
      const mat = new THREE.LineDashedMaterial({ color: '#9fc6ee', dashSize: this.radius * 0.03, gapSize: this.radius * 0.02, transparent: true, opacity: 0, depthWrite: false });
      this.guides = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      this.guides.userData.noFade = true;
      this.guides.frustumCulled = false;
      this.guides.visible = false;
      this.root.add(this.guides);
    }
  }

  /** Dashed assembly guides follow the exploded parts (engineering explode, not decoration). */
  private updateGuides(): void {
    const g = this.guides;
    if (!g) return;
    const v = this.explode.current;
    const op = smooth(0.02, 0.25, v) * 0.55 * this.levelAlpha;
    g.visible = op > 0.01;
    (g.material as THREE.LineDashedMaterial).opacity = op;
    if (!g.visible || Math.abs(v - this.guideValue) < 1e-4) return;
    this.guideValue = v;
    const pts: number[] = [];
    this.explode.guideSegments(this.root, pts);
    g.geometry.dispose();
    g.geometry = new THREE.BufferGeometry();
    g.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeLineDistances();
  }

  protected addComponent(def: ComponentDef): ComponentDef {
    this.components.push(def);
    return def;
  }

  /** One-time GPU-cost reductions after build: merge static siblings, shadow-caster policy. */
  optimize(): { merged: number } {
    const protect = new Set<THREE.Object3D>([...this.explode.objects, ...this.components.map((c) => c.object)]);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material && !Array.isArray(m.material) && (m.material as THREE.ShaderMaterial).isShaderMaterial) protect.add(o);
    });
    const merged = mergeStatic(this.root, protect, new Set(this.cutawayMats));
    applyShadowPolicy(this.root, this.radius);
    this.markOpacityDirty();
    return { merged };
  }

  /** Apply the current graphics tier. Only decoration and repeated micro-geometry react. */
  applyGraphics(g: GraphicsConfig): void {
    for (const list of Object.values(this.flows)) list?.forEach((f) => f.setDensity(g.particles));
    for (const s of this.showers) s.setDensity(g.particles);
    applyLod(this.root, g.modelLod);
    this.decorative = g.cinematicEffects;
  }

  /** Materials whose programs should be pre-compiled in both states (fade / cutaway). */
  get cutawayMaterials(): THREE.Material[] {
    return this.cutawayMats;
  }

  protected addFlow(mode: EngMode, flow: FlowPath): FlowPath {
    // one visual grammar for information: SIGNAL paths carry discrete pulses (packets);
    // power and heat stay continuous streams
    if (mode === 'signal') flow.asPulses();
    (this.flows[mode] ??= []).push(flow);
    return flow;
  }

  registerLabels(onClick: (id: string) => void): void {
    for (const c of this.components) {
      if (c.label === false) continue;
      this.ctx.labels.add({ id: c.id, text: c.name, sub: c.sub, object: c.object, local: c.labelLocal, group: this.id, priority: c.child ? 3 : c.chain || c.essential ? 2 : 1, onClick: () => onClick(c.id) });
    }
  }

  setMode(mode: EngMode): void {
    this.mode = mode;
    const focus = this.modeFocus[mode];
    for (const c of this.components) {
      const d = this.modeDim.get(c.id)!;
      d.target = mode === 'structure' || !focus || focus.includes(c.id) ? 1 : 0.14;
    }
    for (const [m, list] of Object.entries(this.flows)) list?.forEach((f) => f.setActive(m === mode));
    this.ctx.labels.setDimmed(mode === 'structure' || !focus ? null : new Set(focus));
    this.onModeChanged(mode);
  }

  protected onModeChanged(_mode: EngMode): void {}

  /** Zoom-in choreography: context fades, focus component cross-fades into the child. */
  setFocusProgress(focusId: string | undefined, p: number): void {
    const ctxFade = 1 - 0.85 * smooth(0.05, 0.55, p);
    const focusFade = 1 - smooth(0.5, 0.85, p);
    for (const c of this.components) this.focusDim.set(c.id, c.id === focusId ? focusFade : ctxFade);
    this.opacityDirty = true;
  }

  clearFocus(): void {
    this.focusDim.clear();
    this.opacityDirty = true;
  }

  setLevelAlpha(a: number): void {
    if (Math.abs(a - this.levelAlpha) > 1e-4) {
      this.levelAlpha = a;
      this.opacityDirty = true;
    }
    for (const list of Object.values(this.flows)) list?.forEach((f) => f.setLevelAlpha(a));
  }

  get alpha(): number {
    return this.levelAlpha;
  }

  setExplode(t: number, immediate = false): void {
    this.explode.set(t, immediate);
  }

  setCutaway(on: boolean): void {
    for (const m of this.cutawayMats) {
      m.clippingPlanes = on && this.cutawayLocal ? [this.cutawayWorld] : null;
      m.clipShadows = true;
      m.side = on ? THREE.DoubleSide : m.userData.baseSide ?? THREE.FrontSide;
      m.needsUpdate = true;
    }
  }

  protected registerCutaway(mats: THREE.Material[]): void {
    for (const m of mats) {
      m.userData.baseSide = m.side;
      this.cutawayMats.push(m);
    }
  }

  update(dt: number, state: AppState): void {
    this.time += dt;
    this.explode.update(dt);
    for (const c of this.components) {
      const d = this.modeDim.get(c.id)!;
      if (Math.abs(d.cur - d.target) > 1e-3) {
        d.cur += (d.target - d.cur) * Math.min(1, dt * 5);
        this.opacityDirty = true;
      }
      const fd = this.focusDim.get(c.id) ?? 1;
      c.object.userData.dim = d.cur * fd;
    }
    if (this.opacityDirty) {
      applyOpacity(this.root, this.levelAlpha);
      this.opacityDirty = false;
    }
    if (this.cutawayLocal) {
      this.root.updateMatrixWorld();
      this.cutawayWorld.copy(this.cutawayLocal).applyMatrix4(this.root.matrixWorld);
    }
    for (const list of Object.values(this.flows)) list?.forEach((f) => f.update(dt));
    this.updateGuides();
    this.tick(dt, state);
  }

  /** Force a re-application of opacity (after geometry/material changes). */
  protected markOpacityDirty(): void {
    this.opacityDirty = true;
  }

  componentFor(obj: THREE.Object3D | null): ComponentDef | null {
    let cur = obj;
    while (cur && cur !== this.root) {
      const id = cur.userData.componentId as string | undefined;
      if (id) return this.components.find((c) => c.id === id) ?? null;
      cur = cur.parent;
    }
    return null;
  }

  dispose(): void {
    this.ctx.labels.removeGroup(this.id);
    disposeTree(this.root);
    this.root.removeFromParent();
  }
}

export { smooth };
