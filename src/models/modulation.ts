import type { ModelMeta } from './meta';
import { dbToRatio, gaussian, mulberry32, qFunc } from './units';

export type Modulation = 'BPSK' | 'QPSK' | '16QAM' | '64QAM';

export const BITS_PER_SYMBOL: Record<Modulation, number> = { BPSK: 1, QPSK: 2, '16QAM': 4, '64QAM': 6 };

export interface Point { i: number; q: number }

/** Ideal constellation normalised to unit average symbol energy (Es = 1). */
export function constellation(mod: Modulation): Point[] {
  if (mod === 'BPSK') return [{ i: -1, q: 0 }, { i: 1, q: 0 }];
  const m = 1 << BITS_PER_SYMBOL[mod];
  const side = Math.round(Math.sqrt(m));
  const pts: Point[] = [];
  for (let a = 0; a < side; a++) {
    for (let b = 0; b < side; b++) {
      pts.push({ i: 2 * a - (side - 1), q: 2 * b - (side - 1) });
    }
  }
  const es = pts.reduce((s, p) => s + p.i * p.i + p.q * p.q, 0) / pts.length;
  const k = 1 / Math.sqrt(es);
  return pts.map((p) => ({ i: p.i * k, q: p.q * k }));
}

/** Theoretical bit error probability in AWGN (Gray coding). */
export function berTheory(mod: Modulation, ebN0Db: number): number {
  const g = dbToRatio(ebN0Db);
  switch (mod) {
    case 'BPSK':
    case 'QPSK':
      return qFunc(Math.sqrt(2 * g));
    default: {
      const M = 1 << BITS_PER_SYMBOL[mod];
      const k = BITS_PER_SYMBOL[mod];
      // Nearest-neighbour approximation for square M-QAM with Gray mapping.
      return Math.min(0.5, (4 / k) * (1 - 1 / Math.sqrt(M)) * qFunc(Math.sqrt((3 * k * g) / (M - 1))));
    }
  }
}

export interface ConstellationSim {
  ideal: Point[];
  received: Point[];
  symbolErrors: number;
  ser: number;
  evmPct: number;
}

/**
 * Monte-Carlo AWGN simulation. snrDb is Es/N0 per symbol.
 * Complex noise variance per dimension = N0/2 with Es = 1.
 */
export function simulateConstellation(mod: Modulation, esN0Db: number, nSymbols = 1500, seed = 7): ConstellationSim {
  const ideal = constellation(mod);
  const rand = mulberry32(seed);
  const n0 = 1 / dbToRatio(esN0Db);
  const sigma = Math.sqrt(n0 / 2);
  const received: Point[] = [];
  let errors = 0;
  let evmNum = 0;
  for (let s = 0; s < nSymbols; s++) {
    const idx = Math.floor(rand() * ideal.length);
    const tx = ideal[idx];
    const rx = { i: tx.i + sigma * gaussian(rand), q: mod === 'BPSK' ? tx.q + sigma * gaussian(rand) : tx.q + sigma * gaussian(rand) };
    received.push(rx);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < ideal.length; k++) {
      const d = (rx.i - ideal[k].i) ** 2 + (rx.q - ideal[k].q) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best !== idx) errors++;
    evmNum += (rx.i - tx.i) ** 2 + (rx.q - tx.q) ** 2;
  }
  return { ideal, received, symbolErrors: errors, ser: errors / nSymbols, evmPct: 100 * Math.sqrt(evmNum / nSymbols) };
}

export const esN0FromEbN0 = (mod: Modulation, ebN0Db: number): number => ebN0Db + 10 * Math.log10(BITS_PER_SYMBOL[mod]);

export const MODULATION_META: ModelMeta = {
  id: 'modulation',
  title: 'Digital modulation in AWGN',
  equations: [
    'Pb(BPSK) = Q(√(2Eb/N0))',
    'Pb(QPSK, Gray) = Q(√(2Eb/N0))',
    'Pb(M-QAM) ≈ (4/log₂M)(1 − 1/√M) · Q(√(3·log₂M·Eb/N0 / (M−1)))',
    'Es/N0 = Eb/N0 + 10log10(log₂M)',
  ],
  units: ['Eb/N0, Es/N0: dB', 'Pb: probability', 'EVM: % rms'],
  assumptions: ['Additive white Gaussian noise only', 'Perfect carrier/timing sync', 'Gray mapping, hard decisions, no FEC'],
  validity: 'AWGN channel; M-QAM formula accurate for Pb ≲ 10⁻²',
  limitations: ['No fading, phase noise, PA non-linearity or coding gain', 'Scatter uses a finite seeded sample; SER estimate has statistical error'],
  reference: 'J. G. Proakis, Digital Communications; B. Sklar, Digital Communications',
  kind: 'calculated',
};
