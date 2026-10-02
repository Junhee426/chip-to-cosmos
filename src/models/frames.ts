/**
 * Coordinate frames shared by BEAM LAB, SATELLITE and COSMOS. Every sign or
 * rotation between them lives here — scenes never re-derive a transform.
 *
 * ARRAY LOCAL (BEAM LAB)
 *   Origin at the array centre, elements in the X–Z plane, +Y = array boresight.
 *   Direction (θ, φ): θ from +Y, φ from +X toward +Z:
 *     d = (sinθ cosφ, cosθ, sinθ sinφ)
 *   so the direction cosines used by the array factor are u = d.x, v = d.z.
 *
 * SATELLITE BODY
 *   +X along-track (velocity), +Y zenith (radially outward), +Z = X × Y
 *   (orbit normal side). The nadir deck faces −Y. The phased array is mounted
 *   on the nadir deck facing down, i.e. ARRAY LOCAL rotated by π about X:
 *     body = (x, −y, −z)
 *   This is the same rotation the SATELLITE → BEAM LAB anchor uses.
 *
 * ORBIT / LOCAL (LVLH-like)
 *   The spacecraft flies nadir-pointing with zero yaw, so its body frame is the
 *   orbit frame: x = along-track, y = radial-out, z = x × y.
 *
 * EARTH / WORLD
 *   Earth-centred, Y-up (the COSMOS scene frame), kilometres. A body direction
 *   maps to world with the orbit-frame basis {x, y, z} of the satellite.
 *   The CANONICAL orbit frame puts the satellite at (0, Re + h, 0) moving
 *   along +X, so body = world there; any other orbit position is a pure
 *   rotation about the Earth centre (the footprint shape is invariant for a
 *   nadir-pointing spacecraft over a spherical Earth).
 */
export type Vec3 = [number, number, number];

export const EARTH_RADIUS_KM = 6371;

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Array-local direction for steering angles (deg). θ may be negative (mirrors through boresight). */
export function arrayDirection(thetaDeg: number, phiDeg: number): Vec3 {
  const t = (thetaDeg * Math.PI) / 180;
  const p = (phiDeg * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
}

/** ARRAY LOCAL → SATELLITE BODY (rotation by π about X; an involution). */
export function arrayDirToBody(d: Vec3): Vec3 {
  return [d[0], -d[1], -d[2]];
}
export const bodyDirToArray = arrayDirToBody;

export interface OrbitFrame {
  /** satellite position, Earth-centred (km) */
  posKm: Vec3;
  x: Vec3; // along-track
  y: Vec3; // radial out (zenith)
  z: Vec3; // x × y
}

/** Orbit frame from position and velocity (velocity is orthogonalised against the radial direction). */
export function orbitFrame(posKm: Vec3, vel: Vec3): OrbitFrame {
  const y = normalize(posKm);
  const x = normalize(sub(vel, scale(y, dot(vel, y))));
  return { posKm, x, y, z: cross(x, y) };
}

/** Canonical orbit: satellite at (0, Re + h, 0) flying along +X — body axes = world axes. */
export function canonicalOrbit(altitudeKm: number): OrbitFrame {
  return { posKm: [0, EARTH_RADIUS_KM + altitudeKm, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
}

/** SATELLITE BODY → EARTH/WORLD direction. */
export function bodyDirToWorld(d: Vec3, f: OrbitFrame): Vec3 {
  return [
    d[0] * f.x[0] + d[1] * f.y[0] + d[2] * f.z[0],
    d[0] * f.x[1] + d[1] * f.y[1] + d[2] * f.z[1],
    d[0] * f.x[2] + d[1] * f.y[2] + d[2] * f.z[2],
  ];
}

/** ARRAY LOCAL → EARTH/WORLD direction. */
export function arrayDirToWorld(d: Vec3, f: OrbitFrame): Vec3 {
  return bodyDirToWorld(arrayDirToBody(d), f);
}

/** EARTH/WORLD point → orbit-frame coordinates (Earth-centred, km): [along-track, radial, cross-track]. */
export function worldPointToEarthLocal(p: Vec3, f: OrbitFrame): Vec3 {
  return [dot(p, f.x), dot(p, f.y), dot(p, f.z)];
}

/**
 * Ray / sphere intersection (quadratic solution). Returns the smallest t ≥ 0 with
 * |o + t·d − c| = r, or null when the ray misses (or the sphere is behind the ray).
 * `d` need not be normalised; t is in units of |d|.
 */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const a = dot(d, d);
  if (!(a > 0)) return null;
  const oc = sub(o, c);
  const b = dot(oc, d);
  const cc = dot(oc, oc) - r * r;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / a;
  const t1 = (-b + s) / a;
  const t = t0 >= 0 ? t0 : t1 >= 0 ? t1 : null;
  return t !== null && Number.isFinite(t) ? t : null;
}

/** Intersect a world direction from the satellite with the spherical Earth. */
export function earthIntersection(f: OrbitFrame, dirWorld: Vec3, radiusKm = EARTH_RADIUS_KM): Vec3 | null {
  const d = normalize(dirWorld);
  const t = raySphere(f.posKm, d, [0, 0, 0], radiusKm);
  return t === null ? null : add(f.posKm, scale(d, t));
}

/** Elevation (deg) of the satellite seen from a ground point on the sphere. */
export function elevationDeg(groundKm: Vec3, satKm: Vec3): number {
  const up = normalize(groundKm);
  const los = normalize(sub(satKm, groundKm));
  return (Math.asin(Math.max(-1, Math.min(1, dot(up, los)))) * 180) / Math.PI;
}

/** Great-circle distance (km) between two points on (or radially above) the sphere. */
export function greatCircleKm(a: Vec3, b: Vec3, radiusKm = EARTH_RADIUS_KM): number {
  const c = dot(normalize(a), normalize(b));
  return radiusKm * Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Nadir angle (deg) at which a ray from altitude h grazes the Earth limb. */
export function horizonNadirDeg(altitudeKm: number, radiusKm = EARTH_RADIUS_KM): number {
  return (Math.asin(radiusKm / (radiusKm + altitudeKm)) * 180) / Math.PI;
}
