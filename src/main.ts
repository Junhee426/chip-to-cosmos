import * as THREE from 'three';
import './styles/main.css';
import { LEVELS, type LevelId } from './app/navigation';
import { ScaleManager } from './app/scale-manager';
import { beamSolution, calcStats } from './app/system';
import { createStore, type Quality } from './app/state';
import { GRAPHICS_PRESETS, detectInitialQuality, getRenderDpr, policyFor, readDeviceSignals, tierCeiling, type GraphicsConfig } from './app/quality';
import { CameraRig } from './graphics/camera';
import { LabelLayer } from './graphics/labels';
import { createLighting } from './graphics/lighting';
import { PostFX } from './graphics/postprocessing';
import { backgroundTexture } from './graphics/textures';
import { createStars } from './graphics/earth';
import type { LevelContext } from './scenes/base';
import { Hud } from './ui/hud';
import { Intro } from './ui/intro';
import { HeroDemo, type DemoMode, type DemoScreens } from './ui/hero-demo';
import { Poster } from './ui/poster';
import { POSTER_STATE } from './app/beam-presets';
import { PRESENTATION_LABELS, XRAY_TARGETS, type XrayKey } from './app/xray';
import { checkWebGL2, createRenderer, prewarmLevel, reducedMotionScale, showUnsupported } from './runtime/renderer';
import { RenderLoop } from './runtime/render-loop';
import { InputController, bindKeyboard } from './runtime/input-controller';
import { ViewportController } from './runtime/viewport-controller';
import { PerformanceController } from './runtime/performance-controller';

const QUALITY_PARAM = new Set(['auto', 'high', 'balanced', 'performance']);
const SPACE_LEVELS = new Set<LevelId>(['cosmos', 'satellite', 'array']);

