import * as THREE from 'three';

/**
 * Opacity management for level cross-fades and engineering-mode dimming.
 * Final opacity = base opacity × component dim × level alpha.
 * Base values are captured once per material in userData.
 */
interface FadeData {
  baseOpacity: number;
  baseTransparent: boolean;
  baseDepthWrite: boolean;
}

function capture(m: THREE.Material): FadeData {
  let d = m.userData.fade as FadeData | undefined;
  if (!d) {
    const uni = (m as THREE.ShaderMaterial).uniforms;
    d = {
      baseOpacity: uni?.uOpacity ? (uni.uOpacity.value as number) : m.opacity,
      baseTransparent: m.transparent,
      baseDepthWrite: m.depthWrite,
    };
    m.userData.fade = d;
  }
  return d;
}

function applyMaterial(m: THREE.Material, a: number): void {
  const d = capture(m);
  const uni = (m as THREE.ShaderMaterial).uniforms;
  if (uni?.uOpacity) {
    uni.uOpacity.value = d.baseOpacity * a;
    return;
  }
  if (a >= 0.999) {
    m.opacity = d.baseOpacity;
    m.transparent = d.baseTransparent;
    m.depthWrite = d.baseDepthWrite;
  } else {
    m.transparent = true;
    m.opacity = d.baseOpacity * a;
    m.depthWrite = d.baseDepthWrite && a > 0.75;
  }
}

/** Walk the tree applying level alpha × inherited component dim (`userData.dim`). */
export function applyOpacity(root: THREE.Object3D, levelAlpha: number): void {
  const walk = (o: THREE.Object3D, dim: number, hidden: boolean): void => {
    const d = typeof o.userData.dim === 'number' ? dim * (o.userData.dim as number) : dim;
    if (o.userData.noFade) return;
    const hide = hidden || o.userData.hidden === true;
    const mesh = o as THREE.Mesh;
    if (mesh.material) {
      const a = d * levelAlpha;
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => applyMaterial(m, a));
      else applyMaterial(mesh.material, a);
      o.visible = a > 0.01 && !hide;
    }
    for (const c of o.children) walk(c, d, hide);
  };
  walk(root, 1, false);
}

/** Dispose all GPU resources under a root, except shared (cached) textures. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) {
        if (v instanceof THREE.Texture && !v.userData.shared) v.dispose();
      }
      const uni = (m as THREE.ShaderMaterial).uniforms;
      if (uni) for (const u of Object.values(uni)) if (u.value instanceof THREE.Texture && !u.value.userData.shared) u.value.dispose();
      m.dispose();
    }
  });
}
