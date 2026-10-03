import * as THREE from 'three';
import type { CameraRig } from '../graphics/camera';
import type { LabelLayer, Insets } from '../graphics/labels';

export interface ViewportHost {
  /** free 3D area not covered by chrome (px from each edge) */
  insets(): Insets;
  /** overlay boxes inside the safe area (e.g. the enlarged footprint inset) */
  exclusions?(): Insets[];
  readonly isMobile: boolean;
}

/** Mobile shows only the most important callouts. */
export const MOBILE_MAX_LABELS = 4;

/**
 * Safe viewport: the camera's principal point and the callout columns follow the
 * area not covered by the nav, panels or bottom sheet. The shift is eased so
 * expanding/collapsing the sheet never makes the camera jump.
 */
export class ViewportController {
  private view = { x: 0, y: 0, tx: 0, ty: 0 };
  private host: ViewportHost | null = null;
  onResize: () => void = () => {};

  constructor(private rig: CameraRig, private labels: LabelLayer, private setSize: (w: number, h: number) => void) {
    addEventListener('resize', () => this.resize());
    // mobile browser toolbars change the visual viewport without always firing window resize
    window.visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
  }

  attach(host: ViewportHost): void {
    this.host = host;
    this.layout();
  }

  /** Recompute insets → callout columns + target principal point. */
  layout(): void {
    if (!this.host) return;
    const ins = this.host.insets();
    this.labels.insets = ins;
    this.labels.exclusions = this.host.exclusions?.() ?? [];
    this.labels.maxLabels = this.host.isMobile ? MOBILE_MAX_LABELS : Infinity;
    const W = innerWidth;
    const H = innerHeight;
    this.view.tx = (ins.left + W - ins.right) / 2 - W / 2;
    this.view.ty = (ins.top + H - ins.bottom) / 2 - H / 2;
  }

  resize(): void {
    this.setSize(innerWidth, innerHeight);
    this.rig.camera.aspect = innerWidth / innerHeight;
    this.layout();
    this.view.x = this.view.tx;
    this.view.y = this.view.ty;
    this.apply();
    this.onResize();
  }

  tick(dt: number): void {
    const v = this.view;
    if (Math.abs(v.x - v.tx) > 0.3 || Math.abs(v.y - v.ty) > 0.3) {
      v.x += (v.tx - v.x) * Math.min(1, dt * 8);
      v.y += (v.ty - v.y) * Math.min(1, dt * 8);
      this.apply();
    }
  }

  private apply(): void {
    this.rig.camera.setViewOffset(innerWidth, innerHeight, -this.view.x, -this.view.y, innerWidth, innerHeight);
  }

  /** Is a world point inside the free area (not behind the sheet / panels)? */
  isVisible(p: THREE.Vector3): boolean {
    const v = p.clone().project(this.rig.camera);
    if (v.z >= 1 || v.z <= -1) return false;
    const sx = (v.x * 0.5 + 0.5) * innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * innerHeight;
    const ins = this.labels.insets;
    return sx > ins.left && sx < innerWidth - ins.right && sy > ins.top && sy < innerHeight - ins.bottom;
  }

  /** Re-centre on an object that projects outside the free area. Non-critical flight: user input cancels it. */
  keepInView(object: THREE.Object3D, durationScale = 1): void {
    if (this.rig.flying) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    if (this.isVisible(center)) return;
    const shift = center.clone().sub(this.rig.controls.target);
    void this.rig.flyTo({ pos: this.rig.camera.position.clone().add(shift), target: center }, 0.7 * durationScale);
  }
}
