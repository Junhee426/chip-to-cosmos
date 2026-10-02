import * as THREE from 'three';

export interface FrameTick {
  /** clamped step for simulation/animation (s) */
  dt: number;
  /** unclamped wall time since the previous frame (s), 0 on the first frame */
  raw: number;
  elapsed: number;
}

/** requestAnimationFrame driver; one ordered list of per-frame steps. */
export class RenderLoop {
  private timer = new THREE.Timer();
  private running = false;

  constructor(private step: (t: FrameTick) => void) {
    this.timer.connect(document);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = (ts?: number) => {
      if (!this.running) return;
      this.timer.update(ts);
      const raw = Math.max(this.timer.getDelta(), 0);
      this.step({ dt: Math.min(raw, 0.1), raw, elapsed: this.timer.getElapsed() });
      requestAnimationFrame(frame);
    };
    frame();
  }

  stop(): void {
    this.running = false;
  }
}
