# Chip to Cosmos

**From element phase to communication coverage — from electrons to orbital networks.**

<!-- Poster: capture with `node scripts/hero.mjs <url> <out> --only=visual` (hero-05-poster.png) or open
     `?view=poster` and place the image here, e.g. ![Chip to Cosmos poster](docs/poster.png) -->

**Start here:** open the app → *▶ Run 15-second demo*. A phased array on the satellite's
Earth-facing deck changes its element phases; the beam steers; its −3 dB footprint moves on the
spherical Earth; gain and link margin follow — every number calculated from one beam state.
`?view=poster` opens the same signature frame directly (reproducible state and camera).

An interactive, multiscale 3D scientific visualization that connects
**electrons → semiconductors → transistors → ICs → RF/digital electronics →
communication payload → satellite → LEO network** in a single continuous
Three.js/WebGL scene.

Zoom in from a LEO constellation and you keep going — through the spacecraft,
its payload, a circuit board, a chip package, the silicon die and a MOSFET down
to the crystal lattice and the energy bands. Zoom out and you climb back up to
the orbital network.

```
COSMOS ▸ SATELLITE ▸ PAYLOAD ▸ PCB ▸ CHIP ▸ DIE ▸ MOSFET ▸ SILICON ▸ ENERGY
             └▸ BEAM LAB (phased array)
```

## Highlights

- **Seamless zoom** — each level is placed inside its parent at an anchor; the camera flies
  in log-distance space and the frame is *renormalised* on arrival, so there is no
  page switch and no floating-point breakdown across 16 orders of magnitude.
- **Vertical slice (visual benchmark)** — satellite → payload → PCB → package → die → MOSFET with
  cutaway, exploded views (real 3D thickness), leader-line callouts and signal flow.
- **Engineering modes** in the same scene: `STRUCTURE`, `SIGNAL`, `POWER`, `THERMAL`, `RADIATION`.
- **Real calculation models** wired to the visuals: MOSFET square-law (channel thickness and
  pinch-off are computed), Friis cascade, ADC sampling/aliasing/quantisation, BPSK…64QAM in AWGN,
  planar array factor → **3D radiation surface generated from the AF**, link budget, power & thermal
  balance, intrinsic carrier density, PN-junction band bending.
- **Hero beam demo (V3)** — a skippable, real-time ~25 s sequence (`▶ Beam demo`, or `?demo`):
  satellite → phased array → anchored dive into BEAM LAB → element phase → tilted wavefront →
  calculated radiation pattern → −3 dB footprint → the same contour on the spherical Earth → link.
  It drives the real app (ScaleManager flights, store parameters); every number it shows is read
  from the calculation at that moment. `Esc`, *Skip* or any navigation ends it.
- **One beam state, many views** — `solveBeam()` (`src/models/beam-solution.ts`) produces one
  `BeamSolution` per parameter set: element phases, beam axis, 3D pattern metrics, the −3 dB contour,
  a *flat-ground* footprint (BEAM LAB, pedagogical) and a *spherical-Earth* footprint (COSMOS,
  SATELLITE: ray–sphere intersection per contour direction), grating-lobe footprints, power and the
  link to a user at the beam centre. Scenes, panels and the causal strip
  `PHASE → BEAM → FOOTPRINT → LINK` all read that object.
- **Beam experiments** — four primary controls (STEER, ARRAY SIZE, SPACING, TAPER), validated presets
  (Nadir · Steered · Low sidelobes · Grating lobe), a grating-lobe warning with its calculated
  secondary ground footprint, and a calculated before/after for taper changes (SLL ↔ HPBW ↔ area).
- **Cross-scale causality** — the bottom strip shows it live (changed values are highlighted with ▲/▼):
  `ADC bits → SNRq → ADC+DSP power → payload DC → heat → radiator area` and
  `array size → gain → EIRP → Pr → link margin`, plus the beam chain `PHASE → BEAM → FOOTPRINT → LINK`
  on the SATELLITE, BEAM LAB and COSMOS levels.
