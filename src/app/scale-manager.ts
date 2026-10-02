import * as THREE from 'three';
import type { BaseLevel, LevelContext } from '../scenes/base';
import { smooth } from '../scenes/base';
import { CameraRig, easeInOutSine, type View } from '../graphics/camera';
import { LEVELS, pathBetween, residentSet, type LevelId } from './navigation';
import type { Store } from './state';

export type LevelCtor = new (ctx: LevelContext) => BaseLevel;
export type LevelLoaders = Record<LevelId, () => Promise<LevelCtor>>;

/** Lazy loaders — each level is its own chunk and only built when needed. */
export const LOADERS: LevelLoaders = {
  cosmos: () => import('../scenes/cosmos').then((m) => m.CosmosLevel),
  satellite: () => import('../scenes/satellite').then((m) => m.SatelliteLevel),
  array: () => import('../scenes/array').then((m) => m.ArrayLevel),
  payload: () => import('../scenes/payload').then((m) => m.PayloadLevel),
  pcb: () => import('../scenes/pcb').then((m) => m.PcbLevel),
  package: () => import('../scenes/package').then((m) => m.PackageLevel),
  die: () => import('../scenes/die').then((m) => m.DieLevel),
  mosfet: () => import('../scenes/mosfet').then((m) => m.MosfetLevel),
  silicon: () => import('../scenes/silicon').then((m) => m.SiliconLevel),
  energy: () => import('../scenes/energy-band').then((m) => m.EnergyBandLevel),
};

export interface TransitionInfo {
  from: LevelId;
  to: LevelId;
  progress: number;
  /** child scale inside the parent frame (for log-interpolating the scale bar) */
  childScale: number;
  dir: 'down' | 'up';
}

/**
 * Multiscale navigation. A zoom from level A into child B:
 *  1. B is placed inside A at A's anchor, scaled so B.radius ↦ anchor.size;
 *  2. the camera flies (log-distance) to B's home view expressed in A's frame
 *     while A's context fades and its focus component cross-fades into B;
 *  3. at arrival the frame is renormalised: B returns to identity and the
 *     camera is transformed by the inverse anchor matrix — the image does not
 *     change, but floating-point precision is restored for the new scale.
 * Zooming out is the exact inverse.
 */
export class ScaleManager {
  private levels = new Map<LevelId, BaseLevel>();
  private pending = new Map<LevelId, Promise<BaseLevel>>();
  current: BaseLevel | null = null;
  transition: TransitionInfo | null = null;
  private busy = false;
  /** latest requested destination — "last intent wins" */
  private intent: LevelId | null = null;
  /** 1 = normal; < 1 shortens transitions (prefers-reduced-motion) */
  motionScale = 1;
  onArrive: (id: LevelId) => void = () => {};
  /** a level failed to load/prepare or a transition threw; state has been recovered */
  onError: (err: unknown, level: LevelId | null) => void = (e) => console.error(e);
  onLevelBuilt: (lvl: BaseLevel) => void = () => {};
  /** optimise + apply graphics + pre-compile shaders before the level is ever shown */
  prepare: (lvl: BaseLevel) => Promise<void> = async () => {};

  private loaders: LevelLoaders;

  constructor(private scene: THREE.Scene, private rig: CameraRig, private ctx: LevelContext, private store: Store, loaders: Partial<LevelLoaders> = {}) {
    this.loaders = { ...LOADERS, ...loaders };
  }

