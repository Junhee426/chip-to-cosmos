import * as THREE from 'three';
import './styles/main.css';
import { LEVELS, type LevelId } from './app/navigation';
import { ScaleManager } from './app/scale-manager';
import { createStore, type Quality } from './app/state';
import { DESKTOP_POLICY, GRAPHICS_PRESETS, MOBILE_POLICY, QualityController, detectInitialQuality, getRenderDpr, readDeviceSignals, tierCeiling, type GraphicsConfig } from './app/quality';
import { CameraRig } from './graphics/camera';
import { LabelLayer } from './graphics/labels';
import { createLighting } from './graphics/lighting';
import { PostFX } from './graphics/postprocessing';
import { FrameStats } from './graphics/perf';
import { backgroundTexture } from './graphics/textures';
import { createStars } from './graphics/earth';
import type { BaseLevel, LevelContext } from './scenes/base';
import { Hud } from './ui/hud';
import { Intro } from './ui/intro';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const QUALITY_PARAM = new Set(['auto', 'high', 'balanced', 'performance']);

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  if (!hasWebGL()) {
    app.innerHTML = '<div class="nogl">WebGL is required for Chip to Cosmos.</div>';
    return;
  }
  const params = new URLSearchParams(location.search);
  const store = createStore();
  store.set({ cutaway: true });

  // ---- graphics tier: device signals → initial estimate → runtime controller ----
  const signals = readDeviceSignals();
  const detected = detectInitialQuality(signals);
  const qp = params.get('quality');
  const mode = (qp && QUALITY_PARAM.has(qp) ? qp : 'auto') as Quality;
  store.set({ quality: mode });
  const quality = new QualityController(mode, detected, tierCeiling(signals), signals.coarsePointer || signals.width <= 768 ? MOBILE_POLICY : DESKTOP_POLICY);
  let cfg: GraphicsConfig = quality.config();

  const renderer = new THREE.WebGLRenderer({ antialias: cfg.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = cfg.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.info.autoReset = false; // count all passes of a frame (scene + shadow + post)
  app.append(renderer.domElement);
  renderer.domElement.classList.add('gl');

  const scene = new THREE.Scene();
  scene.background = backgroundTexture();
  const rig = new CameraRig(renderer.domElement, innerWidth / innerHeight);
  if (signals.coarsePointer) {
    // touch: calmer camera, pan disabled (pinch = zoom, one finger = orbit)
    rig.controls.rotateSpeed = 0.65;
    rig.controls.zoomSpeed = 0.6;
    rig.controls.enablePan = false;
    rig.controls.dampingFactor = 0.08;
  }
  const lighting = createLighting(scene, renderer);
  const stars = createStars();
  scene.add(stars);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  app.append(overlay);
  const labels = new LabelLayer(overlay);
  const post = new PostFX(renderer, scene, rig.camera, innerWidth, innerHeight, cfg.antialias ? 4 : 0);

  const ctx: LevelContext = { labels, sunDir: lighting.sunDir, store, quality: 'balanced', select: (id) => store.set({ selected: id }) };
  const mgr = new ScaleManager(scene, rig, ctx, store);
  const navigate = (id: LevelId) => {
    if (intro.running) return;
    void mgr.goTo(id);
  };

  // ---- safe viewport: camera principal point + callout columns follow the free area ----
  const view = { x: 0, y: 0, tx: 0, ty: 0 };
  let hudReady = false;
  const layout = () => {
    if (!hudReady) return; // the HUD reports layout while it is still being constructed
    const ins = hud.insets();
    labels.insets = ins;
    labels.maxLabels = hud.isMobile ? 4 : Infinity;
    const cx = (ins.left + innerWidth - ins.right) / 2;
    const cy = (ins.top + innerHeight - ins.bottom) / 2;
    view.tx = cx - innerWidth / 2;
    view.ty = cy - innerHeight / 2;
  };
  const applyView = () => {
    const cam = rig.camera;
    cam.setViewOffset(innerWidth, innerHeight, -view.x, -view.y, innerWidth, innerHeight);
  };

  const hud = new Hud(app, store, {
    navigate,
    back: () => {
      const p = LEVELS[store.get().level].parent;
      if (store.get().selected) store.set({ selected: null });
      else if (p) navigate(p);
    },
    layout,
    replayIntro: () => void intro.play(),
    componentInfo: (id) => mgr.current?.components.find((c) => c.id === id) ?? null,
  });
  hudReady = true;
  const intro = new Intro(app, mgr, rig, store, () => {
    try {
      localStorage.setItem('c2c.introSeen', '1');
    } catch {
      /* storage unavailable */
    }
  });

  // ---- apply a graphics configuration (decoration first; content never removed) ----
  const applyGraphics = (g: GraphicsConfig) => {
    cfg = g;
    renderer.setPixelRatio(getRenderDpr(g, devicePixelRatio));
    lighting.setShadowQuality(g.shadows ? g.shadowMapSize : 0);
    renderer.shadowMap.enabled = g.shadows;
    lighting.setEnvironmentResolution(g.environmentResolution);
    post.enabled = g.bloom;
    post.setSamples(g.antialias && g.bloom ? 4 : 0);
    post.setFinish(g.cinematicEffects);
    post.setSize(innerWidth, innerHeight);
    labels.density = g.labelDensity;
    stars.geometry.setDrawRange(0, Math.round(5000 * Math.max(0.3, g.particles)));
    for (const l of mgr.levelsBuilt()) l.applyGraphics(g);
    hud.setQualityState(store.get().quality, quality.tier, quality.step);
  };

  // ---- level preparation: labels, static merge, graphics, shader pre-warm ----
  mgr.onLevelBuilt = (lvl) => lvl.registerLabels((id) => {
    const c = lvl.components.find((k) => k.id === id);
    if (store.get().selected === id && c?.child) navigate(c.child);
    else store.set({ selected: id });
  });
  mgr.prepare = async (lvl: BaseLevel) => {
    lvl.optimize();
    lvl.applyGraphics(cfg);
    // compile every program variant the level will need (opaque, faded, cutaway toggled)
    // so zoom transitions and toggles never stall on a shader link
    const st = store.get();
    const compile = () => {
      lvl.root.visible = true;
      // compileAsync only helps with KHR_parallel_shader_compile; otherwise compile synchronously now
      const p = renderer.extensions.has('KHR_parallel_shader_compile') ? renderer.compileAsync(lvl.root, rig.camera, scene) : Promise.resolve(renderer.compile(lvl.root, rig.camera, scene));
      lvl.root.visible = false;
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
      /* compileAsync unsupported: programs compile lazily */
    }
  };
  mgr.onArrive = (id) => {
    lighting.fitShadow(mgr.current ? mgr.current.radius * 2.2 : 10);
    const url = new URL(location.href);
    url.searchParams.set('level', id);
    if (history.state?.level !== id) history.pushState({ level: id }, '', url);
  };
  addEventListener('popstate', (e) => {
    const id = (e.state as { level?: LevelId } | null)?.level;
    if (id && id in LEVELS && id !== store.get().level) navigate(id);
  });

  // ---- state → scene ----
  store.subscribe((s, c) => {
    const lvl = mgr.current;
    if (c.has('mode')) for (const l of mgr.levelsBuilt()) if (l.root.visible) l.setMode(s.mode);
    if (c.has('explode') && lvl && !s.transitioning) lvl.setExplode(s.explode);
    if (c.has('cutaway')) for (const l of mgr.levelsBuilt()) l.setCutaway(s.cutaway);
    if (c.has('quality')) {
      quality.setMode(s.quality, detected, performance.now() / 1000);
      applyGraphics(quality.config());
    }
    if (c.has('labels')) labels.enabled = s.labels;
    if (c.has('selected')) {
      labels.highlight(s.selected);
      if (s.selected) keepInView(s.selected);
    }
    if (c.has('params') || c.has('mode')) for (const l of mgr.levelsBuilt()) l.onState(s, c);
  });

  /** If the selected part projects outside the safe viewport (e.g. behind the sheet), re-centre on it. */
  const keepInView = (id: string) => {
    const c = mgr.current?.components.find((k) => k.id === id);
    if (!c || rig.flying || mgr.isBusy) return;
    const box = new THREE.Box3().setFromObject(c.object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const p = center.clone().project(rig.camera);
    const sx = (p.x * 0.5 + 0.5) * innerWidth;
    const sy = (-p.y * 0.5 + 0.5) * innerHeight;
    const ins = labels.insets;
    if (sx > ins.left && sx < innerWidth - ins.right && sy > ins.top && sy < innerHeight - ins.bottom && p.z < 1) return;
    const shift = center.clone().sub(rig.controls.target);
    void rig.flyTo({ pos: rig.camera.position.clone().add(shift), target: center }, 0.7);
  };

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  let lastPointer = 'mouse';
  const pickAt = (e: MouseEvent): string | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, rig.camera);
    return mgr.pick(ray);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    // tap = select; drags, pinches and multi-touch never select or navigate
    const slop = e.pointerType === 'touch' ? 10 : 5;
    if (!down || !e.isPrimary || Math.hypot(e.clientX - down.x, e.clientY - down.y) > slop || intro.running) return;
    store.set({ selected: pickAt(e) });
  });
  renderer.domElement.addEventListener('dblclick', (e) => {
    // mouse only: on touch, entering a child scale is an explicit button (Internal view)
    if (intro.running || lastPointer !== 'mouse') return;
    const id = pickAt(e);
    const c = id ? mgr.current?.components.find((k) => k.id === id) : null;
    if (c?.child) navigate(c.child);
  });
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (e.pointerType !== 'mouse' || now - hoverT < 80 || e.buttons) return;
    hoverT = now;
    renderer.domElement.style.cursor = pickAt(e) ? 'pointer' : 'grab';
  });

  // ---- perf overlay (dev) ----
  const stats = new FrameStats(600);
  let perfOn = params.has('perf');
  hud.perf.hidden = !perfOn;
  const frameInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  const logRendererInfo = () =>
    console.table({ ...frameInfo, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 });

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
    } else if (e.key === 'p' || e.key === 'P') {
      perfOn = !perfOn;
      hud.perf.hidden = !perfOn;
      if (perfOn) logRendererInfo();
    }
  });

  // ---- resize ----
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(getRenderDpr(cfg, devicePixelRatio));
    rig.camera.aspect = innerWidth / innerHeight;
    post.setSize(innerWidth, innerHeight);
    layout();
    view.x = view.tx;
    view.y = view.ty;
    applyView();
    quality.reset(performance.now() / 1000);
  };
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => quality.reset(performance.now() / 1000));
  resize();
  applyGraphics(cfg);

  // ---- start ----
  let seen = false;
  try {
    seen = localStorage.getItem('c2c.introSeen') === '1';
  } catch {
    /* ignore */
  }
  const startLevel = params.get('level') as LevelId | null;
  const first = startLevel && startLevel in LEVELS ? startLevel : 'satellite';
  history.replaceState({ level: first }, '', location.href);
  await mgr.jumpTo(first);
  document.body.classList.add('ready');
  const splash = document.querySelector('.splash');
  setTimeout(() => splash?.remove(), 1000); // do not keep a transparent full-screen layer around
  if (!seen && !startLevel && !params.has('nointro')) void intro.play();

  // ---- loop ----
  const timer = new THREE.Timer();
  timer.connect(document);
  let suggested = false;
  let perfT = 0;
  const loop = (ts?: number) => {
    timer.update(ts);
    const raw = Math.max(timer.getDelta(), 0);
    const dt = Math.min(raw, 0.1);
    renderer.info.reset();
    // ease the principal-point shift when the sheet / panels change
    if (Math.abs(view.x - view.tx) > 0.3 || Math.abs(view.y - view.ty) > 0.3) {
      view.x += (view.tx - view.x) * Math.min(1, dt * 8);
      view.y += (view.ty - view.y) * Math.min(1, dt * 8);
      applyView();
    }
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
    Object.assign(frameInfo, renderer.info.render);

    // ---- measurement & adaptive quality ----
    const now = performance.now() / 1000;
    if (raw > 0) stats.push(raw * 1000);
    if (mgr.transition || mgr.isBusy || document.hidden) quality.reset(now);
    else if (raw > 0) {
      const act = quality.feed(raw, now);
      if (act) {
        applyGraphics(quality.config());
        stats.clear();
      }
      if (quality.suggestLower && !suggested) {
        suggested = true;
        hud.toast('Rendering is slow at this quality.', { label: 'Use Auto', run: () => store.set({ quality: 'auto' }) });
      }
    }
    if (perfOn && now - perfT > 0.5) {
      perfT = now;
      const m = stats.summary();
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      hud.perf.textContent =
        `${m.fps.toFixed(0)} fps · avg ${m.avgMs.toFixed(1)} ms · p95 ${m.p95Ms.toFixed(1)} · p99 ${m.p99Ms.toFixed(1)}\n` +
        `σ ${m.stdMs.toFixed(1)} ms · >16.7 ${(m.over16 * 100).toFixed(0)}% · >33.3 ${(m.over33 * 100).toFixed(0)}% · long ${stats.longFrames} · max ${stats.maxMs.toFixed(0)} ms\n` +
        `calls ${frameInfo.calls} · tris ${(frameInfo.triangles / 1000).toFixed(0)}k · geo ${renderer.info.memory.geometries} · tex ${renderer.info.memory.textures} · prog ${renderer.info.programs?.length ?? 0}\n` +
        `${st.quality}→${quality.tier}${quality.step ? ` −${quality.step}` : ''} · dpr ${renderer.getPixelRatio().toFixed(2)} · shadows ${cfg.shadows ? cfg.shadowMapSize : 'off'} · bloom ${cfg.bloom ? 'on' : 'off'}` +
        (mem ? ` · heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
    }
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as { c2c: unknown }).c2c = {
    store, mgr, rig, scene, renderer, quality, stats, hud,
    frameInfo: () => ({ ...frameInfo }),
    config: () => ({ ...cfg }),
    presets: GRAPHICS_PRESETS,
    detected,
  };
}

void boot();