- **Theory panel** per level: *INTUITION / ENGINEERING / THEORY* (equations, units, assumptions,
  validity, limitations, references) plus live, substituted equations.
- **Scientific integrity** — every model carries metadata and is labelled `CALCULATED`,
  `ILLUSTRATIVE` or *Simplified Educational Model*. See [MODEL_LIMITATIONS.md](MODEL_LIMITATIONS.md).
- **Signature experience (V4)** — landing over the live satellite scene; a ~15 s *Quick Demo*
  (Earth-facing satellite → element phase → beam → Earth footprint → poster) that ends
  interactive (*Try it: steer the beam*); presentation mode (chrome hidden, 3–4 calculated
  metrics); the full *Engineering Demo* and a *Why 0.5λ matters* grating-lobe demo; Array Compare
  (8×8 vs 32×32 under an explicit power assumption) and a Link Budget X-ray whose stages
  highlight the hardware and propagation path in 3D.
- **Electronic steering, physically correct** — the user-service array is bolted to the nadir
  deck (`frames.ts ARRAY_TO_BODY`); at θ₀ = 0 its boresight is the Earth-centre direction; steering
  changes element phases, never the panel. Unit- and browser-tested.
- **Cinematic, skippable intro**: Earth limb → satellite → cutaway → payload (exploded) → PCB →
  package (exploded) → die → MOSFET channel formation → *FROM ELECTRONS / TO ORBITAL NETWORKS*.

## Quick start

Requirements: Node.js ≥ 20.19 and a browser with **WebGL 2** (required — Three.js r163+ has no WebGL 1
path). Without it the app shows a guidance page (update the browser, enable hardware acceleration,
check `chrome://gpu`).

```powershell
# Windows (PowerShell)
Set-Location C:\kleo\chip-to-cosmos
npm install
npm run dev        # http://localhost:5173
```

```bash
npm install
npm run dev        # development server
npm test           # unit tests (Vitest) for all scientific models + navigation
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

URL options: `?level=mosfet` opens a level directly, `?nointro` skips the intro.

## Controls

| Input | Action |
|---|---|
| Drag / scroll / right-drag | Orbit / zoom / pan |
| Click a part or callout | Select → info card (function, I/O, parameters, equation) |
| Double-click a part, or `Enter` | Zoom into the child scale |
| `Esc` / `Backspace` | Zoom out one scale |
| Breadcrumb, scale ladder, coupling pills | Jump to any level (animated through the tree) |
| `1`–`5` | STRUCTURE / SIGNAL / POWER / THERMAL / RADIATION |
| `E` / `C` / `L` / `P` | Toggle explode / cutaway / labels / perf overlay |
| Touch | tap = select · drag = orbit · pinch = zoom · **Internal view** button = dive · ‹ = back |

Quality: **Auto** (default) detects the device class (viewport, DPR, cores, memory, pointer —
no UA sniffing) and then adapts with hysteresis, removing decoration in a fixed order (particles →
labels → bloom → shadows → DPR → environment → LOD → decorative motion) while keeping all content.
**High / Balanced / Performance** are manual and never change on their own. `?perf` or **P** shows
frame pacing, draw calls and memory. On phones (≤ 900 px) the UI becomes a top nav + bottom-sheet
inspector with ≥ 44 px touch targets. Budgets and policy: [PERFORMANCE.md](PERFORMANCE.md).

## Architecture

```
src/
  main.ts              bootstrap & wiring only
  runtime/             renderer (WebGL 2 check, shader pre-warm) · render loop · input (tap/drag,
                       pointercancel, multi-touch, shortcuts) · viewport (safe area, keep-in-view) ·
                       performance (adaptive quality, frame stats, ?perf overlay)
  app/                 navigation graph + validator · state store + parameter limits · scale manager
                       (last-intent navigation, load-failure recovery) · quality policy · system mapping
  scenes/              one module per scale level (lazy-loaded chunks) + BaseLevel
  graphics/            camera rig · lighting · materials · procedural textures · particles
                       labels (leader lines) · explode · fade · earth · effects · post-processing
  models/              pure scientific models (no Three.js) + metadata; frames.ts (coordinate frames,
                       ray–sphere), beam-solution.ts (the shared beam calculation state)
  charts/              lightweight SVG/canvas charts (line, log, polar, IQ)
  content/             INTUITION / ENGINEERING / THEORY text per level
  ui/                  HUD, analysis panels, beam controls, intro, hero demo, DOM helpers
