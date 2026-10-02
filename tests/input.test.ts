import { describe, expect, it } from 'vitest';
import { PointerTracker, isActivatableTarget, isEditableTarget, tapSlop } from '../src/runtime/input-controller';

const ev = (pointerId: number, x: number, y: number, pointerType = 'touch', isPrimary = pointerId === 1) => ({ pointerId, pointerType, isPrimary, clientX: x, clientY: y });

describe('tap detection', () => {
  it('slop: mouse 5 px, touch 10 px', () => {
    expect(tapSlop('mouse')).toBe(5);
    expect(tapSlop('touch')).toBe(10);
    const t = new PointerTracker();
    t.down(ev(1, 0, 0, 'mouse'));
    expect(t.up(ev(1, 6, 0, 'mouse'))).toBe(false);
    t.down(ev(1, 0, 0, 'touch'));
    expect(t.up(ev(1, 9, 0, 'touch'))).toBe(true);
  });
  it('a pinch never selects, even when one finger lifts without moving', () => {
    const t = new PointerTracker();
    t.down(ev(1, 100, 100));
    t.down(ev(2, 200, 200));
    expect(t.up(ev(2, 200, 200))).toBe(false);
    expect(t.up(ev(1, 100, 100))).toBe(false);
    expect(t.pointers).toBe(0);
    // the next clean tap works again (no stale multi-touch state)
    t.down(ev(1, 50, 50));
    expect(t.up(ev(1, 51, 50))).toBe(true);
  });
  it('pointercancel forgets the gesture (no stale down)', () => {
    const t = new PointerTracker();
    t.down(ev(1, 0, 0));
    t.cancel(ev(1, 0, 0));
    expect(t.pointers).toBe(0);
    expect(t.up(ev(1, 0, 0))).toBe(false);
  });
  it('pointerup clears the origin so a later stray up is not a tap', () => {
    const t = new PointerTracker();
    t.down(ev(1, 0, 0));
    expect(t.up(ev(1, 0, 0))).toBe(true);
    expect(t.up(ev(1, 0, 0))).toBe(false);
  });
});

describe('shortcut targets', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, getAttribute: (k: string) => (extra.attrs as Record<string, string> | undefined)?.[k] ?? null, ...extra }) as unknown as EventTarget;
  it('editable targets suppress shortcuts', () => {
    for (const t of ['INPUT', 'SELECT', 'TEXTAREA']) expect(isEditableTarget(el(t))).toBe(true);
    expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el('DIV', { attrs: { contenteditable: 'true' } }))).toBe(true);
    expect(isEditableTarget(el('CANVAS'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
  it('focused buttons/tabs own Enter and Space', () => {
    expect(isActivatableTarget(el('BUTTON'))).toBe(true);
    expect(isActivatableTarget(el('DIV', { attrs: { role: 'tab' } }))).toBe(true);
    expect(isActivatableTarget(el('CANVAS'))).toBe(false);
  });
});
