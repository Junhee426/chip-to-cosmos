import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call and GPU-cost reductions applied once when a level is built.
 * None of them removes content: they merge, thin repeated micro-geometry or
 * stop tiny parts from casting shadows.
 */

function materialKey(m: THREE.Material): string {
  const s = m as THREE.MeshPhysicalMaterial;
  return [
    m.type, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.metalness, s.roughness,
    s.map?.uuid, s.bumpMap?.uuid, s.roughnessMap?.uuid, s.emissiveMap?.uuid, m.transparent, m.opacity, m.side,
    s.clearcoat, s.iridescence, m.depthWrite, m.blending,
  ].join('|');
}

function attrSignature(g: THREE.BufferGeometry): string {
  return `${g.index ? 'i' : 'n'}:${Object.keys(g.attributes).sort().join(',')}`;
}

/**
 * Merge sibling static meshes that share an equivalent material into one mesh.
 * Only direct children of each node are merged, so exploded parts, picking
 * groups and component-level fading keep working. Skipped: instanced, points,
 * lines, meshes with children, `noFade`/`keep` objects and any object in `protect`.
 */
export function mergeStatic(root: THREE.Object3D, protect: Set<THREE.Object3D>, protectMaterials: Set<THREE.Material>): number {
  let removed = 0;
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.children.length > 1 && !o.userData.noFade) parents.push(o);
  });
  for (const p of parents) {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const c of p.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.children.length || protect.has(m) || m.userData.keep || m.userData.noFade || Array.isArray(m.material) || !m.visible) continue;
      const mat = m.material as THREE.Material;
      const key = protectMaterials.has(mat) ? `id:${mat.uuid}|${attrSignature(m.geometry)}` : `${materialKey(mat)}|${attrSignature(m.geometry)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        return m.geometry.clone().applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list.some((m) => m.castShadow);
      mesh.receiveShadow = list.some((m) => m.receiveShadow);
      p.add(mesh);
      for (const m of list) {
        m.removeFromParent();
        m.geometry.dispose();
        if (m.material !== list[0].material && !protectMaterials.has(m.material as THREE.Material)) (m.material as THREE.Material).dispose();
      }
      removed += list.length - 1;
    }
  }
  return removed;
}

/** Only parts larger than `minFraction` of the level radius cast shadows; micro-geometry never does. */
export function applyShadowPolicy(root: THREE.Object3D, levelRadius: number, minFraction = 0.04): void {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh) {
      m.castShadow = false;
      return;
    }
    if (!m.castShadow) return;
    m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!).getSize(size);
    m.getWorldScale(_s);
    if (Math.max(size.x * _s.x, size.y * _s.y, size.z * _s.z) < levelRadius * minFraction) m.castShadow = false;
  });
}
const _s = new THREE.Vector3();

/**
 * Model LOD for repeated micro-geometry. Grids (`userData.grid = {nx, nz}`) are
 * sub-sampled in 2D (every 2nd element at lod 2) so they still read as a regular
 * array; scatter sets (`userData.lodScatter`) keep a leading fraction.
 */
export function applyLod(root: THREE.Object3D, lod: number): void {
  root.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    if (!m.userData.fullMatrices) {
      if (!m.userData.grid && !m.userData.lodScatter) return;
      m.userData.fullMatrices = Float32Array.from(m.instanceMatrix.array as Float32Array);
      m.userData.fullCount = m.count;
    }
    const full = m.userData.fullMatrices as Float32Array;
    const fullCount = m.userData.fullCount as number;
    const dst = m.instanceMatrix.array as Float32Array;
    let n = 0;
    if (m.userData.grid) {
      const { nx, nz, cells } = m.userData.grid as { nx: number; nz: number; cells: [number, number][] };
      const stride = lod >= 2 && fullCount > 200 ? 2 : 1;
      cells.forEach(([i, j], k) => {
        if (i % stride || j % stride) return;
        dst.set(full.subarray(k * 16, k * 16 + 16), n * 16);
        n++;
      });
      void nx;
      void nz;
    } else {
      const f = lod === 0 ? 1 : lod === 1 ? 0.6 : 0.35;
      n = Math.max(1, Math.round(fullCount * f));
      dst.set(full.subarray(0, n * 16));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
}

/** Rough GPU-cost accounting of what a subtree would draw. */
export function countDraws(root: THREE.Object3D): { meshes: number; instanced: number; points: number; lines: number } {
  const r = { meshes: 0, instanced: 0, points: 0, lines: 0 };
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) r.instanced++;
    else if ((o as THREE.Mesh).isMesh) r.meshes++;
    else if ((o as THREE.Points).isPoints) r.points++;
    else if ((o as THREE.Line).isLine) r.lines++;
  });
  return r;
}
