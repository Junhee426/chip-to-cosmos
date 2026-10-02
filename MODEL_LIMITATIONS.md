# Model limitations & scientific integrity

Chip to Cosmos uses **simplified, educationally valid models**. It is not TCAD, not a
spacecraft design tool and not a certified link-budget calculator. Every model's metadata
(`src/models/*_META`) lists equations, units, assumptions, validity and references, and is
shown in each level's THEORY tab.

## Calculated vs illustrative

| Visual element | Status |
|---|---|
| MOSFET channel thickness, pinch-off, Id, region, graphs | **Calculated** (square-law, gradual channel) |
| MOSFET electron count & speed | Driven by calculated sheet density and Id; count is scaled, not 1:1 |
| MOSFET depletion extent, oxide field arrows | Illustrative (scaled by Vgs / Vds) |
| Band edges, depletion width, Fermi split (ENERGY) | **Calculated** (depletion approximation) |
| Carrier motion in ENERGY | Illustrative |
| Lattice geometry (SILICON) | **Exact** diamond-cubic positions, a = 0.5431 nm |
| Lattice vibration, number of broken bonds | Illustrative (∝ √T, ∝ log10 ni) |
| 3D radiation surface, phase colours, polar plot (BEAM LAB) | **Calculated** array factor × element pattern |
| Wavefront rings | Illustrative spacing/speed; spacing = λ, orientation ⟂ calculated beam axis |
| −3 dB footprint, flat ground (BEAM LAB) | **Calculated** contour; distance to the ground plane compressed for display |
| −3 dB footprint, spherical Earth (COSMOS, SATELLITE) | **Calculated** ray–sphere intersection of the same contour |
| Grating-lobe directions and secondary footprints | **Calculated** (only drawn when ≥ −10 dB and the lobe reaches the Earth) |
| Hero demo captions | Read from the calculation at display time; camera paths illustrative |
| Link budget, coupling strip | **Calculated** |
| Die thermal colours | **Calculated** relative power density from the system model |
| Satellite / payload / PCB / package geometry | Generic, plausible, not a specific product |
| Flow particles (signal / power / thermal) | Illustrative paths; mode logic follows real subsystem topology |
| Radiation particle tracks | Illustrative |
| Constellation markers | Enlarged ~2000×; motion time-lapsed ×95 |

## Known simplifications

- **Silicon ni**: the Sze 300 K Nc/Nv set gives ni(300 K) ≈ 6×10⁹ cm⁻³ instead of the modern
  accepted ≈ 9.7×10⁹ cm⁻³. Order of magnitude and temperature trend are correct.
- **MOSFET**: no subthreshold conduction, velocity saturation, DIBL, mobility degradation,
  quantum effects; oxide field approximated as Vgs/tox; long-channel only.
- **Friis**: matched stages, the ADC is represented by an equivalent noise figure.
- **ADC**: ideal quantiser; ENOB = N − 1 in the power trend; Walden FOM power is an
  order-of-magnitude estimate.
- **Modulation**: AWGN only, perfect synchronisation, no coding in the BER curves (the link
  budget's required Eb/N0 assumes ~6 dB LDPC gain); Monte-Carlo SER has statistical error.
- **Array**: isolated identical elements (no mutual coupling or scan blindness), ideal phase
  shifters, gain = directivity × 70 %.
- **Link**: free space + lumped 3 dB losses; no rain fade, Doppler, interference or polarisation
  mismatch statistics. The user is assumed at the beam centre (peak gain); edge-of-beam users would
  see up to 3 dB less.
- **Footprint**: spherical Earth (no oblateness or terrain); the spacecraft is nadir-pointing with
  zero yaw; along/cross-track extents and area are measured in the tangent plane at the beam centre
  (accurate while the footprint ≪ Earth radius; near the limb the contour may be clipped and is
  flagged). The beam maximum includes element-pattern squint, searched in the scan plane.
- **Beam steering**: electronic only. The array panel is fixed to the nadir deck and stays Earth-facing;
  steering changes ideal, continuous element phases (no quantisation, no scan blindness, no mutual
  coupling), not the panel orientation.
- **Satellite markers and camera**: in COSMOS and on the poster the satellite is enlarged for
  visibility; camera paths, pulses and particles are illustrative. Footprint, gain, EIRP and link
  margin are calculated.
- **Power scaling**: in *fixed per element* mode the total RF power grows with N², so changing N
  changes EIRP by both directivity and power; *fixed total RF* isolates the directivity effect.
- **Power/thermal**: orbit-average, single-node radiator at 300 K, effective sink 200 K,
  β = 0 eclipse.
- **Geometry**: several levels are not to scale (flagged `NOT TO SCALE` in the HUD); thin layers
  are exaggerated for legibility.
