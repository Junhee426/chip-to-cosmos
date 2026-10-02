import * as THREE from 'three';
import { QualityController, getRenderDpr, type GraphicsConfig, type GraphicsQuality, type QualityMode, type ControllerOptions } from '../app/quality';
import { FrameStats } from '../graphics/perf';

export interface GraphicsTargets {
  renderer: THREE.WebGLRenderer;
  /** apply the configuration to everything that renders (post, lights, labels, levels…) */
  apply: (g: GraphicsConfig) => void;
  /** UI feedback: current mode / effective tier / degradation step */
  report: (mode: QualityMode, tier: GraphicsQuality, step: number) => void;
  suggestAuto: () => void;
}

/**
 * Frame statistics, the adaptive quality controller and the `?perf` overlay.
 * The controller only samples while nothing transient happens (transitions,
 * hidden tab, resize), so hitches are never mistaken for sustained load.
 */
export class PerformanceController {
  readonly stats = new FrameStats(600);
  readonly frameInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  readonly quality: QualityController;
  cfg: GraphicsConfig;
  private suggested = false;
  private overlayT = 0;
  overlayOn = false;

  constructor(private t: GraphicsTargets, mode: QualityMode, detected: GraphicsQuality, ceiling: GraphicsQuality, policy: ControllerOptions, private overlay: HTMLElement) {
    this.quality = new QualityController(mode, detected, ceiling, policy);
    this.cfg = this.quality.config();
  }

  apply(g: GraphicsConfig = this.quality.config()): void {
    this.cfg = g;
    this.t.apply(g);
    this.t.report(this.quality.mode, this.quality.tier, this.quality.step);
  }

  setMode(mode: QualityMode, detected: GraphicsQuality): void {
    this.quality.setMode(mode, detected, performance.now() / 1000);
    this.suggested = false;
    this.apply();
  }

  dpr(): number {
    return getRenderDpr(this.cfg, devicePixelRatio);
  }

  /** drop the sampling window (transitions, resize, hidden tab) */
  pause(): void {
    this.quality.reset(performance.now() / 1000);
  }

  beginFrame(): void {
    this.t.renderer.info.reset();
  }

  /** After render: record the frame, maybe adapt quality, refresh the overlay. */
  endFrame(raw: number, transient: boolean, label: string): void {
    Object.assign(this.frameInfo, this.t.renderer.info.render);
    const now = performance.now() / 1000;
    if (raw > 0) this.stats.push(raw * 1000);
    if (transient || document.hidden) this.quality.reset(now);
    else if (raw > 0) {
      if (this.quality.feed(raw, now)) {
        this.apply();
        this.stats.clear();
      }
      if (this.quality.suggestLower && !this.suggested) {
        this.suggested = true;
        this.t.suggestAuto();
      }
    }
    if (this.overlayOn && now - this.overlayT > 0.5) {
      this.overlayT = now;
      this.overlay.textContent = this.overlayText(label);
    }
  }

  toggleOverlay(on = !this.overlayOn): void {
    this.overlayOn = on;
    this.overlay.hidden = !on;
    if (on) console.table(this.snapshot());
  }

  snapshot(): Record<string, number> {
    const r = this.t.renderer;
    return { ...this.frameInfo, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0 };
  }

  private overlayText(label: string): string {
    const m = this.stats.summary();
    const r = this.t.renderer;
    const q = this.quality;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; // Chromium-only auxiliary signal
    return (
      `${m.fps.toFixed(0)} fps · avg ${m.avgMs.toFixed(1)} ms · p95 ${m.p95Ms.toFixed(1)} · p99 ${m.p99Ms.toFixed(1)}\n` +
      `σ ${m.stdMs.toFixed(1)} ms · >16.7 ${(m.over16 * 100).toFixed(0)}% · >33.3 ${(m.over33 * 100).toFixed(0)}% · long ${this.stats.longFrames} · max ${this.stats.maxMs.toFixed(0)} ms\n` +
      `calls ${this.frameInfo.calls} · tris ${(this.frameInfo.triangles / 1000).toFixed(0)}k · geo ${r.info.memory.geometries} · tex ${r.info.memory.textures} · prog ${r.info.programs?.length ?? 0}\n` +
      `${label} · ${q.mode}→${q.tier}${q.step ? ` −${q.step}` : ''} · dpr ${r.getPixelRatio().toFixed(2)} · shadows ${this.cfg.shadows ? this.cfg.shadowMapSize : 'off'} · bloom ${this.cfg.bloom ? 'on' : 'off'}` +
      (mem ? ` · heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '')
    );
  }
}
