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
