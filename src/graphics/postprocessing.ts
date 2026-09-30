import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Subtle vignette + film grain to finish the cinematic look. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 0.85, length(d) * 1.2);
      float g = (hash(vUv * 1024.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(c.rgb * v + g, c.a);
    }`,
};

/**
 * Restrained post-processing: bloom only picks up genuinely emissive
 * elements (threshold high, strength low) — no neon wash.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private finish: ShaderPass;
  enabled = true;
  private samples: number;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, samples = 4) {
    // MSAA on the HDR target: canvas antialiasing does not apply once the composer renders off-screen
    this.samples = samples;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
  }

  /** 0 disables MSAA (performance tier). */
  setSamples(n: number): void {
    if (n === this.samples) return;
    this.samples = n;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      t.samples = n;
      t.dispose();
    }
  }

  /** Vignette + grain are decorative. */
  setFinish(on: boolean): void {
    this.finish.enabled = on;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    if (this.enabled) {
      this.finish.uniforms.uTime.value = time % 100;
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }
}
