import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeStatic } from '../src/graphics/optimize';

const mesh = (m: THREE.Material, x: number) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
  o.position.x = x;
  return o;
};

describe('static merge keeps engineering semantics', () => {
  it('merges equivalent siblings but never protected (explode/picking) objects', () => {
    const root = new THREE.Group();
    const part = new THREE.Group();
    const steel = () => new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4 });
    part.add(mesh(steel(), 0), mesh(steel(), 2), mesh(steel(), 4));
    const exploding = mesh(steel(), 6);
    part.add(exploding);
    root.add(part);
    const removed = mergeStatic(root, new Set([exploding]), new Set());
    expect(removed).toBe(2);
    expect(part.children).toContain(exploding);
    expect(part.children.length).toBe(2);
    // merged geometry keeps world placement (bounding box spans x = -0.5 … 4.5)
    const merged = part.children.find((c) => c !== exploding) as THREE.Mesh;
    merged.geometry.computeBoundingBox();
    expect(merged.geometry.boundingBox!.min.x).toBeCloseTo(-0.5, 6);
    expect(merged.geometry.boundingBox!.max.x).toBeCloseTo(4.5, 6);
  });
  it('cutaway materials are merged only by identity, so clipping keeps working', () => {
    const root = new THREE.Group();
    const shellA = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    const shellB = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    root.add(mesh(shellA, 0), mesh(shellA, 1), mesh(shellB, 2));
    mergeStatic(root, new Set(), new Set([shellA, shellB]));
    const mats = root.children.map((c) => (c as THREE.Mesh).material);
    expect(mats).toContain(shellA);
    expect(mats).toContain(shellB);
    expect(root.children.length).toBe(2);
  });
  it('different materials are never merged together', () => {
    const root = new THREE.Group();
    root.add(mesh(new THREE.MeshStandardMaterial({ color: 0xff0000 }), 0), mesh(new THREE.MeshStandardMaterial({ color: 0x00ff00 }), 1));
    expect(mergeStatic(root, new Set(), new Set())).toBe(0);
  });
});
