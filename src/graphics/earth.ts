import * as THREE from 'three';

/**
 * Procedural Earth: fBm continents on the unit sphere, specular ocean glint,
 * soft terminator, night-side city lights, animated cloud shell and a
 * Fresnel atmosphere. Fully shader-generated (no texture assets).
 */
const noise = /* glsl */ `
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5; float s = 0.0; for(int i=0;i<6;i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

export interface EarthOptions {
  radius: number;
  /** atmosphere glow strength */
  glow?: number;
  segments?: number;
  sunDir: THREE.Vector3;
}

export function createEarth(o: EarthOptions): { group: THREE.Group; update: (t: number) => void; setOpacity: (a: number) => void; uniforms: { uSun: { value: THREE.Vector3 } } } {
  const group = new THREE.Group();
  const seg = o.segments ?? 160;
  const uSun = { value: o.sunDir.clone().normalize() };

  const surface = new THREE.ShaderMaterial({
    uniforms: { uSun, uOpacity: { value: 1 } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vObjN; varying vec3 vView;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){
        vObjN = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uOpacity;
      varying vec3 vN; varying vec3 vObjN; varying vec3 vView;
      #include <logdepthbuf_pars_fragment>
      ${noise}
      void main(){
        #include <logdepthbuf_fragment>
        vec3 p = vObjN * 2.2;
        float h = fbm(p + fbm(p * 1.3) * 0.6);
        float land = smoothstep(0.52, 0.56, h);
        float lat = abs(vObjN.y);
        float ice = smoothstep(0.82, 0.9, lat + (h - 0.5) * 0.25);
        float d = fbm(p * 5.0);
        vec3 ocean = mix(vec3(0.012, 0.045, 0.10), vec3(0.03, 0.10, 0.19), smoothstep(0.3, 0.52, h));
        vec3 green = vec3(0.07, 0.11, 0.06);
        vec3 desert = vec3(0.30, 0.25, 0.17);
        float arid = smoothstep(0.45, 0.62, d) * (1.0 - smoothstep(0.35, 0.6, lat));
        vec3 terrain = mix(green, desert, arid) * (0.75 + 0.5 * d);
        vec3 col = mix(ocean, terrain, land);
        col = mix(col, vec3(0.82, 0.86, 0.9), ice);
        float ndl = dot(normalize(vN), uSun);
        float day = smoothstep(-0.12, 0.25, ndl);
        vec3 lit = col * (0.03 + 1.0 * max(ndl, 0.0));
        vec3 h2 = normalize(uSun + vView);
        float spec = pow(max(dot(normalize(vN), h2), 0.0), 220.0) * (1.0 - land) * (1.0 - ice);
        lit += vec3(1.0, 0.92, 0.8) * spec * 0.55 * day;
        float city = smoothstep(0.62, 0.8, fbm(vObjN * 40.0)) * land * (1.0 - ice) * (1.0 - smoothstep(0.55, 0.7, d));
        vec3 night = vec3(1.0, 0.72, 0.38) * city * 0.55 * (1.0 - day);
        vec3 c = lit * day + night;
        float rim = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
        c += vec3(0.25, 0.5, 1.0) * rim * 0.45 * smoothstep(-0.3, 0.4, ndl);
        gl_FragColor = vec4(c, uOpacity);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(o.radius, seg, seg / 2), surface);
  group.add(earth);

  const clouds = new THREE.ShaderMaterial({
    uniforms: { uSun, uTime: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vObjN;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vObjN = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime; uniform float uOpacity; varying vec3 vN; varying vec3 vObjN;
      #include <logdepthbuf_pars_fragment>
      ${noise}
      void main(){
        #include <logdepthbuf_fragment>
        vec3 p = vObjN * 3.2 + vec3(uTime * 0.01, 0.0, 0.0);
        float c = smoothstep(0.55, 0.78, fbm(p + fbm(p * 2.0) * 0.8));
        float ndl = dot(normalize(vN), uSun);
        float light = 0.03 + 0.95 * smoothstep(-0.1, 0.4, ndl);
        gl_FragColor = vec4(vec3(0.85, 0.88, 0.92) * light, c * 0.6 * uOpacity);
      }`,
  });
  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius * 1.008, seg, seg / 2), clouds);
  group.add(cloudMesh);

  const atmo = new THREE.ShaderMaterial({
    uniforms: { uSun, uOpacity: { value: 1 }, uGlow: { value: o.glow ?? 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vView;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uOpacity; uniform float uGlow; varying vec3 vN; varying vec3 vView;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        float f = pow(clamp(1.0 + dot(vView, normalize(vN)) * 1.0, 0.0, 1.0), 2.2);
        float s = smoothstep(-0.35, 0.5, dot(normalize(-vN), uSun));
        float edge = smoothstep(0.0, 0.25, 1.0 - abs(dot(vView, normalize(vN))));
        gl_FragColor = vec4(vec3(0.28, 0.55, 1.0) * f * (0.15 + 1.1 * s) * edge * uGlow, uOpacity);
      }`,
  });
  const atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius * (o.glow !== undefined && o.glow < 1 ? 1.02 : 1.028), 96, 48), atmo);
  group.add(atmoMesh);

  return {
    group,
    uniforms: { uSun },
    setOpacity: (a: number) => {
      surface.uniforms.uOpacity.value = a;
      clouds.uniforms.uOpacity.value = a;
      atmo.uniforms.uOpacity.value = a;
      surface.depthWrite = a > 0.95;
    },
    update: (t: number) => {
      clouds.uniforms.uTime.value = t;
      cloudMesh.rotation.y = t * 0.004;
    },
  };
}

/** Star field on a large sphere; follows the camera so it reads as infinitely far. */
export function createStars(count = 5000, radius = 2000): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([radius * s * Math.cos(th), radius * u, radius * s * Math.sin(th)], i * 3);
    const temp = rnd();
    const b = 0.35 + Math.pow(rnd(), 3) * 0.9;
    col.set([b * (0.8 + 0.2 * temp), b * 0.88, b * (1.0 - 0.2 * temp + 0.1)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -10;
  return p;
}
