import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

export interface View {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** camera up vector; defaults to +Y */
  up?: THREE.Vector3;
}

/**
 * Camera rig. Flights interpolate in (target, direction, log-distance) space,
 * which keeps motion perceptually uniform across orders of magnitude of scale.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private flight: {
    from: View;
    to: View;
    t: number;
    duration: number;
    ease: (t: number) => number;
    resolve: () => void;
    onProgress?: (t: number) => void;
    /** multiscale transition: must run to completion (frame renormalisation follows) */
    critical: boolean;
  } | null = null;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.01, 5000);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.6;
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** true while a scale transition flight runs — user input must not cancel it */
  get flightCritical(): boolean {
    return this.flight?.critical ?? false;
  }

  setView(v: View): void {
    this.camera.position.copy(v.pos);
    // A direct poster URL and a flight must use the same local vertical.
    this.camera.up.copy(v.up ?? new THREE.Vector3(0, 1, 0)).normalize();
    this.controls.target.copy(v.target);
    this.camera.lookAt(v.target);
    this.controls.update();
  }

  currentView(): View {
    return { pos: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone() };
  }

  flyTo(to: View, duration: number, ease = easeInOutCubic, onProgress?: (t: number) => void, critical = false): Promise<void> {
    this.flight?.resolve();
    return new Promise((resolve) => {
      this.flight = { from: this.currentView(), to: { pos: to.pos.clone(), target: to.target.clone(), up: (to.up ?? new THREE.Vector3(0, 1, 0)).clone() }, t: 0, duration: Math.max(duration, 1e-3), ease, resolve, onProgress, critical };
      this.controls.enabled = false;
    });
  }

  /**
   * Stop a flight where it is. For a critical (scale-transition) flight the
   * caller is responsible for the frame state; finishFlight() should be preferred.
   */
  cancelFlight(): void {
    if (this.flight) {
      const f = this.flight;
      this.flight = null;
      this.controls.enabled = true;
      f.resolve();
    }
  }

  /** Jump a running flight to its end state (used for skips, keeps renormalisation consistent). */
  finishFlight(): void {
    const f = this.flight;
    if (!f) return;
    applyInterpolatedView(this.camera, this.controls.target, f.from, f.to, 1);
    f.onProgress?.(1);
    this.flight = null;
    this.controls.enabled = true;
    f.resolve();
  }

  update(dt: number): void {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = f.ease(f.t);
      applyInterpolatedView(this.camera, this.controls.target, f.from, f.to, e);
      f.onProgress?.(f.t);
      if (f.t >= 1) {
        this.flight = null;
        this.controls.enabled = true;
        f.resolve();
      }
    } else {
      this.controls.update();
    }
    this.updateClipping();
  }

  /** Dynamic near/far keeps depth precision across scales. */
  updateClipping(): void {
    const d = this.camera.position.distanceTo(this.controls.target);
    const near = Math.max(d * 0.004, 1e-7);
    const far = Math.max(d * 4000, 50);
    if (Math.abs(this.camera.near - near) / near > 0.05 || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }
}

const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);

export function applyInterpolatedView(cam: THREE.PerspectiveCamera, target: THREE.Vector3, a: View, b: View, e: number): void {
  const r0 = Math.max(a.pos.distanceTo(a.target), 1e-9);
  const r1 = Math.max(b.pos.distanceTo(b.target), 1e-9);
  _d0.subVectors(a.pos, a.target).divideScalar(r0);
  _d1.subVectors(b.pos, b.target).divideScalar(r1);
  // Target moves with a lead so the subject is framed before the dolly-in completes.
  const et = Math.min(1, e * 1.35);
  target.lerpVectors(a.target, b.target, et);
  _q.setFromUnitVectors(_d0, _d1);
  const dir = _d0.clone().applyQuaternion(new THREE.Quaternion().slerp(_q, e));
  const r = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * e);
  cam.position.copy(target).addScaledVector(dir, r);
  const u0 = a.up ?? _Y;
  const u1 = b.up ?? _Y;
  if (u0.distanceToSquared(u1) > 1e-10) {
    _q.setFromUnitVectors(u0, u1);
    cam.up.copy(u0).applyQuaternion(new THREE.Quaternion().slerp(_q, e)).normalize();
  } else {
    cam.up.copy(u1);
  }
  cam.lookAt(target);
}
