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

  /**
   * Assembly guides: for each part, its assembled position and current position
   * expressed in `root` space. Drawn as dashed lines so the explode reads as
   * "this came out of there", not as floating parts.
   */
  guideSegments(root: THREE.Object3D, out: number[]): number {
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let n = 0;
    for (const p of this.parts) {
      if (!p.obj.parent || p.offset.lengthSq() < 1e-8) continue;
      p.obj.parent.updateWorldMatrix(true, false);
      a.copy(p.base).applyMatrix4(p.obj.parent.matrixWorld).applyMatrix4(inv);
      b.copy(p.obj.position).applyMatrix4(p.obj.parent.matrixWorld).applyMatrix4(inv);
      if (a.distanceToSquared(b) < 1e-8) continue;
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
      n++;
    }
    return n;
  }

  get objects(): THREE.Object3D[] {
    return this.parts.map((p) => p.obj);
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
