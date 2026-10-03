import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_PARAMS, type Params } from '../src/app/state';
import { beamSolution } from '../src/app/system';
import {
  ARRAY_TO_BODY,
  ARRAY_TO_BODY_QUAT,
  arrayDirToBody,
  arrayDirToWorld,
  arrayNormalBody,
  canonicalOrbit,
  dot,
  nadirWorld,
  orbitFrame,
  type Vec3,
} from '../src/models/frames';
import { planarAF, weights } from '../src/models/array-factor';

const P = (patch: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...patch });
const FRAMES = [
  canonicalOrbit(550),
  orbitFrame([4100, 4700, 2300], [-0.7, 0.2, 0.68]),
  orbitFrame([-6900, 300, -900], [0.1, 0.95, -0.2]),
];

describe('P0: the user-service phased array faces the Earth', () => {
  it('array normal (+Y local) is body −Y (nadir deck)', () => {
    const n = arrayNormalBody();
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(-1, 12);
    expect(n[2]).toBeCloseTo(0, 12);
  });

  it('zero steering: boresight = spacecraft nadir = Earth-centre direction, in any orbit position', () => {
    for (const f of FRAMES) {
      expect(dot(arrayDirToWorld([0, 1, 0], f), nadirWorld(f))).toBeCloseTo(1, 9);
      // the calculated beam axis at θ0 = 0 is the boresight
      const b = beamSolution(P({ steerDeg: 0 }));
      expect(dot(arrayDirToWorld(b.pattern.axis, f), nadirWorld(f))).toBeCloseTo(1, 9);
    }
  });

  it('the scene-graph mounting quaternion is the same rotation as frames.ARRAY_TO_BODY', () => {
    const q = new THREE.Quaternion().fromArray(ARRAY_TO_BODY_QUAT as unknown as number[]);
    for (const d of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.3, 0.8, -0.52]] as Vec3[]) {
      const v = new THREE.Vector3(...d).applyQuaternion(q);
      const r = arrayDirToBody(d);
      expect(v.x).toBeCloseTo(r[0], 12);
      expect(v.y).toBeCloseTo(r[1], 12);
      expect(v.z).toBeCloseTo(r[2], 12);
    }
  });

  it('electronic steering never changes the mounting: the panel normal stays at nadir, only the beam axis moves', () => {
    const mount = JSON.stringify(ARRAY_TO_BODY);
    const f = canonicalOrbit(550);
    let prev = -Infinity;
    for (const steerDeg of [0, 10, 25, 40, 55]) {
      const b = beamSolution(P({ steerDeg }));
      expect(JSON.stringify(ARRAY_TO_BODY)).toBe(mount);
      expect(dot(arrayDirToWorld([0, 1, 0], f), nadirWorld(f))).toBeCloseTo(1, 12);
      // beam axis tilts away from nadir monotonically with θ0
      const off = Math.acos(Math.min(1, dot(arrayDirToWorld(b.pattern.axis, f), nadirWorld(f))));
      expect(off).toBeGreaterThan(prev);
      prev = off;
    }
  });

  it('positive steering (φ0 = 0) moves the beam and footprint along +X (along-track) on the Earth', () => {
    const b = beamSolution(P({ steerDeg: 25, steerAzDeg: 0 }));
    const w = arrayDirToWorld(b.pattern.axis, canonicalOrbit(550));
    expect(w[0]).toBeGreaterThan(0.3);
    expect(w[1]).toBeLessThan(-0.85);
    expect(b.footprint.center![0]).toBeGreaterThan(150);
  });
});

describe('array-factor sum (phasor recurrence) matches the direct cos/sin sum', () => {
  it('to 1e-12 for N = 32 at many directions', () => {
    const a = { n: 32, spacingLambda: 0.7, steerThetaDeg: 33, steerPhiDeg: 40, weighting: 'hamming' as const };
    const w = weights(32, 'hamming');
    const direct = (psi: number) => {
      let re = 0, im = 0, s = 0;
      for (let i = 0; i < w.length; i++) {
        re += w[i] * Math.cos(i * psi);
        im += w[i] * Math.sin(i * psi);
        s += w[i];
      }
      return Math.hypot(re, im) / s;
    };
    const kd = 2 * Math.PI * a.spacingLambda;
    const bx = -kd * Math.sin((33 * Math.PI) / 180) * Math.cos((40 * Math.PI) / 180);
    const by = -kd * Math.sin((33 * Math.PI) / 180) * Math.sin((40 * Math.PI) / 180);
    for (let k = 0; k < 200; k++) {
      const th = (k * 0.0079) % (Math.PI / 2);
      const ph = (k * 0.137) % (2 * Math.PI);
      const ref = direct(kd * Math.sin(th) * Math.cos(ph) + bx) * direct(kd * Math.sin(th) * Math.sin(ph) + by);
      expect(Math.abs(planarAF(a, w, th, ph) - ref)).toBeLessThan(1e-12);
    }
  });
});
