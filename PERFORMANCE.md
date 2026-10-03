# Performance budget & mobile implementation

This file is the implementation and verification standard for rendering cost,
not a wish list. Every number below is either enforced in code
(`src/app/quality.ts`, `src/graphics/optimize.ts`, `src/main.ts`) or measured by
`scripts/perf.mjs`. Measured results — always with the environment they were
measured in — are in [docs/performance-results.md](docs/performance-results.md).

**Rule: performance work removes decoration, never content.** Selected object,
navigation, engineering structure, simulation results, signal paths and essential
labels survive every degradation step.

## 1. Targets

| Class | Target | Acceptable |
|---|---|---|
| Desktop High | 60 FPS | ≥ 50 FPS |
| Desktop Balanced | 60 FPS | ≥ 45 FPS |
| Mobile | 30–60 FPS | sustained ≥ 30 FPS |
| Low-end | stable 30 FPS first | — |

FPS is never the only criterion. `FrameStats` (`src/graphics/perf.ts`) and the
overlay (`?perf` or key **P**) also report frame pacing (σ), p95/p99, share of frames
over 16.7 / 33.3 ms, long frames (> 66.7 ms), the worst frame, draw calls,
triangles, geometries, textures, shader programs and JS heap (Chromium).

## 2. Frame budget

`FRAME_60 = 1000/60 ≈ 16.67 ms`, `FRAME_30 = 1000/30 ≈ 33.33 ms`.
When sustained frame time exceeds the class budget, the controller degrades (§6).

## 3. Quality tiers — `GRAPHICS_PRESETS`

| | high | balanced | performance |
|---|---|---|---|
| maxDpr | 2 | 1.5 | 1 |
| shadows / map | on / 2048 | on / 1024 | off |
| bloom | on | on | off |
| particles | 1 | 0.6 | 0.3 |
| environment (PMREM) | 256 | 128 | 64 |
| model LOD | 0 | 1 | 2 |
| MSAA (post target) | 4× | 4× | off |
| cinematic effects | on | on | off |
| label density | 1 | 0.8 | 0.5 |

*SSAO*: not implemented and not part of the configuration or the degradation ladder (removed in V2
— a step that changes nothing must not exist).
*Antialias*: canvas MSAA is chosen at start-up from the initial tier; the
post-processing target's MSAA follows the live tier (the canvas AA does not apply
once the composer renders off-screen).

## 4. Device detection — `detectInitialQuality`

No User-Agent sniffing. Signals: viewport width, `devicePixelRatio`,
`hardwareConcurrency`, `deviceMemory` (when available) and `(pointer: coarse)`.

- `performance` if the device is **GPU-constrained**: width ≤ `COMPACT_GPU_MAX` (768 px), coarse pointer, ≤ 4 cores or ≤ 4 GB
- `balanced` if width ≤ 1280, DPR > 2 or ≤ 8 cores
- otherwise `high`

This is only the starting point; runtime performance can move it (§6).
Touch devices may auto-climb at most to `balanced` (`tierCeiling`).
`?quality=auto|high|balanced|performance` overrides it for testing.

## 5. DPR is the primary cost control

`getRenderDpr = min(devicePixelRatio, maxDpr)`. A DPR-3 phone renders at DPR 1 in
`performance` (≈ 9× fewer pixels than native).

## 6. Dynamic quality with hysteresis — `QualityController`

- **Downgrade** one step when the average over the last **4 s** is below
  **45 FPS** (desktop) / **28 FPS** (mobile).
- **Upgrade** one step when the average over the last **15 s** is above
  **57 FPS** (desktop) / **55 FPS** (mobile); at step 0 it climbs one tier, up to the ceiling.
- A window must be fully observed before any decision; single spikes never trigger it.
- After every change, and during zoom transitions, hidden tabs and resizes, the
  window is dropped and the first **2 s** are ignored (shader compiles and resize
  hitches are not "sustained load").
- **Manual policy**: if the user picks High / Balanced / Performance, the
  configuration is never changed automatically. If it stays far below budget, a
  toast offers to switch to Auto. `Auto` is the default.

## 7. Degradation order — `DEGRADATION_ORDER`

1. particle count → 2. label density → 3. bloom → 4. shadow resolution → 5. shadows off →
6. DPR (×0.75, floor 0.75) → 7. environment resolution → 8. repeated-geometry LOD →
9. decorative animation (vignette/grain, flicker, pulses).