  get currentId(): LevelId | null {
    return this.current?.id ?? null;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async ensure(id: LevelId): Promise<BaseLevel> {
    const have = this.levels.get(id);
    if (have) return have;
    let p = this.pending.get(id);
    if (!p) {
      p = (async () => {
        const C = await this.loaders[id]();
        const lvl = new C(this.ctx);
        try {
          lvl.init();
          lvl.root.visible = false;
          this.scene.add(lvl.root);
          this.onLevelBuilt(lvl);
          await this.prepare(lvl);
        } catch (e) {
          // never leave a half-built level in the scene or the label layer
          try {
            lvl.dispose();
          } catch {
            /* ignore secondary failure */
          }
          throw e;
        }
        this.levels.set(id, lvl);
        return lvl;
      })();
      // success or failure: the next ensure() starts fresh instead of re-awaiting a rejected promise
      const tracked = p.finally(() => {
        if (this.pending.get(id) === tracked) this.pending.delete(id);
      });
      this.pending.set(id, tracked);
      p = tracked;
    }
    return p;
  }

  /** Instantly show a level at its home view (used at start-up and on intro skip). */
  async jumpTo(id: LevelId): Promise<void> {
    this.rig.cancelFlight();
    const lvl = await this.ensure(id);
    for (const l of this.levels.values()) if (l !== lvl) this.hide(l);
    this.resetRoot(lvl);
    lvl.root.visible = true;
    lvl.clearFocus();
    lvl.setLevelAlpha(1);
    this.rig.camera.up.set(0, 1, 0);
    this.rig.setView(lvl.home);
    this.arrive(lvl);
  }

  /**
   * Navigate through the level tree with continuous zoom transitions.
   *
   * Semantics — **last intent wins**: calling goTo() while a transition runs only
   * replaces the destination. A step that has started always completes (so the
   * frame renormalisation is never left half-done); after each step the route is
   * re-planned from the current level to the newest destination.
   * Resolves true when the latest intent was reached.
   */
  async goTo(target: LevelId, stepDuration?: number): Promise<boolean> {
    this.intent = target;
    if (this.busy) return false;
    if (!this.current || this.current.id === target) {
      this.intent = null;
      return !!this.current;
    }
    this.busy = true;
    this.store.set({ transitioning: true, selected: null });
    let failedAt: LevelId | null = null;
    try {
      while (this.current && this.intent && this.intent !== this.current.id) {
        const steps = pathBetween(this.current.id, this.intent);
        const step = steps[0];
        const dur = (stepDuration ?? (steps.length > 1 ? 1.7 : 2.8)) * this.motionScale;
        failedAt = step.to;
        this.stepTo = step.to;
        if (step.dir === 'down') await this.stepDown(step.to, dur);
        else await this.stepUp(step.to, dur);
        failedAt = null;
      }
      return !!this.current && this.current.id === target;
    } catch (e) {
      this.recover();
      this.onError(e, failedAt);
      return false;
    } finally {
      this.intent = null;
      this.stepTo = null;
      this.busy = false;
      this.transition = null;
      this.store.set({ transitioning: false });
    }
  }

  /**
   * Build (and pre-warm) specific levels ahead of a scripted sequence so its first
   * visit does not stall. Only the named levels — never the whole project.
   * A failure is not fatal: the level is retried when actually navigated to.
   */
  async preload(ids: LevelId[]): Promise<void> {
    for (const id of ids) {
      if (this.levels.has(id)) continue;
      try {
        await this.ensure(id);
      } catch (e) {
        console.warn(`preload of ${id} failed`, e);
      }
    }
  }

  /** Destination of the step in flight (null when idle). */
  private stepTo: LevelId | null = null;

  /**
   * Stop a multi-step route after the step in flight (that step still completes,
   * so renormalisation is never left half-done). No-op when idle.
   */
  stop(): void {
    if (this.busy) this.intent = this.stepTo ?? this.current?.id ?? null;
  }

  /** Put the current level back into a clean, interactive state after a failed step. */
  private recover(): void {
    this.rig.cancelFlight();
    const cur = this.current;
    for (const l of this.levels.values()) if (l !== cur) this.hide(l);
    if (!cur) return;
    this.resetRoot(cur);
    cur.root.visible = true;
    cur.clearFocus();
    cur.setLevelAlpha(1);
    cur.active = true;
    this.rig.camera.up.set(0, 1, 0);
    this.rig.setView(cur.home);
    this.ctx.labels.setActiveGroup(cur.id);
  }

  private anchorMatrix(parent: BaseLevel, child: BaseLevel): { m: THREE.Matrix4; q: THREE.Quaternion; s: number; focus?: string } {
    const a = parent.anchorFor(child.id);
    if (!a) throw new Error(`No anchor for ${child.id} in ${parent.id}`);
    const q = a.quaternion ?? new THREE.Quaternion();
    const s = a.size / child.radius;
    const m = new THREE.Matrix4().compose(a.position, q, new THREE.Vector3(s, s, s));
    return { m, q, s, focus: a.focus };
  }

  private async stepDown(toId: LevelId, duration: number): Promise<void> {
    const from = this.current!;
    const to = await this.ensure(toId);
    from.active = false;
    const { m, q, s, focus } = this.anchorMatrix(from, to);
    m.decompose(to.root.position, to.root.quaternion, to.root.scale);
    to.root.visible = true;
    to.clearFocus();
    to.setLevelAlpha(0);
    to.setExplode(0, true);
    to.setMode(this.store.get().mode);
    to.setCutaway(this.store.get().cutaway);
    from.setExplode(0);
    this.ctx.labels.setActiveGroup(null);
    const end: View = {
      pos: to.home.pos.clone().applyMatrix4(m),
      target: to.home.target.clone().applyMatrix4(m),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    };
    this.transition = { from: from.id, to: to.id, progress: 0, childScale: s, dir: 'down' };
    await this.rig.flyTo(end, duration, easeInOutSine, (p) => {
      this.transition!.progress = p;
      from.setFocusProgress(focus, p);
      from.setLevelAlpha(1 - smooth(0.62, 0.97, p));
      to.setLevelAlpha(smooth(0.42, 0.88, p));
    }, true);
    // renormalise frame
    const inv = m.clone().invert();
    this.rig.camera.position.applyMatrix4(inv);
    this.rig.controls.target.applyMatrix4(inv);
    this.rig.camera.up.set(0, 1, 0);
    this.rig.camera.lookAt(this.rig.controls.target);
    this.resetRoot(to);
    to.setLevelAlpha(1);
    this.hide(from);
    this.transition = null;
    this.arrive(to);
  }

  private async stepUp(toId: LevelId, duration: number): Promise<void> {
    const from = this.current!;
    const to = await this.ensure(toId);
    from.active = false;
    this.resetRoot(to);
    to.root.visible = true;
    to.setLevelAlpha(0);
    to.setExplode(0, true);
    to.setMode(this.store.get().mode);
    to.setCutaway(this.store.get().cutaway);
    const { m, q, s, focus } = this.anchorMatrix(to, from);
    to.setFocusProgress(focus, 1);
    m.decompose(from.root.position, from.root.quaternion, from.root.scale);
    this.rig.camera.position.applyMatrix4(m);
    this.rig.controls.target.applyMatrix4(m);
    this.rig.camera.up.set(0, 1, 0).applyQuaternion(q);
    this.rig.camera.lookAt(this.rig.controls.target);
    from.setExplode(0);
    this.ctx.labels.setActiveGroup(null);
    this.transition = { from: from.id, to: to.id, progress: 0, childScale: s, dir: 'up' };
    await this.rig.flyTo({ ...to.home, up: new THREE.Vector3(0, 1, 0) }, duration, easeInOutSine, (p) => {
      this.transition!.progress = p;
      to.setFocusProgress(focus, 1 - p);
      to.setLevelAlpha(smooth(0.03, 0.38, p));
      from.setLevelAlpha(1 - smooth(0.12, 0.5, p));
    }, true);
    to.clearFocus();
    this.hide(from);
    this.resetRoot(from);
    this.transition = null;
    this.arrive(to);
  }

  private resetRoot(l: BaseLevel): void {
    l.root.position.set(0, 0, 0);
    l.root.quaternion.identity();
    l.root.scale.set(1, 1, 1);
    l.root.updateMatrixWorld(true);
  }

  private hide(l: BaseLevel): void {
    l.root.visible = false;
    l.active = false;
  }

  private arrive(lvl: BaseLevel): void {
    this.current = lvl;
    lvl.active = true;
    lvl.clearFocus();
    lvl.setLevelAlpha(1);
    lvl.setMode(this.store.get().mode);
    lvl.setCutaway(this.store.get().cutaway);
    const c = this.rig.controls;
    c.minDistance = lvl.radius * (lvl.id === 'cosmos' ? 1.25 : 0.25);
    c.maxDistance = lvl.radius * (lvl.id === 'cosmos' ? 9 : 6);
    c.update();
    this.ctx.labels.setActiveGroup(lvl.id);
    this.store.set({ level: lvl.id, explode: 0, selected: null });
    this.onArrive(lvl.id);
    // GPU residency: keep only current, parent and children
    const keep = residentSet(lvl.id);
    for (const [id, l] of [...this.levels]) {
      if (!keep.has(id)) {
        l.dispose();
        this.levels.delete(id);
      }
    }
    // stream neighbours one at a time when the main thread is idle (avoids an arrival hitch)
    const todo = [...keep].filter((id) => !this.levels.has(id));
    const next = () => {
      const id = todo.shift();
      if (!id || this.current?.id !== lvl.id) return;
      // a failed preload is not fatal: the level is retried when actually navigated to
      this.ensure(id).then(
        () => idle(next),
        (e) => {
          console.warn(`preload of ${id} failed`, e);
          idle(next);
        },
      );
    };
    idle(next);
  }

  update(dt: number): void {
    const st = this.store.get();
    for (const l of this.levels.values()) if (l.root.visible) l.update(dt, st);
  }

  /** Metres spanned horizontally by the view, log-interpolated during transitions. */
  viewWidthMeters(aspect: number): number {
    const cam = this.rig.camera;
    const d = cam.position.distanceTo(this.rig.controls.target);
    const units = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * aspect;
    const t = this.transition;
    if (!t) return units * LEVELS[this.current?.id ?? 'cosmos'].metersPerUnit;
    // frame is the parent during a down-step (before renormalisation) and the parent after the up-step pre-transform
    const parent = t.dir === 'down' ? t.from : t.to;
    const child = t.dir === 'down' ? t.to : t.from;
    const wParent = units * LEVELS[parent].metersPerUnit;
    const wChild = (units / t.childScale) * LEVELS[child].metersPerUnit;
    const k = t.dir === 'down' ? t.progress : 1 - t.progress;
    return Math.exp(Math.log(wParent) * (1 - k) + Math.log(wChild) * k);
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const lvl = this.current;
    if (!lvl || this.busy) return null;
    const hits = raycaster.intersectObject(lvl.root, true).filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && !isNoFade(h.object));
    for (const h of hits) {
      const c = lvl.componentFor(h.object);
      if (c) return c.id;
    }
    return null;
  }

  levelsBuilt(): BaseLevel[] {
    return [...this.levels.values()];
  }
}

function isNoFade(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (cur.userData.noFade) return true;
    cur = cur.parent;
  }
  return false;
}

function idle(fn: () => void): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 1500 });
  else setTimeout(fn, 250);
}
