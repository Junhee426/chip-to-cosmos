# Performance results

Measured with `scripts/perf.mjs` (tiers, memory, mobile phases).

## Environment — read this first

| | |
|---|---|
| Date | 2026-09-30 |
| Machine | cloud container, **4 vCPU**, Linux 6.18 |
| Browser | Chromium 141 (Playwright build 1194), headless |
| GPU | **none — SwiftShader software rasteriser** (the GPU process used ~340 % CPU) |
| Viewport | desktop 1600 × 900 @ DPR 1; mobile 390 × 844 @ DPR 3, touch |

**Frame times below are CPU-rendered and are *not* evidence for or against the
60 / 30 FPS targets.** They are useful only as relative comparisons between tiers.
Draw calls, triangles, memory counts, tier detection, DPR and layout checks are
independent of the rasteriser and are valid. Real-device numbers must be recorded
here with the same table (open `?perf` or press **P**).

## Draw calls per frame (scene + shadow + post passes)

| Level | before (V1) | high | balanced | performance |
|---|---|---|---|---|
| cosmos | 132 | 31 | 31 | 16 |
| satellite | 492 | 122 | 122 | 67 |
| beam lab | 74 | 37 | 37 | 20 |
| payload | 538 | 109 | 109 | 48 |
| pcb | 318 | 101 | 101 | 53 |
| package | 226 | 51 | 51 | 23 |
| die | 124 | 55 | 55 | 27 |
| mosfet | 136 | 50 | 50 | 23 |
| silicon | 50 | 24 | 24 | 9 |
| energy | 56 | 28 | 28 | 13 |

All levels are under the desktop target (< 300) and the mobile target (< 150);
in `performance` all are under 70 (target < 100–120).

## Triangles per frame (thousands)

| Level | before | high | performance |
|---|---|---|---|
| satellite | 342 | 136 | 105 |
| pcb | 217 | 70 | 22 |
| package | 1 850 | 284 | 72 |
| silicon | 385 | 101 | 101 |

## Frame time, SwiftShader (relative only)

| Level | high avg / p95 ms | performance avg / p95 ms |
|---|---|---|
| cosmos | 1071 / 1683 | 324 / 583 |
| satellite | 1156 / 1217 | 348 / 833 |
| payload | 2950 / 2950 | 517 / 1017 |
| mosfet | 1317 / 2683 | 392 / 767 |

The performance tier is ~3× cheaper than high on the same machine.

## Memory over repeated zoom cycles (satellite → die → satellite, balanced)

| Cycle | geometries | textures | programs | JS heap MB |
|---|---|---|---|---|
| 1 | 114 | 26 | 48 | 17 |
| 2 | 114 | 26 | 49 | 25 |
| 3 | 114 | 26 | 48 | 26 |
| 4 | 114 | 26 | 48 | 17 |

No growth in GPU resources; the heap returns to its starting value after GC.

**Transition hitch (open issue):** during these cycles the worst frame was
~16 s under SwiftShader. It happens when a level that is not resident yet
(package, die) is built and its shaders are compiled on the main thread before the
flight starts. On real GPUs shader linking is orders of magnitude faster, but level
construction is still synchronous; spreading it over idle frames is the next step
if real-device traces show a visible hitch.

## Mobile emulation (390 × 844, DPR 3, touch)

| Check | Result |
|---|---|
| Detected tier | performance (coarse pointer) — auto mode |
| Render DPR | **1** (device DPR 3 → ≈ 9× fewer pixels) |
| Canvas | 390 × 844 px |
| Visible controls under 44 × 44 px | 0 |
| Draw calls (satellite / mosfet / beam lab) | 64 / 23 / 20 |
| Page errors | none |

---

# V2 measurements (2026-10-02)

Same environment class as above: cloud container, **4 vCPU, SwiftShader software rendering**,
Chromium 141 headless. Frame times are CPU-bound and are not evidence for the FPS targets.

## Draw calls per frame — V1 → V2