The ladder is **feature-aware** (`effectiveSteps`): a step that would change nothing for the
current tier (bloom already off, shadows already off …) is skipped, so every controller step has
a real effect and `performance` has a shorter ladder than `high`.

Kept to the end: selection, navigation, structure, simulation results
(MOSFET channel, carriers, radiation surface, bands), signal path tubes, essential
(navigable) callouts.

## 8. Draw calls

`renderer.info.autoReset = false` so a frame's count includes the scene, shadow
and post-processing passes. Engineering targets: desktop hero < 300, mobile < 150,
performance < 100–120. Structure is never broken just to hit a number.

Reductions implemented:
- **Static merge** (`mergeStatic`): sibling meshes with equivalent materials are merged
  per parent, so exploded parts, picking groups, fades and cutaway still work.
- **Shadow policy** (`applyShadowPolicy`): only parts larger than 4 % of the level
  radius cast shadows; instanced micro-geometry never does.
- **One draw for all orbit rings** (cosmos, previously 36 lines).

## 9. Instancing

Instanced: constellation satellites (720), phased-array patches (up to 1024),
solar/battery cells, PCB vias and decoupling caps, BGA balls, C4 bumps,
micro-bumps, TSVs, die bump pads, BEOL line arrays, silicon atoms and bonds,
transistor-array hint. Particles and stars are `Points` (1 draw each).

## 10. LOD

Scale level is the primary LOD: only the current level, its parent and its
children are resident (`residentSet`); others are disposed. Inside a level,
`applyLod` thins repeated micro-geometry: grids are sub-sampled 2D (every second
element at LOD 2) so they still read as regular arrays; scatter sets (vias, caps)
keep 60 % / 35 %.

## 11. Streaming

Every level is its own lazy chunk (`import()` per scene). On arrival, missing
neighbours are built **one at a time in `requestIdleCallback`**, not all at once.
Before a level is ever shown, `prepare()` merges it, applies the tier and
**pre-compiles every shader variant** it will need (opaque, faded, cutaway on/off),
so transitions do not hitch on shader links.

## 12. Model / texture budget

No external model or bitmap assets. Procedural textures: PCB and die artwork
2048², solar cells 1024², all others ≤ 512². They are shared (cached) and never
duplicated per level. KTX2/Draco/Meshopt are not needed while there are no
external assets; revisit when glTF assets are added.

## 13. Memory

`disposeTree` releases geometries, materials, non-shared textures and instanced
buffers of evicted levels. Shared textures are owned by the texture cache and are
never disposed per level. The PMREM environment and composer targets are
disposed when regenerated. `scripts/perf.mjs` runs repeated
satellite → die → satellite cycles and records geometries/textures/programs/heap.

## 14–22. Mobile

- **Layout vs GPU**: two separate breakpoints. `MOBILE_LAYOUT_QUERY`
  (`max-width: 900px`, or `max-height: 520px` with a coarse pointer) switches the UI; `COMPACT_GPU_MAX`
  (768 px) plus cores/memory/pointer selects the GPU policy. A narrow desktop window gets the
  mobile layout but keeps the desktop GPU policy. A test checks the CSS uses the same query.
- **Layout**: top navigation `‹ back · breadcrumb · ⋯ menu`; the 3D view
  fills the screen; the inspector is a **bottom sheet** (42 dvh collapsed, 78 dvh
  expanded). The scale ladder, modes, explode, cutaway and quality live in the menu.
- **Collapsed sheet**: object name, one-line explanation, one key calculated
  parameter, **Internal view** and **Experiment** buttons.
  **Expanded**: explanation, signal path, equations, assumptions, sources,
  advanced parameters, charts and the cross-scale coupling strip. Nothing is
  deleted on mobile — only collapsed.
- **Safe areas**: `viewport-fit=cover` + `env(safe-area-inset-*)` on the nav and sheet;
  `100dvh` with fallback.
- **Touch targets**: primary controls ≥ 44 × 44 CSS px (`@media (pointer: coarse)`),
  bigger slider thumbs; glyph sizes unchanged.
- **Gestures**: tap = select, one-finger drag = orbit, pinch = zoom, pan off on touch.
  Entering a child scale is an explicit button (double-click only for mice); pinch
  never auto-enters a level. Back = parent level (button, `Esc` and browser history).