/** Bootstrap & wiring only — behaviour lives in src/runtime, src/app, src/scenes and src/ui. */
async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const gl = checkWebGL2();
  if (!gl.ok) return showUnsupported(app, gl);

  const params = new URLSearchParams(location.search);
  const store = createStore();
  store.set({ cutaway: true });
  const motion = reducedMotionScale();

  // ---- graphics tier: device signals → initial estimate → runtime controller ----
  const signals = readDeviceSignals();
  const detected = detectInitialQuality(signals);
  const qp = params.get('quality');
  store.set({ quality: (qp && QUALITY_PARAM.has(qp) ? qp : 'auto') as Quality });
  const initialCfg = GRAPHICS_PRESETS[store.get().quality === 'auto' ? detected : (store.get().quality as keyof typeof GRAPHICS_PRESETS)];

  // ---- renderer, scene, camera ----
  const renderer = createRenderer(initialCfg.antialias);
  renderer.shadowMap.enabled = initialCfg.shadows;
  app.append(renderer.domElement);
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
  const post = new PostFX(renderer, scene, rig.camera, innerWidth, innerHeight, initialCfg.antialias ? 4 : 0);

  // ---- multiscale navigation ----
  const ctx: LevelContext = { labels, sunDir: lighting.sunDir, store, quality: 'balanced', select: (id) => store.set({ selected: id }), camera: rig.camera };
  const mgr = new ScaleManager(scene, rig, ctx, store);
  mgr.motionScale = motion;
  const navigate = (id: LevelId) => {
    if (intro.running) return;
    // any navigation request ends the demo first — it never traps the user — and its
    // destination is the final state (the demo does not restore its starting screen over it)
    if (demo.running) void demo.stop('navigate').then(() => mgr.goTo(id));
    else void mgr.goTo(id);
  };
  const back = () => {
    const s = store.get();
    const p = LEVELS[s.level].parent;
    if (s.presentation) explore();
    else if (s.selected) store.set({ selected: null });
    else if (p) navigate(p);
  };
  /** leave presentation mode: chrome returns, the scene and parameters stay as they are */
  const leavePresentation = () => {
    store.set({ presentation: false });
    poster.setView('hidden');
    for (const l of mgr.levelsBuilt()) l.setOrbitState({ paused: false });
  };
  /** "Explore freely": also ends a running demo, keeping its current results */
  const explore = () => {
    if (demo.running) void demo.stop('explore').then(leavePresentation);
    else leavePresentation();
  };
  const runDemo = (mode: DemoMode) => {
    if (intro.running) return;
    if (demo.running) void demo.skip().then(() => demo.play(mode));
    else void demo.play(mode);
  };
  const component = (id: string | null) => (id ? mgr.current?.components.find((c) => c.id === id) ?? null : null);

  // ---- viewport, HUD, intro ----
  let perf: PerformanceController | null = null;
  const viewport = new ViewportController(rig, labels, (w, h) => {
    renderer.setSize(w, h);
    renderer.setPixelRatio(perf ? perf.dpr() : getRenderDpr(initialCfg, devicePixelRatio));
    post.setSize(w, h);
  });
  const hud = new Hud(app, store, {
    navigate,
    back,
    layout: () => viewport.layout(),
    replayIntro: () => void intro.play(),
    componentInfo: (id) => component(id),
    components: () => mgr.current?.components.filter((c) => c.label !== false) ?? [],
    runBeamDemo: () => runDemo('quick'),
  });
  viewport.attach(hud);
  const intro = new Intro(app, mgr, rig, store, () => {
    try {
      localStorage.setItem('c2c.introSeen', '1');
    } catch {
      /* storage unavailable */
    }
  });

  const poster = new Poster(store, { runQuick: () => runDemo('quick'), runEngineering: () => runDemo('engineering'), runGrating: () => runDemo('grating'), explore });
  hud.mountPoster(poster.top, poster.bottom, poster.inset.el);
  poster.setView('hidden');
  /** Compose the Cosmos poster over the given state (the overlay appears only once Cosmos is current). */
  const composePoster: DemoScreens['poster'] = async ({ state, params, orbit, camera }) => {
    if (mgr.current?.id !== 'cosmos') await mgr.jumpTo('cosmos');
    const cosmos = mgr.current!;
    store.set({ mode: 'signal', selected: null, emphasis: null, ...state, presentation: true });
    store.setParams(params);
    cosmos.setOrbitState(orbit ? { ...orbit } : { time: 0, paused: true });
    poster.setView('poster');
    viewport.layout();
    await new Promise((r) => requestAnimationFrame(r));
    const v = camera ?? cosmos.demoView('poster');
    if (v) {
      rig.controls.minDistance = 0;
      rig.setView(v);
    }
    posterReframe.framed();
  };
  /** Compose the Satellite landing (the overlay appears only once the satellite is current). */
  const composeLanding: DemoScreens['landing'] = async ({ state, params, camera }) => {
    if (mgr.current?.id !== 'satellite') await mgr.jumpTo('satellite');
    store.set({ mode: 'signal', ...state, presentation: true });
    store.setParams(params);
    poster.setView('landing');
    viewport.layout();
    const v = camera ?? mgr.current?.demoView('opening');
    if (v) {
      rig.controls.maxDistance = Math.max(rig.controls.maxDistance, v.pos.distanceTo(v.target) * 1.1);
      rig.setView(v);
    }
  };
  const demo = new HeroDemo(mgr, rig, store, hud, poster, { poster: composePoster, landing: composeLanding, leavePresentation, layout: () => viewport.layout() }, motion, (mode) => {
    // quick demo ends on the interactive poster (Try it); the others hand over to free exploration
    if (mode === 'engineering') hud.toast('Now try it: STEER, ARRAY SIZE, SPACING, TAPER — or the Grating lobe experiment.', { label: 'Open Beam Lab', run: () => navigate('array') });
    if (mode === 'grating') hud.toast('Try it: move SPACING in BEAM LAB across the limit and back.', { label: 'Open Beam Lab', run: () => navigate('array') });
  });
  /** `?view=poster`: the reproducible signature frame (fixed state, fixed orbit position). */
  const showPoster = () => composePoster({ state: { mode: 'signal' }, params: POSTER_STATE, orbit: { time: 0, paused: true } });
  /** first screen: the real satellite scene behind a title and one call to action */
  const showLanding = () => composeLanding({ state: { mode: 'signal' }, params: { ...POSTER_STATE, steerDeg: 0 } });

  /**
   * Poster framing depends on the viewport. After a resize (window, visual viewport,
   * orientation) it is recomputed once the size has settled, never during a camera flight
   * or scale step, from the current orbit and parameters (nothing is reset).
   */
  const posterReframe = (() => {
    let pending = false;
    let last = 0;
    let size = '';
    const key = () => `${innerWidth}x${innerHeight}`;
    return {
      framed: () => {
        pending = false;
        size = key();
      },
      request: () => {
        pending = true;
        last = performance.now();
      },
      tick: () => {
        if (!pending || performance.now() - last < 150) return;
        if (poster.view !== 'poster') {
          if (!demo.running) pending = false;
          return;
        }
        if (rig.flying || mgr.isBusy || mgr.current?.id !== 'cosmos') return;
        pending = false;
        if (key() === size) return;
        viewport.layout();
        const v = mgr.current.demoView('poster');
        if (!v) return;
        rig.controls.minDistance = 0;
        rig.setView(v);
        size = key();
      },
    };
  })();

  // ---- performance: adaptive quality + overlay (decoration first; content never removed) ----
  perf = new PerformanceController(
    {
      renderer,
      apply: (g: GraphicsConfig) => {
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
      },
      report: (mode, tier, step) => hud.setQualityState(mode, tier, step),
      suggestAuto: () => {
        if (!store.get().presentation) hud.toast('Rendering is slow at this quality.', { label: 'Use Auto', run: () => store.set({ quality: 'auto' }) });
      },
    },
    store.get().quality,
    detected,
    tierCeiling(signals),
    policyFor(signals),
    hud.perf,
  );
  const perfCtl = perf;
  perfCtl.toggleOverlay(params.has('perf'));
  viewport.onResize = () => {
    perfCtl.pause();
    posterReframe.request();
  };
  document.addEventListener('visibilitychange', () => perfCtl.pause());

  // ---- level lifecycle: labels, static merge, graphics, shader pre-warm ----
  mgr.onLevelBuilt = (lvl) =>
    lvl.registerLabels((id) => {
      const c = lvl.components.find((k) => k.id === id);
      if (store.get().selected === id && c?.child) navigate(c.child);
      else store.set({ selected: id });
    });
  mgr.prepare = async (lvl) => {
    lvl.optimize();
    lvl.applyGraphics(perfCtl.cfg);
    await prewarmLevel(renderer, rig.camera, scene, lvl, store.get());
  };
  mgr.onArrive = (id) => {
    lighting.fitShadow(mgr.current ? mgr.current.radius * 2.2 : 10);
    const url = new URL(location.href);
    url.searchParams.set('level', id);
    if (history.state?.level !== id) history.pushState({ level: id }, '', url);
  };
  mgr.onError = (err, level) => {
    console.error(err);
    hud.toast(`Could not open ${level ? LEVELS[level].crumb : 'that scale'}. You are still at ${LEVELS[store.get().level].crumb}.`, level ? { label: 'Retry', run: () => navigate(level) } : undefined);
  };
  addEventListener('popstate', (e) => {
    const id = (e.state as { level?: LevelId } | null)?.level;
    if (id && id in LEVELS && id !== store.get().level) navigate(id);
  });

  // ---- state → scene ----
  store.subscribe((s, c) => {
    if (c.has('mode')) for (const l of mgr.levelsBuilt()) if (l.root.visible) l.setMode(s.mode);
    if (c.has('explode') && mgr.current && !s.transitioning) mgr.current.setExplode(s.explode);
    if (c.has('cutaway')) for (const l of mgr.levelsBuilt()) l.setCutaway(s.cutaway);
    if (c.has('quality')) perfCtl.setMode(s.quality, detected);
    if (c.has('labels')) labels.enabled = s.labels;
    if (c.has('selected')) {
      labels.highlight(s.selected);
      const comp = component(s.selected);
      if (comp && !mgr.isBusy) viewport.keepInView(comp.object, motion);
    }
    if (c.has('params') || c.has('mode') || c.has('presentation')) for (const l of mgr.levelsBuilt()) l.onState(s, c);
    if (c.has('presentation')) {
      labels.setOnly(s.presentation ? PRESENTATION_LABELS : null);
      if (!s.presentation && poster.view !== 'hidden') poster.setView('hidden');
    }
    if (c.has('level') && s.emphasis) queueMicrotask(() => store.set({ emphasis: null }));
    if (c.has('emphasis') || c.has('level')) {
      const id = s.emphasis ? XRAY_TARGETS[s.level]?.[s.emphasis as XrayKey] ?? null : null;
      mgr.current?.emphasize(id);
    }
  });

  // ---- input ----
  const ray = new THREE.Raycaster();
  new InputController(renderer.domElement, rig, {
    pick: (ndc) => {
      ray.setFromCamera(ndc, rig.camera);
      return mgr.pick(ray);
    },
    select: (id) => store.set({ selected: id }),
    dive: (id) => {
      const c = component(id);
      if (c?.child) navigate(c.child);
    },
    blocked: () => intro.running || demo.running,
  });
  bindKeyboard({
    introRunning: () => intro.running || demo.running,
    skipIntro: () => void (demo.running ? demo.skip() : intro.skip()),
    back,
    enter: () => {
      const c = component(store.get().selected);
      if (c?.child) navigate(c.child);
    },
    mode: (i) => store.set({ mode: (['structure', 'signal', 'power', 'thermal', 'radiation'] as const)[i] }),
    toggleExplode: () => store.set({ explode: store.get().explode > 0.5 ? 0 : 1 }),
    toggleCutaway: () => store.set({ cutaway: !store.get().cutaway }),
    toggleLabels: () => store.set({ labels: !store.get().labels }),
    togglePerf: () => perfCtl.toggleOverlay(),
  });

  viewport.resize();
  perfCtl.apply();

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
  // first screen: the landing over the live satellite scene (the long intro stays on ▶ Intro)
  const view = params.get('view');
  const demoParam = params.get('demo');
  if (view === 'poster') await showPoster();
  else if (params.has('demo')) void demo.play(demoParam === 'engineering' || demoParam === 'grating' ? demoParam : 'quick');
  else if (!startLevel && !params.has('nointro')) await showLanding();
  void seen;

  // ---- frame ----
  new RenderLoop(({ dt, raw, elapsed }) => {
    perfCtl.beginFrame();
    viewport.tick(dt);
    posterReframe.tick();
    // Scripted camera flights share the wall clock used by demo holds/steering.
    // Physical/decorative simulation below still uses the clamped step.
    rig.update(demo.running ? raw : dt);
    mgr.update(dt);
    stars.position.copy(rig.camera.position);
    stars.scale.setScalar((rig.camera.far * 0.45) / 2000);
    const st = store.get();
    const inSpace = SPACE_LEVELS.has(st.level) || (mgr.transition && (mgr.transition.from === 'cosmos' || mgr.transition.from === 'satellite'));
    const sm = stars.material as THREE.PointsMaterial;
    sm.opacity += ((inSpace ? 0.9 : 0.12) - sm.opacity) * Math.min(1, dt * 2);
    labels.update(rig.camera, innerWidth, innerHeight);
    hud.setScale(mgr.viewWidthMeters(rig.camera.aspect), innerWidth, st.level, !!mgr.transition);
    post.render(scene, rig.camera, elapsed);
    perfCtl.endFrame(raw, !!mgr.transition || mgr.isBusy, st.level);
  }).start();

  (window as unknown as { c2c: unknown }).c2c = {
    store, mgr, rig, scene, renderer, hud, post, viewport, demo, poster, explore,
    beam: () => beamSolution(store.get().params),
    calc: calcStats,
    quality: perfCtl.quality,
    stats: perfCtl.stats,
    frameInfo: () => ({ ...perfCtl.frameInfo }),
    config: () => ({ ...perfCtl.cfg }),
    presets: GRAPHICS_PRESETS,
    detected,
  };
}

void boot();
