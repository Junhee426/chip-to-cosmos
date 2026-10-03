import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ScaleManager, type LevelCtor, type LevelLoaders } from '../src/app/scale-manager';
import { LEVELS, type LevelId } from '../src/app/navigation';
import { createStore } from '../src/app/state';
import { BaseLevel, type Anchor, type LevelContext } from '../src/scenes/base';
import type { CameraRig } from '../src/graphics/camera';
import type { LabelLayer } from '../src/graphics/labels';

/** Minimal level: real BaseLevel lifecycle, no geometry. */
function fakeLevel(id: LevelId, built: string[], disposed: string[]): LevelCtor {
  return class extends BaseLevel {
    readonly id = id;
    readonly radius = 1;
    home = { pos: new THREE.Vector3(0, 0, 5), target: new THREE.Vector3() };
    build(): void {
      built.push(id);
      this.addComponent({ id: `${id}-part`, name: id, object: new THREE.Group(), desc: '' });
    }
    anchorFor(): Anchor {
      return { position: new THREE.Vector3(), size: 0.1 };
    }
    dispose(): void {
      disposed.push(id);
      super.dispose();
    }
  };
}

function setup(overrides: Partial<Record<LevelId, () => Promise<LevelCtor>>> = {}) {
  const built: string[] = [];
  const disposed: string[] = [];
  const durations: number[] = [];
  const loaders = Object.fromEntries((Object.keys(LEVELS) as LevelId[]).map((id) => [id, overrides[id] ?? (async () => fakeLevel(id, built, disposed))])) as LevelLoaders;
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(), minDistance: 0, maxDistance: 1e9, update() {} };
  const rig = {
    camera,
    controls,
    flying: false,
    flightCritical: false,
    async flyTo(v: { pos: THREE.Vector3; target: THREE.Vector3 }, d: number, _e?: unknown, onProgress?: (t: number) => void) {
      durations.push(d);
      await Promise.resolve();
      onProgress?.(0.5);
      onProgress?.(1);
      camera.position.copy(v.pos);
      controls.target.copy(v.target);
    },
    cancelFlight() {},
    finishFlight() {},
    setView(v: { pos: THREE.Vector3; target: THREE.Vector3 }) {
      camera.position.copy(v.pos);
      controls.target.copy(v.target);
    },
  } as unknown as CameraRig;
  const labels = { add() {}, removeGroup() {}, setActiveGroup() {}, setDimmed() {}, highlight() {} } as unknown as LabelLayer;
  const store = createStore();
  const ctx: LevelContext = { labels, sunDir: new THREE.Vector3(0, 1, 0), store, quality: 'balanced', select: () => {} };
  const mgr = new ScaleManager(new THREE.Scene(), rig, ctx, store, loaders);
  mgr.onError = () => {};
  return { mgr, store, built, disposed, durations };
}

describe('ScaleManager navigation', () => {
  it('keeps the prewarmed Quick Demo route resident and releases it afterwards', async () => {
    const { mgr, built, disposed } = setup();
    await mgr.jumpTo('satellite');
    const release = mgr.retainLevels(['satellite', 'array', 'cosmos']);
    await mgr.preload(['satellite', 'array', 'cosmos']);
    await mgr.goTo('array');
    expect(disposed).not.toContain('cosmos');
    await mgr.goTo('cosmos');
    expect(built.filter((id) => id === 'cosmos')).toHaveLength(1);
    expect(disposed).not.toContain('array');
    release();
    release(); // cancelling/finishing twice must not leak or double-dispose
    expect(disposed.filter((id) => id === 'array')).toHaveLength(1);
    expect(mgr.levelsBuilt().map((l) => l.id)).not.toContain('array');
  });

  it('walks the tree step by step and renormalises at the destination', async () => {
    const { mgr, store } = setup();
    await mgr.jumpTo('satellite');
    expect(await mgr.goTo('die')).toBe(true);
    expect(mgr.currentId).toBe('die');
    expect(store.get().level).toBe('die');
    expect(mgr.current!.root.scale.x).toBe(1);
    expect(mgr.current!.root.position.length()).toBe(0);
    expect(store.get().transitioning).toBe(false);
    expect(mgr.isBusy).toBe(false);
  });

  it('rapid navigation: the last intent wins and earlier requests are dropped', async () => {
    const { mgr } = setup();
    await mgr.jumpTo('satellite');
    const first = mgr.goTo('die');
    void mgr.goTo('cosmos');
    void mgr.goTo('pcb');
    expect(await first).toBe(false); // superseded
    expect(mgr.currentId).toBe('pcb');
    expect(mgr.isBusy).toBe(false);
  });

  it('a later intent equal to where we already are stops the walk there', async () => {
    const { mgr } = setup();
    await mgr.jumpTo('satellite');
    const p = mgr.goTo('mosfet');
    void mgr.goTo('payload');
    await p;
    expect(mgr.currentId).toBe('payload');
  });

  it('stop() ends a multi-step route after the step in flight (demo skip)', async () => {
    const { mgr } = setup();
    await mgr.jumpTo('array');
    const p = mgr.goTo('cosmos'); // array → satellite → cosmos
    mgr.stop();
    expect(await p).toBe(false);
    expect(mgr.currentId).toBe('satellite');
    expect(mgr.isBusy).toBe(false);
    mgr.stop(); // idle: no-op
    expect(await mgr.goTo('cosmos')).toBe(true);
  });

  it('loader failure: state recovers, pending is cleared, and a retry works', async () => {
    let fail = true;
    const { mgr, store, built, disposed } = setup({
      payload: async () => {
        if (fail) throw new Error('chunk load failed');
        return fakeLevel('payload', [], []);
      },
    });
    const onError = vi.fn();
    mgr.onError = onError;
    await mgr.jumpTo('satellite');
    expect(await mgr.goTo('payload')).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe('payload');
    expect(mgr.currentId).toBe('satellite');
    expect(mgr.isBusy).toBe(false);
    expect(store.get().transitioning).toBe(false);
    expect(mgr.current!.root.visible).toBe(true);
    expect(mgr.current!.alpha).toBe(1);
    fail = false;
    expect(await mgr.goTo('payload')).toBe(true);
    expect(mgr.currentId).toBe('payload');
    void built;
    void disposed;
  });

  it('prepare() failure disposes the half-built level and does not wedge navigation', async () => {
    const { mgr, disposed } = setup();
    await mgr.jumpTo('satellite');
    mgr.prepare = async (lvl) => {
      if (lvl.id === 'payload') throw new Error('shader compile failed');
    };
    expect(await mgr.goTo('payload')).toBe(false);
    expect(disposed).toContain('payload');
    expect(mgr.isBusy).toBe(false);
    mgr.prepare = async () => {};
    expect(await mgr.goTo('payload')).toBe(true);
  });

  it('reduced motion shortens transitions but keeps them', async () => {
    const a = setup();
    await a.mgr.jumpTo('satellite');
    await a.mgr.goTo('payload');
    const b = setup();
    b.mgr.motionScale = 0.35;
    await b.mgr.jumpTo('satellite');
    await b.mgr.goTo('payload');
    expect(b.durations[0]).toBeGreaterThan(0);
    expect(b.durations[0]).toBeCloseTo(a.durations[0] * 0.35, 9);
  });

  it('keeps only the resident set built after arrival', async () => {
    const { mgr, disposed } = setup();
    await mgr.jumpTo('satellite');
    await mgr.goTo('die');
    const resident = new Set(mgr.levelsBuilt().map((l) => l.id));
    for (const id of resident) expect(['die', 'package', 'mosfet']).toContain(id);
    expect(disposed).toContain('satellite');
  });
});