- **Orbit controls on touch**: rotate 0.65, zoom 0.6, damping 0.08.
- **Occlusion**: the camera's principal point is shifted into the free viewport
  (`setViewOffset`, eased) using the measured nav/sheet/panel insets; selecting a
  part that projects outside the free area re-centres the camera on it.
- **Typography**: 15 px base on mobile, 14–16 px for explanations.
- **Blur**: `backdrop-filter` is dropped on the performance tier and where unsupported.

## 23. Label density

Desktop: all callouts at `labelDensity`, the selected one always first.
Mobile: at most **4** callouts — the selected one, then navigable/essential parts —
further reduced by the tier's density; mono sub-lines are hidden.

## V2 additions

- **Landscape phones**: the inspector docks to the right (≤ 44 vw collapsed) instead of covering
  the bottom; the safe viewport follows it.
- **Browser toolbars / orientation**: `visualViewport` resize and `orientationchange` re-run layout.
- **Input**: `PointerTracker` — taps only from single-pointer gestures, `pointercancel` and `pointerup`
  always clear state; manual input cancels cinematic (non-critical) camera flights but never a scale
  transition (frame renormalisation must complete).
- **Reduced motion**: transitions run at 0.35× duration, the intro never autoplays.
- **Harness**: `--only=memory` runs 10 satellite → die → satellite cycles and 6 rounds of quality
  changes + resizes (render-target leak check); `--only=devices` checks 390×844, 430×932, 768×1024,
  820×1180 (portrait + landscape) and 1280×800 / 1440×900 for control overlap, touch-target size,
  sheet behaviour, selected-part visibility and the Internal View → Back journey. These are
  **emulations**, not real-device measurements.

## V3 additions (hero beam demo)

- **One evaluation per state.** `solveSystem(params)` / `beamSolution(params)` are memoised on the
  params object (the store replaces it on every change), so the scenes, panels, causal strip and
  coupling strip share one `solveBeam()` per parameter change instead of evaluating the array
  model separately.
- **Frame-coalesced updates.** BEAM LAB marks itself dirty on parameter changes and rebuilds at most
  once per rendered frame; the HUD coalesces parameter-only store events into one update per
  animation frame. A slider drag therefore never runs the model more than once per frame.
- **Buffer reuse.** Beam-axis line, −3 dB ring, footprint fill/contour, edge rays, grating-lobe
  contours (BEAM LAB) and footprint, rays and secondary contours (COSMOS) are fixed-capacity
  `BufferGeometry`s rewritten in place with `setDrawRange`; no geometry is allocated per update.
- **Quality-aware density.** Wavefront count scales with the tier's particle factor (never below 3);
  the calculated footprint, contour and rays are never reduced.
- **Measured** in `docs/performance-results.md` (V3 section) with `scripts/hero.mjs`.

## V4 additions (signature experience)

- **Profiled before optimising** (`npm run profile:beam`): `arrayMetrics` (the 90 × 120 directivity
  integration) was ~85–90 % of `solveBeam`, and the BEAM LAB surface sampling cost about the same —
  both dominated by one `cos` + `sin` per element per direction.
- **Same math, fewer transcendental calls.** The separable array-factor sum advances the phasor
  e^{jiψ} by complex multiplication (tested equal to the direct sum to 1e-12).
- **Dependency-aware caches** (`models/beam-solution.ts`, small LRU, no library): the pattern depends
  on N, d/λ, θ₀, φ₀, taper and element pattern — not on frequency, altitude, power or receiver; the
  footprints add altitude; the link (cheap) is always recomputed. An altitude, frequency, power or
  receiver change never re-integrates the pattern.
- **Once per frame.** Sliders send at most one value per animation frame (exact value on release);
  SATELLITE and COSMOS apply parameter changes in `tick` (BEAM LAB already did); the HUD coalesces.
- **First-visit hitch.** The Quick Demo preloads exactly the scenes it uses (satellite, array, cosmos —
  `ScaleManager.preload`), and shader pre-warm now also compiles objects that start hidden (beam,
  footprints, grating-lobe overlays), so their first appearance does not compile a program mid-demo.
- **No Web Worker**: measurements do not show a main-thread bottleneck that would justify one.
- Measured numbers: `docs/performance-results.md` (V4 section).
