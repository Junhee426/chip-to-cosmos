# Theory & equations

Every equation below is implemented in `src/models/` and is actually evaluated —
by the charts, the live equation read-outs and (where noted) the 3D geometry.

## Semiconductor (`models/semiconductor.ts`)

- Band gap (Varshni): `Eg(T) = Eg0 − αT²/(T+β)`, Eg0 = 1.17 eV, α = 4.73×10⁻⁴ eV/K, β = 636 K
- Effective DOS: `Nc,v(T) = Nc,v(300)·(T/300)^1.5`, Nc = 2.8×10¹⁹, Nv = 1.04×10¹⁹ cm⁻³
- Intrinsic density: `ni = √(Nc Nv) · exp(−Eg / 2kT)`
- Doped sample: `n = (Nd−Na)/2 + √(((Nd−Na)/2)² + ni²)`, `p = ni²/n`
- Built-in potential: `Vbi = (kT/q) ln(Na Nd / ni²)`
- Depletion width: `W = √(2εs(Vbi−Vd)/q · (1/Na + 1/Nd))`; ψ(x) piecewise-parabolic → **drives the 3D band surfaces**
- Diode: `I = Is [exp(Vd/nVt) − 1]`

## MOSFET — Simplified Educational Model (`models/mosfet.ts`)

- `Cox = εox/tox` (tox = 5 nm), `µn(T) = 400·(T/300)^−1.5`, `Vth(T) = 0.7 − 2 mV/K·(T−300)`
- Cut-off (Vgs < Vth): `Id = 0` (subthreshold deliberately ignored)
- Triode: `Id = µnCox(W/L)[(Vgs−Vth)Vds − Vds²/2]`
- Saturation: `Id ≈ ½ µnCox(W/L)(Vgs−Vth)²(1 + λ(Vds − Vds,sat))`
- Channel charge profile (gradual channel): `Q(x)/Q(0) = √(1 − (x/L)(2VovVde − Vde²)/Vov²)`, Vde = min(Vds, Vov)
  → **sets the 3D inversion-layer thickness and pinch-off**; electron drift speed uses continuity `v(x) ∝ 1/Q(x)`

## RF (`models/rf.ts`)

- Friis: `F = F1 + (F2−1)/G1 + (F3−1)/(G1G2) + …`, `Te = 290 K·(F−1)`
- Noise floor: `N = −174 dBm/Hz + 10log10(B) + NF`

## ADC (`models/adc.ts`)

- Nyquist `fs > 2 f_max`; alias `f_a = |f − fs·round(f/fs)|`
- Ideal quantisation SNR `6.02N + 1.76 dB` (also *measured* on a simulated record)
- Power trend (Walden): `P = FOM · 2^ENOB · fs`, FOM = 0.5 pJ/step

## Modulation (`models/modulation.ts`)

- `Pb(BPSK) = Pb(QPSK) = Q(√(2Eb/N0))`
- `Pb(M-QAM) ≈ (4/log₂M)(1−1/√M) Q(√(3 log₂M Eb/N0 /(M−1)))`
- `Es/N0 = Eb/N0 + 10log10(log₂M)`; constellation cloud is a seeded AWGN Monte-Carlo

## Phased array (`models/array-factor.ts`)

- `AF(θ) = Σ wₙ exp[jn(kd sinθ + φₙ)]`, steering `φₙ = −n·kd sinθ₀`
- Planar separable AF `AFx(ψx)·AFy(ψy)`, element pattern `cos^q θ` (q = 1.3)
- Directivity by numerical integration: `D = 4π U_max / ∯U dΩ`
- Grating-lobe free if `d/λ < 1/(1+|sinθ₀|)`
- **The 3D radiation surface is built vertex-by-vertex from |AF·EP| in dB**

## Link budget (`models/link-budget.ts`)

- Slant range `R = √((Re+h)² − (Re cos El)²) − Re sin El`
- `FSPL = 20log10(4πR/λ)`, `EIRP = Pt + Gt`, `Pr = Pt + Gt + Gr − FSPL − L`
- `C/N0 = EIRP + G/T − FSPL − L + 228.6`, `Eb/N0 = C/N0 − 10log10(Rb)`, margin vs. required Eb/N0
- Units: W → dBW (`10log10 P`), dBm = dBW + 30, gains in dBi, losses in dB

## Power & thermal (`models/power.ts`, `models/system-model.ts`)

- Solar: `P = S·A·η·cosθ·D·f_sun`, eclipse fraction `asin(Re/(Re+h))/π` (β = 0)
- Heat `Q = P_DC − P_RF,radiated`; radiator `A = Q/(εσ(T⁴ − T_sink⁴))`
- Package: `Tj = T_cp + P(θ_IHS + θ_TIM + θ_die)`

## Cross-scale coupling (`models/system-model.ts`)

```
ADC bits, fs ─▶ P_ADC (Walden) + P_DSP (∝ N·fs) ─▶ payload DC ─▶ heat ─▶ radiator area
N×N array, taper ─▶ directivity (numerical) ─▶ gain ─▶ EIRP ─▶ Pr, C/N0, Eb/N0 ─▶ margin
PA output × N² / PAE ─▶ DC power ─▶ power margin and heat
```
