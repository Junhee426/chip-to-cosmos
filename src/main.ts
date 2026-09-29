import * as THREE from 'three';
import './styles/main.css';
import { LEVELS, type LevelId } from './app/navigation';
import { ScaleManager } from './app/scale-manager';
import { createStore, type Quality } from './app/state';
import { CameraRig } from './graphics/camera';
import { LabelLayer } from './graphics/labels';
import { createLighting } from './graphics/lighting';
import { PostFX } from './graphics/postprocessing';
import { backgroundTexture } from './graphics/textures';
import { createStars } from './graphics/earth';
import type { LevelContext } from './scenes/base';
import { Hud } from './ui/hud';
import { Intro } from './ui/intro';

const QUALITY: Record<Quality, { dpr: number; shadow: number; bloom: boolean }> = {
  high: { dpr: 2, shadow: 2048, bloom: true },
  balanced: { dpr: 1.5, shadow: 1024, bloom: true },
  performance: { dpr: 1, shadow: 0, bloom: false },
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  if (!hasWebGL()) {
    app.innerHTML = '<div class="nogl">WebGL is required for Chip to Cosmos.</div>';
    return;
  }
  const store = createStore();
  store.set({ cutaway: true });

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  app.append(renderer.domElement);
  renderer.domElement.classList.add('gl');

  const scene = new THREE.Scene();
  scene.background = backgroundTexture();
  const rig = new CameraRig(renderer.domElement, innerWidth / innerHeight);
  const lighting = createLighting(scene, renderer);
  const stars = createStars();
  scene.add(stars);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  app.append(overlay);
  const labels = new LabelLayer(overlay);
  const post = new PostFX(renderer, scene, rig.camera, innerWidth, innerHeight);

  const ctx: LevelContext = {
    labels,
    sunDir: lighting.sunDir,
    store,
    quality: store.get().quality,
    select: (id) => store.set({ selected: id }),
  };
  const mgr = new ScaleManager(scene, rig, ctx, store);
  const navigate = (id: LevelId) => {
    if (intro.running) return;
    void mgr.goTo(id);
  };
  mgr.onLevelBuilt = (lvl) => lvl.registerLabels((id) => {
    const c = lvl.components.find((k) => k.id === id);
    if (store.get().selected === id && c?.child) navigate(c.child);
    else store.set({ selected: id });
  });
  mgr.onArrive = (id) => {
    lighting.fitShadow(LEVELS[id] && mgr.current ? mgr.current.radius * 2.2 : 10);
  };

  const hud = new Hud(app, store, {
    navigate,
    replayIntro: () => void intro.play(),
    componentInfo: (id) => mgr.current?.components.find((c) => c.id === id) ?? null,
  });
  const intro = new Intro(app, mgr, rig, store, () => {
    try {
      localStorage.setItem('c2c.introSeen', '1');
    } catch {
      /* storage unavailable */
    }
  });

  // ---- state → scene ----
  let dprCap = QUALITY[store.get().quality].dpr;
  const applyQuality = (q: Quality) => {
    const Q = QUALITY[q];
    dprCap = Q.dpr;
    renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    lighting.setShadowQuality(Q.shadow);
    renderer.shadowMap.enabled = Q.shadow > 0;
    post.enabled = Q.bloom;
    post.setSize(innerWidth, innerHeight);
  };
  store.subscribe((s, c) => {
    const lvl = mgr.current;
    if (c.has('mode')) for (const l of mgr.levelsBuilt()) if (l.root.visible) l.setMode(s.mode);
    if (c.has('explode') && lvl && !s.transitioning) lvl.setExplode(s.explode);
    if (c.has('cutaway')) for (const l of mgr.levelsBuilt()) l.setCutaway(s.cutaway);
    if (c.has('quality')) applyQuality(s.quality);
    if (c.has('labels')) labels.enabled = s.labels;
    if (c.has('selected')) labels.highlight(s.selected);
    if (c.has('params') || c.has('mode')) for (const l of mgr.levelsBuilt()) l.onState(s, c);
  });
  applyQuality(store.get().quality);

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const pickAt = (e: MouseEvent): string | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, rig.camera);
    return mgr.pick(ray);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || intro.running) return;
    store.set({ selected: pickAt(e) });
  });
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (intro.running) return;
    const id = pickAt(e);
    const c = id ? mgr.current?.components.find((k) => k.id === id) : null;
    if (c?.child) navigate(c.child);
  });
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - hoverT < 60 || e.buttons) return;
    hoverT = now;
    renderer.domElement.style.cursor = pickAt(e) ? 'pointer' : 'grab';
  });

  // ---- keyboard ----
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (intro.running) {
      if (e.key === 'Escape' || e.key === ' ') void intro.skip();
      return;
    }
    const s = store.get();
    if (e.key === 'Escape' || e.key === 'Backspace') {
      const p = LEVELS[s.level].parent;
      if (s.selected) store.set({ selected: null });
      else if (p) navigate(p);
    } else if (e.key === 'Enter' && s.selected) {
      const c = mgr.current?.components.find((k) => k.id === s.selected);
      if (c?.child) navigate(c.child);
    } else if ('12345'.includes(e.key) && e.key.length === 1) {
      store.set({ mode: (['structure', 'signal', 'power', 'thermal', 'radiation'] as const)[Number(e.key) - 1] });
    } else if (e.key === 'e' || e.key === 'E') {
      store.set({ explode: s.explode > 0.5 ? 0 : 1 });
    } else if (e.key === 'c' || e.key === 'C') {
      store.set({ cutaway: !s.cutaway });
    } else if (e.key === 'l' || e.key === 'L') {
      store.set({ labels: !s.labels });
    }
  });

  // ---- resize ----
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    rig.camera.aspect = innerWidth / innerHeight;
    rig.camera.updateProjectionMatrix();
    post.setSize(innerWidth, innerHeight);
    const narrow = innerWidth < 900;
    labels.insets = narrow ? { left: 12, right: 12, top: 70, bottom: innerHeight * 0.48 } : { left: 236, right: 404, top: 84, bottom: 150 };
    // shift the projection centre so the subject sits in the free area between rail and panel
    const shiftPx = narrow ? 0 : (404 - 236) / 2;
    const cam = rig.camera;
    cam.filmOffset = (shiftPx / innerWidth) * cam.getFilmWidth() * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
    cam.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  // ---- start ----
  let seen = false;
  try {
    seen = localStorage.getItem('c2c.introSeen') === '1';
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams(location.search);
  const startLevel = params.get('level') as LevelId | null;
  await mgr.jumpTo(startLevel && startLevel in LEVELS ? startLevel : 'satellite');
  document.body.classList.add('ready');
  if (!seen && !startLevel && !params.has('nointro')) void intro.play();

  // ---- loop with adaptive pixel ratio ----
  const timer = new THREE.Timer();
  timer.connect(document);
  let frames = 0;
  let acc = 0;
  let slow = 0;
  let adaptiveScale = 1;
  const loop = (ts?: number) => {
    timer.update(ts);
    const dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
    rig.update(dt);
    mgr.update(dt);
    stars.position.copy(rig.camera.position);
    stars.scale.setScalar((rig.camera.far * 0.45) / 2000);
    const st = store.get();
    const spaceLevel = st.level === 'cosmos' || st.level === 'satellite' || st.level === 'array' || (mgr.transition && ['cosmos', 'satellite'].includes(mgr.transition.from));
    const sm = stars.material as THREE.PointsMaterial;
    sm.opacity += ((spaceLevel ? 0.9 : 0.12) - sm.opacity) * Math.min(1, dt * 2);
    labels.update(rig.camera, innerWidth, innerHeight);
    hud.setScale(mgr.viewWidthMeters(rig.camera.aspect), innerWidth, st.level, !!mgr.transition);
    post.render(scene, rig.camera, timer.getElapsed());
    // adaptive quality: lower pixel ratio when frame time stays high
    frames++;
    acc += dt;
    if (acc >= 1) {
      const fps = frames / acc;
      hud.fps.textContent = `${fps.toFixed(0)} fps`;
      slow = fps < 38 ? slow + 1 : Math.max(0, slow - 1);
      if (slow >= 3 && adaptiveScale > 0.6) {
        adaptiveScale -= 0.15;
        renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap) * adaptiveScale);
        post.setSize(innerWidth, innerHeight);
        slow = 0;
      } else if (fps > 57 && adaptiveScale < 1) {
        adaptiveScale = Math.min(1, adaptiveScale + 0.05);
        renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap) * adaptiveScale);
        post.setSize(innerWidth, innerHeight);
      }
      frames = 0;
      acc = 0;
    }
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as { c2c: unknown }).c2c = { store, mgr, rig, scene, renderer };
}

void boot();
