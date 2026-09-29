import * as THREE from 'three';
import { glowSprite } from './textures';

const vert = /* glsl */ `
  attribute float aPhase;
  uniform float uSize; uniform float uScale;
  varying float vAlpha;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale * (300.0 / max(-mv.z, 1e-6));
    vAlpha = aPhase;
  }`;
const frag = /* glsl */ `
  uniform sampler2D uTex; uniform vec3 uColor; uniform float uOpacity;
  varying float vAlpha;
  void main(){
    vec4 t = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(uColor * 1.6, t.a * uOpacity * vAlpha);
  }`;

export function pointsMaterial(color: THREE.ColorRepresentation, size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: glowSprite() },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uSize: { value: size },
      uScale: { value: 1 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const _s = new THREE.Vector3();

/** Keeps point sprites the right world size when the level root is scaled during transitions. */
export function syncPointScale(points: THREE.Points): void {
  points.getWorldScale(_s);
  (points.material as THREE.ShaderMaterial).uniforms.uScale.value = _s.x;
}

/**
 * Directional flow along a 3D path: glowing particles + a faint guide tube.
 * Used for SIGNAL / POWER / THERMAL paths and carrier motion.
 */
export class FlowPath {
  readonly group = new THREE.Group();
  private curve: THREE.Curve<THREE.Vector3>;
  private points: THREE.Points;
  private offsets: Float32Array;
  private speed: number;
  private tubeMat: THREE.MeshBasicMaterial;
  private active = false;
  private alpha = 1;
  rate = 1;

  constructor(pts: THREE.Vector3[] | THREE.Curve<THREE.Vector3>, opts: { color: THREE.ColorRepresentation; count?: number; size?: number; speed?: number; tube?: number; closed?: boolean }) {
    this.curve = Array.isArray(pts) ? new THREE.CatmullRomCurve3(pts, opts.closed ?? false, 'catmullrom', 0.1) : pts;
    const count = opts.count ?? 40;
    this.speed = opts.speed ?? 0.25;
    this.offsets = new Float32Array(count);
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.offsets[i] = i / count;
      phase[i] = 0.55 + 0.45 * ((i * 7919) % 13) / 13;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.points = new THREE.Points(geo, pointsMaterial(opts.color, opts.size ?? 0.12));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    const tubeR = opts.tube ?? 0;
    this.tubeMat = new THREE.MeshBasicMaterial({ color: opts.color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    if (tubeR > 0) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 160, tubeR, 6, opts.closed ?? false), this.tubeMat);
      this.group.add(tube);
    }
    this.group.userData.noFade = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.tubeMat.opacity = 0;
    this.group.visible = false;
  }

  setActive(on: boolean): void {
    this.active = on;
  }

  setLevelAlpha(a: number): void {
    this.alpha = a;
  }

  update(dt: number): void {
    const target = this.active ? 1 : 0;
    const mat = this.points.material as THREE.ShaderMaterial;
    const cur = mat.uniforms.uOpacity.value as number;
    const next = cur + (target * this.alpha - cur) * Math.min(1, dt * 5 + (dt === 0 ? 1 : 0));
    mat.uniforms.uOpacity.value = next;
    this.tubeMat.opacity = 0.16 * next;
    this.group.visible = next > 0.01;
    if (!this.group.visible) return;
    syncPointScale(this.points);
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.offsets.length; i++) {
      this.offsets[i] = (((this.offsets[i] + dt * this.speed * this.rate) % 1) + 1) % 1;
      const p = this.curve.getPointAt(this.offsets[i], _s);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }
}
