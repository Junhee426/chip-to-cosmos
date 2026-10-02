import type { LevelId } from '../app/navigation';
import type { ModelMeta } from '../models/meta';
import { ADC_META } from '../models/adc';
import { ARRAY_META } from '../models/array-factor';
import { LINK_META } from '../models/link-budget';
import { MODULATION_META } from '../models/modulation';
import { MOSFET_META } from '../models/mosfet';
import { POWER_META } from '../models/power';
import { RF_META } from '../models/rf';
import { SEMICONDUCTOR_META } from '../models/semiconductor';

export interface LevelTheory {
  intuition: string[];
  engineering: string[];
  models: ModelMeta[];
  /** what in the 3D view is illustrative (not calculated) */
  illustrative: string[];
}

export const THEORY: Record<LevelId, LevelTheory> = {
  cosmos: {
    intuition: [
      'Hundreds of satellites circle Earth every ~95 minutes, each covering a small patch of ground. Together they form a moving mesh network in the sky.',
      'Your signal travels up to one satellite, can hop between satellites by laser, and comes back down near its destination.',
    ],
    engineering: [
      'A Walker-delta constellation spreads P orbital planes evenly in RAAN, with S satellites per plane and a phasing factor F between planes.',
      'Link quality depends on slant range, which grows quickly as elevation drops: R = √((Re+h)² − (Re cos El)²) − Re sin El. Free-space loss grows as 20·log10(R).',
      'The blue footprint is the −3 dB contour of the BEAM LAB array pattern, carried array → spacecraft → Earth frame and intersected with the spherical Earth. The user terminal sits at its centre, so steering sets the elevation and slant range used by the link budget.',
      'Optical inter-satellite links (ISLs) route traffic in space, reducing the number of gateways needed on the ground.',
    ],
    models: [LINK_META],
    illustrative: ['Satellite and terminal markers are enlarged (shrinking as you zoom in)', 'Orbital motion is time-lapsed ×95', 'Van Allen belt shapes are schematic', 'The −3 dB footprint is drawn ~6 km above the surface to stay visible'],
  },
  satellite: {
    intuition: [
      'A communication satellite is a flying radio station powered by sunlight: solar wings make electricity, a battery covers eclipse, radiators throw away heat.',
      'The flat panels on the Earth-facing side are phased arrays that steer many beams electronically — no moving parts.',
    ],
    engineering: [
      'Power chain: Solar Array → PCDU (MPPT, regulation) → Battery / Loads. Orbit-average power must cover payload + bus with margin.',
      'Thermal chain: every watt not radiated as RF becomes heat (Q = P_DC − P_RF) conducted to a radiator sized by A = Q / (εσ(T⁴ − T_sink⁴)).',
      'Switch to POWER, THERMAL, SIGNAL and RADIATION modes to see each subsystem path in the same model.',
    ],
    models: [POWER_META],
    illustrative: ['Component layout is generic and plausible, not a specific spacecraft', 'Flow particle speeds are illustrative'],
  },
  array: {
    intuition: [
      'Many small antennas transmit the same signal with slightly different delays. Where their waves line up, they add; elsewhere they cancel.',
      'Changing the phase step between neighbours tilts the direction where waves line up — the beam steers with no moving parts.',
    ],
    engineering: [
      'Gain scales with the number of elements (≈ 10·log10(N²) for an N×N tile) and beamwidth shrinks as ≈ 0.886·λ/(N·d·cos θ₀) for uniform weights.',
      'Amplitude tapers (Hann, Hamming) lower sidelobes but widen the beam and cost some gain (taper efficiency).',
      'Spacing above λ/(1+|sin θ₀|) lets grating lobes appear: full-strength copies of the beam in wrong directions. If such a lobe reaches the ground it illuminates a second area (amber) — interference and direction ambiguity.',
      'The white ring on the radiation surface and the edge rays mark the −3 dB contour; projected on the ground it is the beam footprint. Here the ground is a flat plane (distance compressed); COSMOS intersects the same contour with the spherical Earth.',
    ],
    models: [ARRAY_META],
    illustrative: ['Wavefront rings: spacing = λ and orientation ⟂ the calculated beam; speed and ring size are schematic', 'Distance to the BEAM LAB ground plane is compressed (directions are exact)'],
  },
  payload: {
    intuition: [
      'The payload is a chain: catch a faint signal, amplify it without adding much noise, shift it to a convenient frequency, digitise it, process it, and send it out again with lots of power.',
      'The first amplifier matters most: noise added early is amplified by everything after it.',
    ],
    engineering: [
      'Friis cascade: F = F1 + (F2−1)/G1 + (F3−1)/(G1G2) + … — a low-noise, high-gain LNA makes later stages nearly irrelevant.',
      'Sampling at fs > 2 f_max avoids aliasing; each extra ADC bit adds ≈ 6 dB of quantisation SNR but roughly doubles converter power.',
      'Higher-order modulation (16/64QAM) packs more bits per symbol but needs more Eb/N0 for the same bit-error rate.',
    ],
    models: [RF_META, ADC_META, MODULATION_META],
    illustrative: ['Module shapes are generic', 'ADC effective noise figure is a lumped equivalent'],
  },
  pcb: {
    intuition: [
      'The circuit board is a city of copper roads stacked in layers: fast signals on top, solid ground planes as quiet “floors”, power planes feeding every chip.',
    ],
    engineering: [
      'RF lines are controlled-impedance microstrip (50 Ω); a continuous ground plane beneath carries the return current.',
      'Hundreds of decoupling capacitors around the SoC supply fast current transients; buck converters generate the 0.8 V core rail at tens of amps.',
      'Shield cans isolate sensitive receivers from digital switching noise.',
    ],
    models: [],
    illustrative: ['Routing artwork is procedurally generated', 'Board thickness exaggerated to show the stack-up'],
  },
  package: {
    intuition: [
      'A chip package is an adapter: it connects microscopic wires on silicon to millimetre-scale solder balls on the board, and gets the heat out.',
    ],
    engineering: [
      '2.5D integration places logic and memory side-by-side on a silicon interposer; thousands of short RDL wires give huge bandwidth.',
      'Signal and power pass die → micro-bumps → interposer (RDL/TSV) → C4 bumps → organic substrate → BGA → PCB.',
      'Heat flows die → TIM → integrated heat spreader → cold plate.',
    ],
    models: [],
    illustrative: ['Bump counts reduced for display', 'Thin layers (TIM, interposer) exaggerated vertically'],
  },
  die: {
    intuition: [
      'On a single square of silicon sit radios, converters, processors and memory — each a neighbourhood of millions to billions of transistors.',
    ],
    engineering: [
      'Mixed-signal floorplans separate quiet analog/RF blocks from noisy digital logic with guard rings and separate supplies.',
      'THERMAL mode colours blocks by power density computed from the system model: raising ADC bits or sample rate heats the ADC and DSP blocks.',
      'SRAM is the most radiation-sensitive area (single-event upsets); ECC and scrubbing correct flipped bits.',
    ],
    models: [ADC_META],
    illustrative: ['Block placement is a plausible generic floorplan', 'BEOL stack vertical scale ×200'],
  },
  mosfet: {
    intuition: [
      'A MOSFET is a voltage-controlled valve for electrons. Raising the gate voltage pulls electrons to the surface, forming a conducting channel between source and drain.',
      'Raise Vds and the channel near the drain thins out until it “pinches off” — current then stops growing much: saturation.',
    ],
    engineering: [
      'Below threshold (Vgs < Vth) no inversion channel exists (this simplified model sets Id = 0).',
      'Triode: Id grows ~linearly with Vds. Saturation (Vds ≥ Vgs − Vth): Id ≈ ½ µnCox (W/L)(Vgs − Vth)² — quadratic in overdrive.',
      'Higher temperature lowers mobility (µ ∝ T^−1.5) and threshold voltage: at high overdrive current falls with T.',
      'Current continuity means electrons speed up where the channel is thin: the drift animation uses v(x) ∝ 1/Q(x).',
    ],
    models: [MOSFET_META],
    illustrative: ['Geometry not to scale (oxide thickened ×6)', 'Depletion extent is schematic', 'Electron count scales with computed sheet density, not 1:1'],
  },
  silicon: {
    intuition: [
      'Silicon atoms hold hands with four neighbours through shared electron pairs. Heat shakes the lattice; occasionally a bond breaks, freeing an electron and leaving a hole.',
      'Adding a phosphorus atom brings an extra electron that is barely held — it roams freely at room temperature (n-type).',
    ],
    engineering: [
      'Intrinsic carrier density ni = √(NcNv)·exp(−Eg/2kT) rises steeply with temperature — the reason electronics leak more when hot.',
      'Doping (10¹⁵–10²⁰ cm⁻³) sets carrier densities far above ni; n·p = ni² in equilibrium.',
    ],
    models: [SEMICONDUCTOR_META],
    illustrative: ['Vibration amplitude ∝ √T is schematic', 'Number of broken bonds shown tracks log10(ni), not the true count'],
  },
  energy: {
    intuition: [
      'Electrons live on energy “floors”. The conduction band is an almost-empty floor where electrons move freely; the valence band is a nearly full floor where holes move.',
      'At a PN junction the floors bend, making a hill electrons must climb. Forward bias lowers the hill; current grows exponentially.',
    ],
    engineering: [
      'Built-in potential Vbi = (kT/q) ln(NaNd/ni²) ≈ 0.85 V for 10¹⁷/10¹⁷ cm⁻³ with this parameter set.',
      'Depletion width W = √(2εs(Vbi − Vd)/q · (1/Na + 1/Nd)) shrinks under forward bias and grows under reverse bias.',
      'Diode current I = Is[exp(Vd/nVt) − 1]; the quasi-Fermi levels split by exactly qVd.',
    ],
    models: [SEMICONDUCTOR_META],
    illustrative: ['Carrier motion is schematic; band positions and depletion width are calculated'],
  },
};
