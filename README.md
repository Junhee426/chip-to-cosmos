# Chip to Cosmos

**From Electrons to Orbital Networks**

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
- **Cross-scale causality** — the bottom strip shows it live:
  `ADC bits → SNRq → ADC+DSP power → payload DC → heat → radiator area` and
  `array size → gain → EIRP → Pr → link margin`.
- **Theory panel** per level: *INTUITION / ENGINEERING / THEORY* (equations, units, assumptions,
  validity, limitations, references) plus live, substituted equations.
- **Scientific integrity** — every model carries metadata and is labelled `CALCULATED`,
  `ILLUSTRATIVE` or *Simplified Educational Model*. See [MODEL_LIMITATIONS.md](MODEL_LIMITATIONS.md).
- **Cinematic, skippable intro**: Earth limb → satellite → cutaway → payload (exploded) → PCB →
  package (exploded) → die → MOSFET channel formation → *FROM ELECTRONS / TO ORBITAL NETWORKS*.

## Quick start

Requirements: Node.js ≥ 20 and a WebGL2-capable browser.

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
  main.ts              renderer, loop, picking, keyboard, quality
  app/                 navigation graph · state store · scale manager · system mapping
  scenes/              one module per scale level (lazy-loaded chunks) + BaseLevel
  graphics/            camera rig · lighting · materials · procedural textures · particles
                       labels (leader lines) · explode · fade · earth · effects · post-processing
  models/              pure scientific models (no Three.js) + metadata
  charts/              lightweight SVG/canvas charts (line, log, polar, IQ)
  content/             INTUITION / ENGINEERING / THEORY text per level
  ui/                  HUD, analysis panels, intro, DOM helpers
tests/                 Vitest unit tests
scripts/smoke.mjs      optional headless smoke test (screenshots every level)
scripts/perf.mjs       performance + mobile harness (tiers, draw calls, memory, DPR-3 phone)
```

Rendering, scientific models, scenes and UI are strictly separated: models are pure
TypeScript and fully unit-tested; scenes consume them; the UI renders the same numbers.
Only the current level, its parent and children stay resident in GPU memory.

More detail: [PROJECT.md](PROJECT.md) · [PERFORMANCE.md](PERFORMANCE.md) · [THEORY.md](THEORY.md) ·
[VISUAL_STYLE.md](VISUAL_STYLE.md) · [MODEL_LIMITATIONS.md](MODEL_LIMITATIONS.md)

## Deployment

`render.yaml` deploys the static build to Render (`npm ci && npm test && npm run build`,
publish `dist/`). Any static host works — the build uses relative asset paths.

## Tech

TypeScript · Vite · Three.js (WebGL2, PBR, UnrealBloom) · Vitest. No UI framework, no
external model/texture assets — all geometry and textures are procedural.
