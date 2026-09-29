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

## Roadmap (post-V1)

- Doppler & rain-fade (ITU-R P.618) in the link budget; interference (C/I)
- Subthreshold & short-channel MOSFET options; FinFET/GAA cross-section
- Transient thermal network and eclipse battery DoD
- Phase-shifter quantisation, element failures and mutual coupling in the array
- Optional glTF assets for higher-fidelity hardware, KTX2 textures
- Localisation (Korean / English)
