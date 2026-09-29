/** Nice tick generation for linear and log axes (pure, testable). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const a = Math.ceil(Math.log10(lo) - 1e-9);
  const b = Math.floor(Math.log10(hi) + 1e-9);
  const every = Math.max(1, Math.ceil((b - a + 1) / 6));
  for (let e = a; e <= b; e += every) out.push(Number(`1e${e}`));
  return out;
}

export interface Scale {
  (v: number): number;
  invert(px: number): number;
  domain: [number, number];
  log: boolean;
}

export function makeScale(domain: [number, number], range: [number, number], log = false): Scale {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const f = ((v: number) => {
    const x = log ? Math.log10(Math.max(v, domain[0] * 1e-3)) : v;
    return range[0] + ((x - d0) / (d1 - d0)) * (range[1] - range[0]);
  }) as Scale;
  f.invert = (px: number) => {
    const x = d0 + ((px - range[0]) / (range[1] - range[0])) * (d1 - d0);
    return log ? Math.pow(10, x) : x;
  };
  f.domain = domain;
  f.log = log;
  return f;
}

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e4 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    return `${Math.abs(m - 1) < 1e-9 ? '' : m.toFixed(0) + '×'}10${sup(e)}`;
  }
  return Number(v.toPrecision(3)).toString();
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export const sup = (n: number): string => String(n).split('').map((c) => SUP[c] ?? c).join('');
