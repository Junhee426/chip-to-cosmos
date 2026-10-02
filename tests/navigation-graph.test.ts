import { describe, expect, it } from 'vitest';
import { LEVELS, MAIN_CHAIN, children, residentSet, validateLevelGraph, type LevelId } from '../src/app/navigation';

const g = (spec: Record<string, string | null>) => Object.fromEntries(Object.entries(spec).map(([id, parent]) => [id, { id, parent }]));

describe('level graph validation', () => {
  it('the shipped graph is valid', () => {
    expect(validateLevelGraph()).toEqual([]);
  });
  it('MAIN_CHAIN runs cosmos → energy and BEAM LAB hangs off SATELLITE', () => {
    expect(MAIN_CHAIN[0]).toBe('cosmos');
    expect(MAIN_CHAIN[MAIN_CHAIN.length - 1]).toBe('energy');
    expect(LEVELS.array.parent).toBe('satellite');
    expect(MAIN_CHAIN).not.toContain('array');
  });
  it('detects two roots', () => {
    expect(validateLevelGraph(g({ a: null, b: null }), ['a'])).toEqual(expect.arrayContaining([expect.stringContaining('exactly one root')]));
  });
  it('detects missing parents', () => {
    expect(validateLevelGraph(g({ a: null, b: 'zzz' }), ['a'])).toEqual(expect.arrayContaining([expect.stringContaining('does not exist')]));
  });
  it('detects cycles', () => {
    expect(validateLevelGraph(g({ a: null, b: 'c', c: 'b' }), ['a']).some((e) => e.includes('cycle'))).toBe(true);
  });
  it('detects a broken MAIN_CHAIN and dangling side branches', () => {
    expect(validateLevelGraph(g({ a: null, b: 'a', c: 'a' }), ['a', 'b', 'c']).some((e) => e.includes('MAIN_CHAIN'))).toBe(true);
    expect(validateLevelGraph(g({ a: null, b: 'a', x: 'b', y: 'x' }), ['a', 'b']).some((e) => e.includes('side branch y'))).toBe(true);
  });
});

describe('resident-set invariants', () => {
  const ids = Object.keys(LEVELS) as LevelId[];
  it('contains the level, its parent and its children — nothing else', () => {
    for (const id of ids) {
      const r = residentSet(id);
      const expected = new Set<LevelId>([id, ...children(id)]);
      const p = LEVELS[id].parent;
      if (p) expected.add(p);
      expect(r).toEqual(expected);
    }
  });
  it('always includes every level a single zoom step can reach', () => {
    for (const id of ids) {
      const r = residentSet(id);
      for (const c of children(id)) expect(r.has(c)).toBe(true);
      if (LEVELS[id].parent) expect(r.has(LEVELS[id].parent!)).toBe(true);
    }
  });
});
