import * as THREE from 'three';

export interface Lighting {
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  setShadowQuality(size: number): void;
  fitShadow(radius: number): void;
}

/**
 * Cinematic studio lighting: warm key (the Sun), cool rim from behind,
 * low hemispheric fill, plus a dim PMREM room environment so metals have
 * something plausible to reflect.
 */
export function createLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Lighting {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = spaceStudio();
  const envTex = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.8;
  pmrem.dispose();
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });

  // key from upper-left so flat metal faces don't mirror it straight into the default camera views
  const sunDir = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
  key.position.copy(sunDir).multiplyScalar(40);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x7fa6ff, 1.1);
  rim.position.set(34, 10, -30);
  scene.add(rim);

  const fill = new THREE.HemisphereLight(0x5b7cb0, 0x0a0c12, 0.6);
  scene.add(fill);

  return {
    key,
    rim,
    fill,
    sunDir,
    setShadowQuality(size: number) {
      key.castShadow = size > 0;
      if (size > 0 && key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
    },
    fitShadow(radius: number) {
      const cam = key.shadow.camera;
      cam.left = cam.bottom = -radius;
      cam.right = cam.top = radius;
      cam.near = 0.1;
      cam.far = radius * 6;
      key.position.copy(sunDir).multiplyScalar(radius * 3);
      key.target.position.set(0, 0, 0);
      cam.updateProjectionMatrix();
    },
  };
}

/**
 * Dark "space studio" used only as a reflection source: near-black sky, a faint
 * blue earthshine from below and two soft rectangular light boxes that give
 * metals clean, controlled highlights instead of a bright room.
 */
function spaceStudio(): THREE.Scene {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float y = vP.y; vec3 top = vec3(0.010,0.013,0.022); vec3 hor = vec3(0.035,0.050,0.080); vec3 earth = vec3(0.10,0.16,0.26); vec3 c = y > 0.0 ? mix(hor, top, smoothstep(0.0,0.7,y)) : mix(hor, earth, smoothstep(0.0,-0.6,y)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  s.add(sky);
  const box = (w: number, h: number, color: number, intensity: number, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(16, 9, 0xfff1dc, 1.1, new THREE.Vector3(-24, 22, 18));
  box(12, 22, 0x8fb4ff, 0.5, new THREE.Vector3(30, 8, -20));
  return s;
}
