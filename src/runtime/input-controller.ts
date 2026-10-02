import * as THREE from 'three';
import type { CameraRig } from '../graphics/camera';

/** Minimal pointer shape so the gesture logic is testable without a DOM. */
export interface PointerLike {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
}

/** Movement allowed between down and up for a tap: mouse 5 px, touch/pen 10 px. */
export const tapSlop = (pointerType: string): number => (pointerType === 'mouse' ? 5 : 10);

/**
 * Tap detection that survives multi-touch and cancellation:
 * - only a single-pointer gesture can become a tap (pinch never selects);
 * - pointercancel and pointerup always forget the pointer (no stale `down`);
 * - the gesture is "dirty" until every pointer of it has been released.
 */
export class PointerTracker {
  private active = new Map<number, { x: number; y: number }>();
  private multi = false;
  private origin: { id: number; x: number; y: number; type: string } | null = null;

  down(e: PointerLike): void {
    this.active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.active.size > 1) this.multi = true;
    if (this.active.size === 1 && e.isPrimary) this.origin = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
  }

  /** Returns true when this release completes a tap. */
  up(e: PointerLike): boolean {
    const o = this.origin;
    this.active.delete(e.pointerId);
    const tap = !!o && !this.multi && o.id === e.pointerId && e.isPrimary && Math.hypot(e.clientX - o.x, e.clientY - o.y) <= tapSlop(o.type);
    if (o && o.id === e.pointerId) this.origin = null;
    if (this.active.size === 0) this.multi = false;
    return tap;
  }

  cancel(e: PointerLike): void {
    this.active.delete(e.pointerId);
    if (this.origin?.id === e.pointerId) this.origin = null;
    if (this.active.size === 0) this.multi = false;
  }

  get pointers(): number {
    return this.active.size;
  }
}

/** Keyboard shortcuts must never fire while the user is typing or operating a form control. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true || el.getAttribute?.('contenteditable') === 'true';
}

/** Activation keys on a focused control belong to that control (button, link, tab …). */
export function isActivatableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'BUTTON' || tag === 'A' || el.getAttribute?.('role') === 'button' || el.getAttribute?.('role') === 'tab';
}

export interface InputHandlers {
  /** id of the component under the pointer, or null */
  pick: (ndc: THREE.Vector2) => string | null;
  select: (id: string | null) => void;
  /** dive into the child scale of a component (mouse double-click only) */
  dive: (id: string) => void;
  blocked: () => boolean;
}

/**
 * Canvas pointer input: tap = select, drag = orbit (OrbitControls), mouse
 * double-click = dive. Touch never dives implicitly. Any manual input cancels a
 * non-critical (cinematic) camera flight; scale-transition flights are never interrupted.
 */
export class InputController {
  private tracker = new PointerTracker();
  private lastType = 'mouse';
  private hoverT = 0;
  private ndc = new THREE.Vector2();

  constructor(private canvas: HTMLCanvasElement, private rig: CameraRig, private h: InputHandlers) {
    canvas.addEventListener('pointerdown', (e) => {
      this.lastType = e.pointerType;
      this.tracker.down(e);
      this.yieldToUser();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.tracker.up(e) && !h.blocked()) h.select(this.pickAt(e));
    });
    canvas.addEventListener('pointercancel', (e) => this.tracker.cancel(e));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.tracker.cancel(e);
    });
    canvas.addEventListener('wheel', () => this.yieldToUser(), { passive: true });
    canvas.addEventListener('dblclick', (e) => {
      if (h.blocked() || this.lastType !== 'mouse') return;
      const id = this.pickAt(e);
      if (id) h.dive(id);
    });
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (e.pointerType !== 'mouse' || now - this.hoverT < 80 || e.buttons) return;
      this.hoverT = now;
      canvas.style.cursor = this.pickAt(e) ? 'pointer' : 'grab';
    });
  }

  /** Manual input wins over a cinematic flight (e.g. keep-in-view), never over a scale transition. */
  private yieldToUser(): void {
    if (this.rig.flying && !this.rig.flightCritical) this.rig.cancelFlight();
  }

  private pickAt(e: { clientX: number; clientY: number }): string | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.h.pick(this.ndc);
  }
}

export interface KeyActions {
  introRunning: () => boolean;
  skipIntro: () => void;
  back: () => void;
  enter: () => void;
  mode: (index: number) => void;
  toggleExplode: () => void;
  toggleCutaway: () => void;
  toggleLabels: () => void;
  togglePerf: () => void;
}

/** Global shortcuts; ignored while typing (input/select/textarea/contenteditable). */
export function bindKeyboard(a: KeyActions): void {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
    if (a.introRunning()) {
      if (e.key === 'Escape' || e.key === ' ') a.skipIntro();
      return;
    }
    // Enter / Space on a focused button, tab or link activate that control, not a shortcut
    if ((e.key === 'Enter' || e.key === ' ') && isActivatableTarget(e.target)) return;
    if (e.key === 'Escape' || e.key === 'Backspace') a.back();
    else if (e.key === 'Enter') a.enter();
    else if (e.key.length === 1 && '12345'.includes(e.key)) a.mode(Number(e.key) - 1);
    else if (e.key === 'e' || e.key === 'E') a.toggleExplode();
    else if (e.key === 'c' || e.key === 'C') a.toggleCutaway();
    else if (e.key === 'l' || e.key === 'L') a.toggleLabels();
    else if (e.key === 'p' || e.key === 'P') a.togglePerf();
  });
}