| Level | V1 high | V2 high | V1 performance | V2 performance | why it changed |
|---|---|---|---|---|---|
| cosmos | 31 | 31 | 16 | 16 | — |
| satellite | 122 | 146 | 67 | 80 | hero detail: bezels, tile seams, MLI tape, heat pipes, yoke, hinges, thruster |
| beam lab | 37 | 50 | 20 | 33 | Earth footprint, ground plane, footprint edges |
| payload | 109 | 109¹ | 48 | 48 | — |
| pcb | 101 | 101 | 53 | 53 | — |
| package | 51 | 51 | 23 | 23 | — |
| die | 55 | 55 | 27 | 27 | — |
| mosfet | 50 | 50 | 23 | 23 | — |
| silicon | 24 | 24 | 9 | 9 | — |
| energy | 28 | 28 | 13 | 13 | — |

¹ The high-tier payload sample read 50 (identical to the beam-lab row, a sampling-timing artefact);
the balanced tier — same geometry, same draw path — measured 109. All levels remain under the desktop
(< 300) and mobile (< 150) engineering targets; performance tier ≤ 80.

## Memory — 10 cycles satellite → die → satellite (balanced)

| Cycle | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| geometries | 127 | 127 | 127 | 127 | 127 | 127 | 127 | 127 | 127 | 127 |
| textures | 27 | 27 | 27 | 27 | 27 | 27 | 27 | 27 | 27 | 27 |
| programs | 54 | 54 | 54 | 54 | 54 | 54 | 54 | 54 | 54 | 54 |
| JS heap MB² | 24 | 28 | 25 | 21 | 31 | 23 | 23 | 23 | 23 | 23 |

² `performance.memory`, Chromium-only auxiliary signal; it fluctuates with GC and does not trend upward.
Flights were shortened (`motionScale = 0.2`) for this run; every step, renormalisation, level build
and disposal still executes.

## Render targets — 6 rounds of quality changes (high → performance → balanced) + resize

Textures 27 and geometries 127 after every round: post-processing targets, shadow maps and the
PMREM environment are released when regenerated.

## Transition hitch (open issue, unchanged)

Worst frame per cycle ≈ 14–17 s under SwiftShader. It is the first visit to a non-resident level
(build + shader pre-compile on the main thread before the flight starts). Real GPUs compile far
faster, but level construction is still synchronous — next step if real-device traces show it.

## Device layouts — Chromium emulation (not real devices)

`node scripts/perf.mjs <url> <out> --only=devices`. Viewport + touch emulation in headless
Chromium; these are layout/interaction checks, **not** iPhone/iPad/Surface measurements.
`small` = interactive elements under 44 px on coarse pointers (24 px desktop); `overlaps` =
intersecting HUD controls; journey = expand sheet → select from parts list → selection visible →
Inside → Back → Experiment.

| Device | Orientation | Layout | Panel | Free area | small | overlaps | Journey |
|---|---|---|---|---|---|---|---|
| phone-390 | portrait 390×844 | mobile | bottom sheet | 77 % | 0 | 0 | pass |
| phone-390 | landscape 844×390 | mobile | right dock | 57 % | 0 | 0 | pass |
| phone-430 | portrait 430×932 | mobile | bottom sheet | 79 % | 0 | 0 | pass |
| phone-430 | landscape 932×430 | mobile | right dock | 61 % | 0 | 0 | pass |
| tablet-768 | portrait 768×1024 | mobile | bottom sheet | 81 % | 0 | 0 | pass |
| tablet-768 | landscape 1024×768 | desktop | side panel | 62 % | 0 | 0 | — |
| tablet-820 | portrait 820×1180 | mobile | bottom sheet | 83 % | 0 | 0 | pass |
| tablet-820 | landscape 1180×820 | desktop | side panel | 67 % | 0 | 0 | — |
| desktop-1280 | 1280×800 | desktop | side panel | 69 % | 0 | 0 | — |
| desktop-1440 | 1440×900 | desktop | side panel | 73 % | 0 | 0 | — |

