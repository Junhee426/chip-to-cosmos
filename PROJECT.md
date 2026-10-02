# Project — Chip to Cosmos

## Goal

One continuous interactive 3D visualization that shows *how* the physics of
electrons in silicon constrains a LEO broadband network, and *how* network-level
decisions push back down to the chip. It is not a page-per-topic tutorial: every
scale lives in the same navigation system and is linked by calculated models.

## Scale hierarchy

| Level | Scene | Units (1 scene unit =) | Main calculated model |
|---|---|---|---|
| 0 COSMOS | Earth, 2-shell Walker constellation, ISLs, user downlink, Van Allen belts | 637 km | Link budget |
| 1 SATELLITE | Generic LEO broadband bus, cutaway, arrays, wings, radiator, EP | 1 m | Power & thermal balance |
| ↳ BEAM LAB | Planar phased array + 3D pattern | 1 cm | Array factor, directivity |
| 2 PAYLOAD | Line-replaceable modules in signal-chain order | 10 cm | Friis, ADC, modulation |
| 3 PCB | 10-layer board, RF section, SoC, PoL power | 1 cm | Rail currents |
| 4 CHIP | 2.5D package: IHS, lid, TIM, dies, µbumps, interposer, C4, substrate, BGA | 2.5 mm | Thermal stack Tj |
| 5 DIE | Functional floorplan, BEOL exhibit | 1 mm | Block power density |
| 6 MOSFET | NMOS cross-section, channel, fields, carriers | 100 nm | Square-law MOSFET |
| 7 SILICON | Diamond lattice, donor, e–h pairs | 0.1 nm | ni(T) |
| 8 ENERGY | PN-junction band diagram | ~ 50 nm | Depletion approx., Shockley diode |

## V1 status (vertical slice)

- [x] Seamless anchored zoom with frame renormalisation (all levels)
- [x] Breadcrumb + scale ladder navigation through the tree
- [x] Generic high-quality communication satellite with cutaway
- [x] Payload visualization + exploded view
- [x] PCB with multilayer stack-up explode
- [x] Semiconductor package exploded view (real layer thickness)
- [x] Die functional blocks
- [x] MOSFET 3D cross-section driven by the model
- [x] Signal / power / thermal / radiation flows
- [x] Engineering callouts with leader lines
- [x] Theory panel (INTUITION / ENGINEERING / THEORY) with model metadata
- [x] Interactive graphs (Id–Vgs, Id–Vds, Friis, ADC, BER, constellation, polar AF, link margin, ni(T), diode I–V, Tj)
- [x] Phased-array hero scene with AF-generated 3D radiation surface
- [x] Cross-scale causality strip
- [x] Cinematic skippable intro
- [x] Quality presets + adaptive pixel ratio, lazy-loaded levels, GPU residency limit
- [x] Unit tests for all models and navigation

## V2 status (structure · robustness · mobile · visual)

- [x] `main.ts` reduced to wiring; `src/runtime/` (renderer, render loop, input, viewport, performance)
- [x] WebGL 2 required explicitly, with a guidance page
- [x] ScaleManager: last-intent navigation, load/prepare failure recovery, no wedged busy state, reduced motion
- [x] Level-graph validator, parameter domain limits, input gesture state machine (all unit-tested)
- [x] Quality: layout vs GPU breakpoints separated, SSAO removed, feature-aware degradation
- [x] Accessibility: keyboard-reachable callouts and parts list, ARIA roles/states, focus rings
- [x] Landscape-phone inspector layout
- [x] Beam Lab: calculated −3 dB Earth footprint, λ-spaced wavefronts, phase legend
- [x] Satellite hero fidelity pass, calculated user beam in SIGNAL mode
- [x] Signal pulse grammar, exploded-view assembly guides, coupling-strip change highlighting
- [ ] Real-device (phone / Surface / GPU) frame-time measurements — not yet recorded
- [ ] Level construction spread over idle frames (first-visit hitch, see docs/performance-results.md)

