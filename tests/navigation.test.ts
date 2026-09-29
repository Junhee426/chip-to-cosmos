import { describe, expect, it } from 'vitest';
import { ancestors, breadcrumb, children, formatLength, pathBetween, residentSet } from '../src/app/navigation';

describe('multiscale navigation graph', () => {
  it('ancestors form the scale chain', () => {
    expect(ancestors('mosfet')).toEqual(['cosmos', 'satellite', 'payload', 'pcb', 'package', 'die', 'mosfet']);
  });
  it('zooming in from cosmos to MOSFET is 6 downward steps', () => {
    const p = pathBetween('cosmos', 'mosfet');
    expect(p).toHaveLength(6);
    expect(p.every((s) => s.dir === 'down')).toBe(true);
    expect(p[0]).toEqual({ from: 'cosmos', to: 'satellite', dir: 'down' });
  });
  it('branch navigation climbs to the common ancestor then descends', () => {
    const p = pathBetween('mosfet', 'array');
    expect(p.map((s) => s.dir)).toEqual(['up', 'up', 'up', 'up', 'up', 'down']);
    expect(p[p.length - 1]).toEqual({ from: 'satellite', to: 'array', dir: 'down' });
  });
  it('no-op path', () => {
    expect(pathBetween('die', 'die')).toEqual([]);
  });
  it('breadcrumb labels', () => {
    expect(breadcrumb('die').map((l) => l.crumb)).toEqual(['COSMOS', 'SATELLITE', 'PAYLOAD', 'PCB', 'CHIP', 'DIE']);
  });
  it('children and residency', () => {
    expect(children('satellite').sort()).toEqual(['array', 'payload']);
    expect([...residentSet('satellite')].sort()).toEqual(['array', 'cosmos', 'payload', 'satellite']);
    expect(residentSet('energy').has('mosfet')).toBe(false);
  });
  it('length formatting', () => {
    expect(formatLength(1500)).toBe('1.50 km');
    expect(formatLength(2e-7)).toBe('200 nm');
    expect(formatLength(0.0035)).toBe('3.50 mm');
  });
});