The first run found tablet landscape (touch + desktop layout) failing: coupling pills overflowed the
narrow middle strip (6 / 5 overlaps) and `.part` buttons were under 44 px. Fixed in `src/ui/hud.ts`
(`placeCoupling()` docks the strip into the inspector when the free middle width is < 620 px) and
`src/styles/main.css` (coarse pointer: hide the mouse hint, `.part` min-width 44 px); the rows above
are the re-run after the fix (tablets and desktops re-measured).

# V3 measurements — hero beam demo (2026-10-02)

Harness: `node scripts/hero.mjs <url> <out> [--only=visual,smoke,perf,mobile]`. Same container as
above: headless Chromium, **SwiftShader (CPU) rendering, no GPU**, 4 vCPU. Frame times below are a
property of this CPU rasteriser — they are **not** GPU, phone or Surface frame rates and must not be
read as FPS. Resource counts, state checks and layout are renderer-independent.

## Model cost (Node, same machine)

One `evaluateSystem()` (includes `solveBeam()`: directivity integration 90 × 120, contour trace,
spherical + flat footprints, grating-lobe search), mean of 5:

| Case | ms |
|---|---|
| 8×8 | 9.9 |
| 16×16 | 13.1 |
| 32×32 | 25.3 |
| 16×16, d = 1.0λ, θ₀ = 25° (grating lobe + secondary footprint) | 16.6 |
| 32×32 Hann | 29.0 |

Memoisation (`solveSystem`) runs this once per parameter change for every consumer.

## Repeated hero demo — 3 runs, 1280 × 800, balanced (SwiftShader)

| Run | Wall s | Frames | avg ms | p95 ms | p99 ms | max ms | frames > 66.7 ms | geometries | textures | programs |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 234.6 | 155 | 1482 | 3000 | 7100 | 10266 | 147 | 108 | 23 | 67 |
| 2 | 222.7 | 153 | 1445 | 2933 | 3233 | 7150 | 149 | 108 | 23 | 67 |
| 3 | 230.2 | 157 | 1461 | 2950 | 7366 | 8466 | 151 | 108 | 23 | 67 |

- **No GPU-resource growth** across repeated runs (geometries 108, textures 23, programs 67 after
  every run).
- Wall time ≫ the designed ~25 s because SwiftShader frames take ~1.5 s and the render loop clamps
  `dt` to 0.1 s, so time-based flights advance at most 0.1 s per frame. On a GPU at ≥ 30 FPS the
  flights run at their designed duration; that has **not** been measured here.

## Steering drag in BEAM LAB (80 store writes at 16 ms, SwiftShader)

3 frames rendered over the drag (p95 = max ≈ 1.6 s): parameter writes were coalesced to one model
evaluation and one geometry rebuild per rendered frame. GPU frame times for dragging are not measured.

## Browser smoke checks (SwiftShader) — 13/13 passed

Steering changes the phase gradient (βx 0 → −1.57 rad), tilts the axis and moves the footprint
(+320 km along-track); BEAM LAB draws the same `BeamSolution` object the HUD reads; causal strip
shows the solution footprint; 16→32 elements: HPBW 7.6 → 4.0°, area 5609 → 1399 km²; Earth contour
drawn in COSMOS (72 points); `Esc` skips; navigation works after skip; a navigation request during a
replay ends the demo; reduced motion: no intro autoplay, motionScale 0.35, demo completes; grating
preset → 1 lobe with 1 secondary Earth footprint and the warning panel; demo ends at COSMOS.

## Mobile hero journey — Chromium emulation (not real devices)

Tap *▶ Demo* in the sheet → demo completes → BEAM LAB → *Experiment* → *Grating lobe* → *Back*.

| Viewport | Demo button | Skip | End level | Grating lobe | Back | Targets < 44 px |
|---|---|---|---|---|---|---|
| 390 × 844 | 44 px | 44 px | cosmos | yes | satellite | 0 |
| 430 × 932 | 44 px | 44 px | cosmos | yes | satellite | 0 |
| 844 × 390 | 44 px | 44 px | cosmos | yes | satellite | 0 |

