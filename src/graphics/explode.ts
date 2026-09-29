import * as THREE from 'three';
import { easeInOutCubic } from './camera';

interface Part {
  obj: THREE.Object3D;
  base: THREE.Vector3;
  offset: THREE.Vector3;
  start: number;
  end: number;
}

/**
 * Exploded-view controller. Each part moves along its own offset vector;
 * parts are staggered (start/end fractions) so the assembly separates
 * sequentially, like an engineering animation.
 */
export class ExplodeRig {
  private parts: Part[] = [];
  private value = 0;
  private target = 0;

  add(obj: THREE.Object3D, offset: THREE.Vector3, start = 0, end = 1): void {
    this.parts.push({ obj, base: obj.position.clone(), offset: offset.clone(), start, end });
  }

  set(t: number, immediate = false): void {
    this.target = THREE.MathUtils.clamp(t, 0, 1);
    if (immediate) {
      this.value = this.target;
      this.apply();
    }
  }

  get current(): number {
    return this.value;
  }

  update(dt: number): void {
    if (Math.abs(this.value - this.target) < 1e-4) return;
    this.value += (this.target - this.value) * Math.min(1, dt * 6);
    this.apply();
  }

  private apply(): void {
    for (const p of this.parts) {
      const local = THREE.MathUtils.clamp((this.value - p.start) / Math.max(p.end - p.start, 1e-3), 0, 1);
      p.obj.position.copy(p.base).addScaledVector(p.offset, easeInOutCubic(local));
    }
  }
}