## V3 status (hero demo: Satellite → Beam Lab → Earth footprint)

- [x] Shared `BeamSolution` (pattern, contour, flat + spherical footprints, grating lobes, power, link) memoised per state
- [x] Spherical-Earth footprint by ray–sphere intersection; horizon / no-hit handled without NaN
- [x] Coordinate frames centralised in `models/frames.ts` with unit tests
- [x] BEAM LAB, SATELLITE and COSMOS draw the same solution; link uses the visible beam-centre geometry
- [x] Explicit RF power mode (fixed per element / fixed total RF)
- [x] Hero demo (skippable, replayable, reduced-motion aware), causal strip, four hero controls, validated presets
- [x] Grating-lobe experiment with calculated secondary footprints; taper before/after
- [x] Satellite sub-array with the BEAM LAB element count, spacing and phase colours at the anchor
- [x] Hero harness: 9 captures, smoke checks, repeated-run resource counts, emulated mobile journey
- [ ] Hardware-GPU and real-device frame times for the demo — not yet recorded (SwiftShader only)
- [ ] Beam-squint is searched in the scan plane only (sub-0.1° effect off-plane, see MODEL_LIMITATIONS)

## V4 status (signature experience)

- [x] P0: Earth-facing array invariant — fixed mounting `ARRAY_TO_BODY`, zero steering → Earth centre (tests, any orbit frame)
- [x] P0: steering never rotates the panel (unit test on the mounting, browser test on the scene graphs)
- [x] P0: Quick Demo (~15 s) and the existing Engineering Demo in one controller (`play('quick' | 'engineering' | 'grating')`)
- [x] P0: poster frame + presentation mode, `?view=poster`, landing over the live satellite scene
- [x] P0: beam model profiled; AF sum 3–5× faster; pattern / footprint / link caches; slider and scene updates once per frame
- [x] P0: hero browser checks (`scripts/hero.mjs`)
- [x] P1: grating-lobe mini demo; main = solid, grating lobe = dashed + labelled "unintended illumination"
- [x] P1: Array Compare (8×8 vs 32×32, explicit power assumption) · Link Budget X-ray ↔ 3D emphasis
- [x] P1: mobile poster (3 metrics, Try it by touch) — **emulated** only
- [ ] Hardware-GPU and real-device frame times (phone / laptop) — not measured in this environment
- [ ] Web Worker for the beam model — not needed by the measurements (≤ 5 ms per state change on this CPU)

### Signature stories (structure for later versions)

1. **CHIP** — transistor → ADC/DSP → power → heat → radiator (exists as the coupling strip and the vertical slice; no scripted demo yet)
2. **BEAM** — phase → beam → footprint → link (**V4: Quick Demo, Engineering Demo, Grating Demo**)
3. **NETWORK** — orbit → visibility → handover → continuous service (design note below)

*Network demo design note.* COSMOS already has the pieces a handover story needs: the Walker
shells with per-slot orbit states, the hero orbit frame, a ground terminal placed by the beam
model, and per-satellite world positions each frame. A handover demo would (1) pin the terminal
at a fixed ground point instead of the beam centre, (2) compute elevation from the terminal to
every satellite with the same `elevationDeg` helper, (3) pick the serving satellite by a rule
(highest elevation with hysteresis), and (4) draw the serving link and a handover marker. Not
implemented in V4; multi-beam, frequency reuse and beam hopping are deliberately deferred until
the single-beam story is complete.

## Roadmap (post-V1)

- Doppler & rain-fade (ITU-R P.618) in the link budget; interference (C/I)
- Subthreshold & short-channel MOSFET options; FinFET/GAA cross-section
- Transient thermal network and eclipse battery DoD
- Phase-shifter quantisation, element failures and mutual coupling in the array
- Optional glTF assets for higher-fidelity hardware, KTX2 textures
- Localisation (Korean / English)