The first 390 × 844 capture showed the Earth-footprint framing too tight in portrait; the framing
now backs off with the aspect ratio (re-run above is after the fix).

# V4 measurements — signature experience (2026-10-02)

Same container: headless Chromium, **SWIFTSHADER (CPU rendering, no GPU)**, 4 vCPU. Mobile rows are
**EMULATED** (Chromium viewport + touch). No HARDWARE GPU or REAL DEVICE results exist yet — no FPS
figure below may be read as phone/laptop performance.

## Beam model cost, per call (Node, `npm run profile:beam`, mean of 20)

| Case | solveBeam V3 → V4 (ms) | arrayMetrics V3 → V4 | BEAM LAB surface V3 → V4 |
|---|---|---|---|
| 8×8 θ25 | 10.8 → 3.5 | 6.0 → 2.3 | 5.5 → 2.2 |
| 16×16 θ25 | 12.0 → 3.5 | 9.9 → 3.1 | 9.3 → 3.4 |
| 32×32 θ25 | 24.3 → 5.0 | 21.0 → 4.3 | 20.0 → 4.0 |
| 16×16 d1.0 (grating) | 13.0 → 4.3 | 12.0 → 3.5 | 10.2 → 3.2 |

Cause: the separable AF sum now advances the phasor by complex multiplication instead of calling
cos/sin per element (same sum, tested to 1e-12). With the pattern/footprint caches, altitude,
frequency, power and receiver changes no longer re-integrate the pattern at all.

## Per-moment main-thread cost in the browser (SWIFTSHADER, 1280 × 800, balanced)

`solves` = system evaluations that missed the cache; times are CPU ms on this machine.
Frame times are dominated by the CPU rasteriser and are given only for relative comparison.

| Moment | frames | avg / p95 / max frame ms | solves | solve ms total (max) | BEAM LAB rebuild ms |
|---|---|---|---|---|---|
| satellite idle (3 s) | 2 | 458 / 833 / 833 | 0 | 0 | — |
| phase steering tween (26 steps) | 51 | 831 / 917 / 1152 | 26 | 116 (13) | — |
| satellite → BEAM LAB | 89 | 1590 / 2300 / 4050 | 0 | 0 | 48.7 |
| radiation surface update (N 8/16/32/16) | 11 | 964 / 1417 / 1417 | 7 | 17 (13) | 29.7 |
| grating appearance (d 0.50 → 1.00) | 129 | 708 / 1167 / 1683 | 71 | 274 (13) | 22.9 |
| Earth footprint update (θ 0 → 40°) | 413 | 915 / 1917 / 2183 | 29 | 93 (13) | — |
| poster idle (3 s) | 11 | 533 / 800 / 800 | 0 | 0 | — |

Before the satellite-panel chart fix the steering tween cost 156 solves for 26 steps (the payload
chart re-evaluated 5 ADC variants each step); after the fix: 26 (one per state).

## Quick Demo × 5 (SWIFTSHADER, 1280 × 800)

| Run | wall s | planned s | frames | avg ms | p95 | p99 | max | long | geo | tex | prog | heap MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 87.6 | 15.3 | 87 | 996 | 2067 | 4700 | 4700 | 84 | 113 | 23 | 69 | 26 |
| 2 | 90.4 | 15.3 | 89 | 1009 | 2167 | 5016 | 5016 | 84 | 113 | 23 | 69 | 26 |
| 3 | 89.3 | 15.3 | 89 | 996 | 2233 | 4766 | 4766 | 83 | 113 | 23 | 69 | 27 |
| 4 | 87.2 | 15.3 | 88 | 976 | 2183 | 4900 | 4900 | 83 | 113 | 23 | 69 | 26 |
| 5 | 86.5 | 15.3 | 88 | 975 | 2133 | 4833 | 4833 | 84 | 113 | 23 | 69 | 27 |