tests/                 Vitest unit tests
scripts/smoke.mjs      optional headless smoke test (screenshots every level)
scripts/perf.mjs       performance + mobile harness (tiers, draw calls, 10 memory cycles, render-target
                       leaks, phone/tablet portrait+landscape layouts and the mobile journey)
scripts/visual.mjs     12-view visual regression capture (before/after comparison)
scripts/hero.mjs       V4 hero harness: 10+ captures (Earth-facing array, Quick Demo stages, poster,
                       grating, compare, X-ray, mobile poster), browser checks (panel never rotates,
                       Quick/Engineering/Grating demos, Try it, skip-restores, reduced motion,
                       ?view=poster reproducibility, X-ray emphasis), per-moment CPU cost and
                       repeated Quick Demo runs (frame stats + GPU resource counts)
scripts/demo-flows.mjs demo state-contract harness: Skip/complete/navigate/explore from landing, poster
                       and free exploration via the real buttons, end-of-demo races, poster resize
                       round trips at 0/25/50°, panel attitude, reduced motion, captures and
                       cold/warm Quick timing (CHROMIUM_PATH, url and out-dir are arguments;
                       see docs/demo-state-contract.md)
npm run profile:beam   stage-by-stage cost of the beam model (opt-in Vitest profile)
```

Rendering, scientific models, scenes and UI are strictly separated: models are pure
TypeScript and fully unit-tested; scenes consume them; the UI renders the same numbers.

### Beam model and coordinate frames

| Frame | Definition |
|---|---|
| Array local (BEAM LAB) | elements in X–Z, **+Y = boresight**; d = (sinθcosφ, cosθ, sinθsinφ) |
| Satellite body | +X along-track, +Y zenith, +Z = X×Y; the array faces nadir: body = (x, −y, −z) |
| Orbit / local | nadir-pointing, zero yaw → body frame = orbit frame |
| Earth / world | Earth-centred, Y-up, km (COSMOS); canonical orbit puts the satellite at (0, Re+h, 0) |

All transforms live in `src/models/frames.ts` and are unit-tested (boresight → nadir, positive
steering → +along-track, azimuth rotation, unit length, ray–sphere hits/misses, slant range).
BEAM LAB draws the −3 dB contour on a **flat ground plane** (directions exact, distance
compressed for display); COSMOS and SATELLITE intersect the **same contour** with the
**spherical Earth** (SATELLITE shows the Earth uniformly scaled, so the altitude/radius ratio is
exact). Along-track / cross-track extents are measured in the tangent plane at the beam centre.

**Link geometry.** The user terminal sits at the calculated beam centre: elevation and slant range
follow from steering and altitude, so the drawn link and the link budget are the same link. When
the beam axis points above the Earth limb (e.g. 60° scan from 1200 km) there is no link and the UI
says so.

**RF power assumption** (explicit switch): *fixed per element* — total RF = P_el · N² (a larger
array adds directivity **and** power); *fixed total RF* — P_el = P_total / N² (directivity only).
Only the current level, its parent and children stay resident in GPU memory.

More detail: [PROJECT.md](PROJECT.md) · [PERFORMANCE.md](PERFORMANCE.md) · [THEORY.md](THEORY.md) ·
[VISUAL_STYLE.md](VISUAL_STYLE.md) · [MODEL_LIMITATIONS.md](MODEL_LIMITATIONS.md)

## Deployment

`render.yaml` deploys the static build to Render (`npm ci && npm test && npm run build`,
publish `dist/`). Any static host works — the build uses relative asset paths.

## Tech

TypeScript · Vite · Three.js (WebGL2, PBR, UnrealBloom) · Vitest. No UI framework, no
external model/texture assets — all geometry and textures are procedural.
