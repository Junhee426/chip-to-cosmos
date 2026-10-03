import * as THREE from 'three';
import type { AppState } from '../app/state';
import type { BaseLevel } from '../scenes/base';

/**
 * Three.js r163+ removed WebGL 1 support from WebGLRenderer, so WebGL 2 is a hard
 * requirement (not a preference). Check it explicitly before creating the renderer.
 */
export type WebGLSupport = { ok: true } | { ok: false; reason: 'no-webgl2' | 'context-failed' };

export function checkWebGL2(): WebGLSupport {
  try {
    const c = document.createElement('canvas');
    if (typeof WebGL2RenderingContext === 'undefined') return { ok: false, reason: 'no-webgl2' };
    const gl = c.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'context-failed' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'context-failed' };
  }
}

export function showUnsupported(app: HTMLElement, s: { reason: 'no-webgl2' | 'context-failed' }): void {
  const why =
    s.reason === 'no-webgl2'
      ? 'This browser does not support WebGL 2.'
      : 'This browser supports WebGL 2, but a WebGL 2 context could not be created (often because hardware acceleration is disabled or the GPU is blocklisted).';
  app.innerHTML = `
    <div class="nogl" role="alert">
      <h1>Chip to Cosmos needs WebGL 2</h1>
      <p>${why}</p>
      <ul>
        <li><b>Update your browser</b> — current Chrome, Edge, Firefox and Safari (15+) all support WebGL 2.</li>
        <li><b>Enable hardware acceleration</b> — Chrome/Edge: Settings → System → “Use graphics acceleration when available”, then restart the browser.</li>
        <li><b>Check the GPU driver</b> — visit <code>chrome://gpu</code> (or <code>about:support</code> in Firefox) and look for “WebGL2: Hardware accelerated”.</li>
      </ul>
    </div>`;
}

export function createRenderer(antialias: boolean): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.info.autoReset = false; // count all passes of a frame (scene + shadow + post)
  renderer.domElement.classList.add('gl');
  return renderer;
}

/**
 * Compile every program variant a level will need (opaque, faded, cutaway toggled)
 * before it is ever shown, so zoom transitions and toggles never stall on a shader link.
 */
export async function prewarmLevel(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, lvl: BaseLevel, st: AppState): Promise<void> {
  const compile = () => {
    lvl.root.visible = true;
    // objects hidden until a mode or state shows them (beam, footprints, grating lobes)
    // are compiled too, so they never stall the frame in which they first appear
    const hidden: THREE.Object3D[] = [];
    lvl.root.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const restore = () => hidden.forEach((o) => (o.visible = false));
    // compileAsync only helps with KHR_parallel_shader_compile; otherwise compile synchronously now
    let p: Promise<unknown>;
    try {
      p = renderer.extensions.has('KHR_parallel_shader_compile') ? renderer.compileAsync(lvl.root, camera, scene) : Promise.resolve(renderer.compile(lvl.root, camera, scene));
    } finally {
      restore();
      lvl.root.visible = false;
    }
    return p;
  };
  try {
    lvl.setLevelAlpha(0.5);
    lvl.update(0, st);
    await compile();
    lvl.setCutaway(!st.cutaway);
    await compile();
    lvl.setCutaway(st.cutaway);
    lvl.setLevelAlpha(1);
    lvl.update(0, st);
    await compile();
  } catch {
    /* programs then compile lazily on first use */
  }
}

/** prefers-reduced-motion → shorter, calmer transitions (never removed: they carry spatial meaning). */
export function reducedMotionScale(): number {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
}