- Geometries, textures and programs are identical after every run; heap 26–27 MB — no growth.
- Designed duration 15.3 s (8.2 s of motion under reduced motion). Wall time ≫ designed time
  because SwiftShader frames take ~1 s and the loop clamps dt to 0.1 s.

## Browser checks (SWIFTSHADER): 17 + 3 EMULATED mobile, all passed

P0: array normal = body −Y; steering 0 → 40° leaves the satellite sub-array, tiles and BEAM LAB panel
quaternions unchanged while the beam axis and footprint move. Quick Demo ends on the poster; Try it
updates footprint and strip; Explore freely; Esc restores mode/params/chrome; X-ray emphasis;
`?view=poster` reproducible; Engineering Demo completes; reduced motion; landing; grating demo
(lobe + secondary footprint); array compare. EMULATED 390×844, 430×932, 844×390: Quick Demo →
poster with satellite and footprint unobstructed, no target < 44 px, Try-it by touch.

# V4 fix verification (2026-10-03, base 9fb5076 → feature/v4-fix)

Chromium headless, **SWIFTSHADER**, font requests blocked (system-font fallback). Mobile = **EMULATED**
390 × 844, DPR 3, touch. No hardware-GPU or real-device measurement.

| Quick Demo, single run, no hold extension | planned (critical path) | wall |
|---|---|---|
| V4 main (previous report, 1280 × 800) | 15.3 s (overlap double-counted) | 87–90 s |
| fix, desktop 1440 × 900, Auto | 14.0 s | 23.3 s |
| fix, mobile 390 × 844 DPR 3, Auto | 14.0 s | 19.2 s |

Wall time falls because scripted camera flights now follow the wall clock (the simulation keeps its
0.1 s dt cap). This is not a statement about 15 s on real devices.

Acceptance (18/18, 0 page errors): landing without title/causal overlap or horizontal overflow
(desktop, mobile); poster overlays do not overlap; at θ₀ = 0/25/50° the full projected −3 dB contour
(72 points) and the hero lie inside the free viewport (desktop, mobile); key callouts present under
Auto quality; Quick Demo end equals `?view=poster` (camera, target, up, params) on desktop and mobile;
panel normal · nadir = 1.0 and quaternion fixed for θ 0/40°, φ 0/90/180° (SATELLITE) and at 3 orbit
positions (COSMOS); Skip restores mode/labels/params/presentation/poster view and releases the
retained route; reduced motion ends on the poster with a working slider.

Not done here: first-visitor comprehension test (suggested: 4 of 5 explain phase → beam →
footprint → link), real iPhone/Surface/GPU timing, screen-reader pass.

# V4 follow-up verification (2026-10-03, base 22fe9b2 → feature/v4-followup)

Chromium 141.0.7390.37 headless, **SWIFTSHADER** (CPU rasteriser), font requests blocked.
Desktop 1440 × 900 DPR 1; mobile = **EMULATED** 390 × 844, DPR 3, touch (Auto quality renders at
DPR 0.75 there). No hardware GPU, no real iPhone/Surface, no first-visitor comprehension test.
Harness: `scripts/demo-flows.mjs` (real buttons; see docs/demo-state-contract.md).

## Demo state contract — same harness on both builds

