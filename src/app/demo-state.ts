import type { View } from '../graphics/camera';
import type { OrbitState } from '../scenes/base';
import type { LevelId } from './navigation';
import type { AppState, EngMode, Params } from './state';

/** What a demo may change and must give back when the user skips it. */
export interface DemoSnapshot {
  mode: EngMode;
  presentation: boolean;
  labels: boolean;
  params: Partial<Params>;
}

const DEMO_PARAMS: (keyof Params)[] = ['arrayN', 'spacingLambda', 'steerDeg', 'steerAzDeg', 'weighting', 'powerMode', 'paOutW', 'totalRfW', 'altitudeKm', 'freqGHz', 'rxGainDbi'];

export function snapshotDemoState(s: AppState): DemoSnapshot {
  const params: Partial<Params> = {};
  for (const k of DEMO_PARAMS) (params as Record<string, unknown>)[k] = s.params[k];
  return { mode: s.mode, presentation: s.presentation, labels: s.labels, params };
}

/** The store patch that restores a snapshot (parameters go through setParams/sanitize). */
export function restorePatch(snap: DemoSnapshot): { state: Pick<AppState, 'mode' | 'presentation' | 'labels'>; params: Partial<Params> } {
  return { state: { mode: snap.mode, presentation: snap.presentation, labels: snap.labels }, params: { ...snap.params } };
}

export type ScreenView = 'hidden' | 'landing' | 'demo' | 'poster';

/**
 * The screen a demo started from. Selection, explode and X-ray emphasis are not part
 * of it: they are level-specific (component IDs) and are reset on every arrival.
 */
export interface PresentationSnapshot {
  view: ScreenView;
  /** null while a scale transition was in flight */
  level: LevelId | null;
  /** cloned camera (never references to live vectors); null when not restorable */
  camera: View | null;
  viewport: { width: number; height: number };
  orbit: OrbitState | null;
}

export function snapshotScreen(view: ScreenView, level: LevelId | null, camera: View | null, viewport: { width: number; height: number }, orbit: OrbitState | null): PresentationSnapshot {
  return {
    view,
    level,
    camera: camera ? { pos: camera.pos.clone(), target: camera.target.clone(), up: camera.up?.clone() } : null,
    viewport: { ...viewport },
    orbit: orbit ? { ...orbit } : null,
  };
}

/** Why a demo ended. navigate/explore are explicit user intents and decide the final screen. */
export type StopReason = 'complete' | 'skip' | 'navigate' | 'explore' | 'error';

/**
 * What the end of a demo does:
 *  - poster:   Quick completed → the signature Cosmos poster (orbit frozen)
 *  - overview: Engineering/Grating completed → free exploration, Cosmos overview, orbit resumed, results kept
 *  - restore:  Skip/error → back to the starting screen with the starting store state
 *  - explore:  "Explore freely" during a demo → keep the current results, leave presentation here
 *  - release:  navigation during a demo → starting store state, presentation off; the navigation decides the scene
 */
export type EndAction =
  | { kind: 'poster' }
  | { kind: 'overview' }
  | { kind: 'restore'; screen: 'landing' | 'poster' | 'stay' }
  | { kind: 'explore' }
  | { kind: 'release' };

export function endAction(mode: 'quick' | 'engineering' | 'grating', reason: StopReason, start: ScreenView): EndAction {
  switch (reason) {
    case 'complete':
      return mode === 'quick' ? { kind: 'poster' } : { kind: 'overview' };
    case 'explore':
      return { kind: 'explore' };
    case 'navigate':
      return { kind: 'release' };
    default:
      return { kind: 'restore', screen: start === 'landing' ? 'landing' : start === 'poster' ? 'poster' : 'stay' };
  }
}

/** Two snapshots taken at the same viewport size can reuse the stored camera as is. */
export function sameViewport(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * Wall-clock timing of one demo run (ms, performance.now()):
 *  - preparation: play() entry → first explanatory scene (preload/compile)
 *  - playback:    first explanatory scene → end of the last reading hold
 *  - finish:      end of playback → final screen composed and cleanup done
 *  - total:       play() entry (the click handler) → final screen composed
 *  - plannedPlayback: designed critical path (parallel motions not summed)
 *  - cold:        the preparation had to build at least one level
 */
export interface DemoTiming {
  mode: 'quick' | 'engineering' | 'grating';
  reason: StopReason;
  preparationMs: number;
  playbackMs: number;
  finishMs: number;
  totalMs: number;
  plannedPlaybackMs: number;
  cold: boolean;
}
