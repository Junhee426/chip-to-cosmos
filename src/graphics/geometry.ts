import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Box whose position is its centre. */
export function box(w: number, h: number, d: number, material: THREE.Material, pos?: THREE.Vector3Tuple, radius = 0): THREE.Mesh {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) / 2 - 1e-6)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(...pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cylinder(r: number, h: number, material: THREE.Material, pos?: THREE.Vector3Tuple, segments = 24, axis: 'x' | 'y' | 'z' = 'y'): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (pos) m.position.set(...pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
}

/**
 * Instanced regular grid (nx × nz) of a geometry in the XZ plane, centred.
 * `filter` can skip cells. Returns the instanced mesh.
 */
export function instancedGrid(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  nx: number,
  nz: number,
  pitchX: number,
  pitchZ: number,
  y = 0,
  filter?: (i: number, j: number) => boolean,
  jitter?: (i: number, j: number, m: THREE.Matrix4) => void,
): THREE.InstancedMesh {
  const cells: [number, number][] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (!filter || filter(i, j)) cells.push([i, j]);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(cells.length, 1));
  const m = new THREE.Matrix4();
  cells.forEach(([i, j], k) => {
    m.makeTranslation((i - (nx - 1) / 2) * pitchX, y, (j - (nz - 1) / 2) * pitchZ);
    jitter?.(i, j, m);
    mesh.setMatrixAt(k, m);
  });
  mesh.count = cells.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.grid = { nx, nz, cells };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Thin polyline tube, e.g. for traces, harnesses, booms. */
export function tube(points: THREE.Vector3[], r: number, material: THREE.Material, segments = 64): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.05);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, r, 8, false), material);
  m.castShadow = true;
  return m;
}

/** Straight-segment (Manhattan) trace as a flattened box chain. */
export function trace(points: THREE.Vector3[], width: number, thickness: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = a.distanceTo(b);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len + width, thickness, width), material);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    seg.receiveShadow = true;
    g.add(seg);
  }
  return g;
}

export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