| Scenario (real UI path) | base 22fe9b2 | follow-up |
|---|---|---|
| poster (steer 40°) → Replay → Skip at q-phase | ✗ ends at `level=array` with the poster card | ✓ Cosmos poster, steer 40°, orbit t=0 paused, camera Δ 0 |
| … Skip at q-beam / q-footprint | ✗ orbit resumed / Skip unreachable | ✓ / ✓ |
| landing → Run → Skip at q-beam | ✗ landing card over Cosmos | ✓ Satellite landing, camera Δ 0 |
| explore (thermal, labels off, N=12, 33°) → ▶ Beam demo → Skip | ✗ (harness wait too short on base; state restored) | ✓ store restored, stays at the settled level, rail navigation works |
| poster → Why 0.5λ matters / Engineering demo: start | ✗ poster card + presentation kept | ✓ card gone, presentation off, signal + labels |
| … completion | ✗ poster card over exploration | ✓ Cosmos overview (camera = home, Δ ≈ 1e-13), orbit running, results kept, toast on top, callout → inspector |
| poster → Engineering → Skip | ✗ `level=array` + poster | ✓ poster with the user's 10° and orbit |
| navigation (scale rail) during Engineering | ✗ (no reason tracking; level reached) | ✓ PAYLOAD is final, reason `navigate` |
| double Skip / Skip → immediate Replay | ✗ / ✗ (base has no end reason; Replay state correct) | ✓ / ✓ |
| Skip during preparation | ✓ | ✓ |
| Explore freely in the Link segment (slider 45°) | ✗ (no reason; state correct) | ✓ exploration, orbit running, 45° kept |
| Try-it slider in the Link segment | ✗ (no reason; state correct) | ✓ poster keeps 12° |
| resize 1440 ↔ 390 at 0/25/50° | ✓ (old frame happened to fit; not reframed) | ✓ reframed at each size, back to Δ 0 at 1440 |
| **total** | **5 / 20** | **20 / 20**, 0 page errors |

Additional follow-up checks (5/5): SATELLITE and COSMOS (orbit t = 0, 13, 37 s) panel normal ·
nadir = 1.000000000 with the attitude unchanged (q ≡ −q) for θ 0/40°, φ 0/90/180°; steering changes
the beam axis; reduced motion Quick → poster with a working slider (planned 7.8 s); reduced-motion
Skip → landing.

The reported resize defect (centre x ≈ 486 px) did not reproduce with this procedure on the base;
the follow-up recomputes the frame anyway. Found during verification: on a software renderer the
caption fade stalled during the Cosmos transition and made **Skip** invisible for ~3 s — now only
the caption text fades.

## Mobile footprint (390 × 844 emulated, poster)

Projected 3D contour bounding box: 24 × 3.6 px (0°), 30 × 3.3 px (25°), 80 × 5.6 px (50°); before,
25° was ≈ 31 × 3.5 px under the terminal glow. The terminal marker is now 0.3× in presentation and
the fill denser, so the outline is no longer covered, but it is still a sliver: the poster shows
the **Footprint detail · enlarged** inset (same BeamSolution, solver tangent plane, equal axes,
km scale bar).

## Quick Demo timing (single runs, no `demoHold`, desktop then mobile — never concurrent)

`first` = ▶ Run from the landing; `replay` = ▶ Replay on the finished poster. `cold` = the app had
to build a level during preparation (after a completed run at Cosmos, BEAM LAB is evicted).
Base has no timing API: only the harness wall time (click → demo idle).

| build | viewport | run | preparation | playback | finish | total | planned (critical path) | harness |
|---|---|---|---|---|---|---|---|---|
| base | desktop | first | – | – | – | – | 14.0 s | 32.5 s |
| base | desktop | replay | – | – | – | – | 15.2 s | 31.0 s |
| base | mobile | first | – | – | – | – | 14.0 s | 27.6 s |
| base | mobile | replay | – | – | – | – | 15.2 s | 29.9 s |
| follow-up | desktop | first (warm) | 0.01 s | 28.29 s | 0.01 s | 28.30 s | 14.0 s | 31.4 s |
| follow-up | desktop | replay (cold) | 0.13 s | 27.98 s | 0.00 s | 28.11 s | 15.2 s | 31.0 s |
| follow-up | mobile | first (warm) | 0.01 s | 25.44 s | 0.00 s | 25.45 s | 14.0 s | 27.3 s |
| follow-up | mobile | replay (cold) | 0.12 s | 24.55 s | 0.00 s | 24.67 s | 15.2 s | 25.8 s |

Playback exceeds the 14 s design on this CPU rasteriser (parameter tweens advance per rendered
frame; scale steps keep the dt cap). These numbers are not phone/laptop timings and do not show
whether the demo completes in 15 s on real hardware. The earlier report's 20.5 / 16.2 s were taken
with Auto quality in a different session; this table uses `balanced` for both builds.
