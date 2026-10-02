import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  arrayDirToBody,
  arrayDirToWorld,
  arrayDirection,
  bodyDirToWorld,
  canonicalOrbit,
  dot,
  earthIntersection,
  elevationDeg,
  horizonNadirDeg,
  len,
  orbitFrame,
  raySphere,
  worldPointToEarthLocal,
  type Vec3,
} from '../src/models/frames';
import { slantRangeM } from '../src/models/link-budget';

const close = (a: Vec3, b: Vec3, eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe('coordinate frames', () => {
  it('array boresight (+Y) points to nadir in the body and world frames', () => {
    close(arrayDirToBody([0, 1, 0]), [0, -1, 0]);
    const o = canonicalOrbit(550);
    close(arrayDirToWorld([0, 1, 0], o), [0, -1, 0]);
  });

  it('positive steering about φ = 0 tilts the beam along +X (along-track)', () => {
    const d = arrayDirToWorld(arrayDirection(20, 0), canonicalOrbit(550));
    expect(d[0]).toBeGreaterThan(0.3);
    expect(d[1]).toBeLessThan(-0.9);
    expect(Math.abs(d[2])).toBeLessThan(1e-12);
  });

  it('azimuth rotates the steering plane: φ = 90° tilts along array +Z = body −Z', () => {
    const a = arrayDirection(20, 90);
    expect(a[2]).toBeGreaterThan(0.3);
    const b = arrayDirToBody(a);
    expect(b[2]).toBeLessThan(-0.3);
    expect(Math.abs(b[0])).toBeLessThan(1e-12);
  });

  it('transforms preserve unit length', () => {
    const f = orbitFrame([3000, 5000, -2000], [0.3, 0.1, 0.9]);
    for (const [t, p] of [[0, 0], [25, 40], [-50, 170], [60, 300]]) {
      expect(len(arrayDirToWorld(arrayDirection(t, p), f))).toBeCloseTo(1, 12);
    }
    expect(dot(f.x, f.y)).toBeCloseTo(0, 12);
    expect(dot(f.y, f.z)).toBeCloseTo(0, 12);
  });

  it('a general orbit frame maps body nadir to the Earth centre direction', () => {
    const pos: Vec3 = [4000, 4500, 2500];
    const f = orbitFrame(pos, [-0.7, 0.2, 0.68]);
    const n = bodyDirToWorld([0, -1, 0], f);
    const r = len(pos);
    close(n, [-pos[0] / r, -pos[1] / r, -pos[2] / r], 1e-12);
  });

  it('worldPointToEarthLocal returns along / radial / cross components', () => {
    const o = canonicalOrbit(550);
    close(worldPointToEarthLocal([10, 6371, -5], o), [10, 6371, -5]);
  });
});

describe('ray / sphere intersection', () => {
  it('nadir ray hits the sub-satellite point at range h', () => {
    const o = canonicalOrbit(550);
    const t = raySphere(o.posKm, [0, -1, 0], [0, 0, 0], EARTH_RADIUS_KM);
    expect(t).toBeCloseTo(550, 9);
    close(earthIntersection(o, [0, -1, 0])!, [0, EARTH_RADIUS_KM, 0], 1e-9);
  });

  it('a ray pointing away or above the horizon misses (null, never NaN)', () => {
    const o = canonicalOrbit(550);
    expect(raySphere(o.posKm, [0, 1, 0], [0, 0, 0], EARTH_RADIUS_KM)).toBeNull();
    const h = (horizonNadirDeg(550) + 0.5) * (Math.PI / 180);
    expect(earthIntersection(o, [Math.sin(h), -Math.cos(h), 0])).toBeNull();
    expect(raySphere(o.posKm, [0, 0, 0], [0, 0, 0], EARTH_RADIUS_KM)).toBeNull();
  });

  it('just inside the horizon still hits, with finite coordinates at low elevation', () => {
    const o = canonicalOrbit(550);
    const h = (horizonNadirDeg(550) - 0.2) * (Math.PI / 180);
    const g = earthIntersection(o, [Math.sin(h), -Math.cos(h), 0])!;
    expect(g).not.toBeNull();
    g.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    expect(len(g)).toBeCloseTo(EARTH_RADIUS_KM, 6);
    expect(elevationDeg(g, o.posKm)).toBeLessThan(5);
  });

  it('geometric slant range agrees with the link-budget formula at the same elevation', () => {
    const o = canonicalOrbit(550);
    for (const nadirDeg of [0, 15, 35, 55]) {
      const a = (nadirDeg * Math.PI) / 180;
      const g = earthIntersection(o, [Math.sin(a), -Math.cos(a), 0])!;
      const r = len([o.posKm[0] - g[0], o.posKm[1] - g[1], o.posKm[2] - g[2]]);
      expect(slantRangeM(550e3, elevationDeg(g, o.posKm)) / 1000).toBeCloseTo(r, 6);
    }
  });
});
