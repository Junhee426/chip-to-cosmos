/** Frame-time statistics for pacing, long frames and hitch detection. */
export const FRAME_60 = 1000 / 60; // ≈ 16.67 ms
export const FRAME_30 = 1000 / 30; // ≈ 33.33 ms

export class FrameStats {
  private buf: Float64Array;
  private n = 0;
  private i = 0;
  longFrames = 0; // > 2× the 30 FPS budget (≈ 66.7 ms): visible hitch
  maxMs = 0;

  constructor(capacity = 600) {
    this.buf = new Float64Array(capacity);
  }

  push(ms: number): void {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    this.n = Math.min(this.n + 1, this.buf.length);
    if (ms > 2 * FRAME_30) this.longFrames++;
    if (ms > this.maxMs) this.maxMs = ms;
  }

  values(): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.n; k++) out.push(this.buf[(this.i - this.n + k + this.buf.length) % this.buf.length]);
    return out;
  }

  summary(): { frames: number; avgMs: number; fps: number; p95Ms: number; p99Ms: number; stdMs: number; over16: number; over33: number } {
    const v = this.values();
    if (!v.length) return { frames: 0, avgMs: 0, fps: 0, p95Ms: 0, p99Ms: 0, stdMs: 0, over16: 0, over33: 0 };
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    const sorted = [...v].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const std = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
    return {
      frames: v.length,
      avgMs: avg,
      fps: 1000 / avg,
      p95Ms: q(0.95),
      p99Ms: q(0.99),
      stdMs: std,
      over16: v.filter((x) => x > FRAME_60 * 1.05).length / v.length,
      over33: v.filter((x) => x > FRAME_30 * 1.05).length / v.length,
    };
  }

  clear(): void {
    this.n = 0;
    this.i = 0;
    this.longFrames = 0;
    this.maxMs = 0;
  }
}
