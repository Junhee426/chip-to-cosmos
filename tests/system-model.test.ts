import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/app/state';
import { systemInput } from '../src/app/system';
import { evaluateSystem } from '../src/models/system-model';
import { junctionTemperatures, radiatorAreaM2 } from '../src/models/power';

describe('cross-scale causality', () => {
  const base = evaluateSystem(systemInput(DEFAULT_PARAMS));

  it('ADC bits ↑ → quantisation SNR ↑ → processing power ↑ → payload power ↑ → heat ↑ → radiator ↑', () => {
    const more = evaluateSystem(systemInput({ ...DEFAULT_PARAMS, adcBits: 12 }));
    expect(more.quantSnrDb).toBeGreaterThan(base.quantSnrDb);
    expect(more.adcPowerW + more.dspPowerW).toBeGreaterThan(base.adcPowerW + base.dspPowerW);
    expect(more.payloadDcW).toBeGreaterThan(base.payloadDcW);
    expect(more.heatW).toBeGreaterThan(base.heatW);
    expect(more.radiatorM2).toBeGreaterThan(base.radiatorM2);
  });
  it('beam: more elements → gain ↑ → EIRP ↑ → Pr ↑ → margin ↑', () => {
    const big = evaluateSystem(systemInput({ ...DEFAULT_PARAMS, arrayN: 24 }));
    expect(big.gainDbi).toBeGreaterThan(base.gainDbi);
    expect(big.eirpDbw).toBeGreaterThan(base.eirpDbw);
    expect(big.link!.rxPowerDbw).toBeGreaterThan(base.link!.rxPowerDbw);
    expect(big.link!.marginDb).toBeGreaterThan(base.link!.marginDb);
  });
  it('energy balance: heat = load − radiated RF', () => {
    expect(base.heatW).toBeCloseTo(base.totalLoadW - base.rfRadiatedW, 9);
    expect(base.eirpDbw).toBeCloseTo(10 * Math.log10(DEFAULT_PARAMS.paOutW * DEFAULT_PARAMS.arrayN ** 2) + base.gainDbi, 9);
  });
  it('default design closes the link and the power budget', () => {
    expect(base.link!.marginDb).toBeGreaterThan(0);
    expect(base.powerMarginW).toBeGreaterThan(0);
  });
  it('radiator sizing and junction temperature', () => {
    expect(radiatorAreaM2(1000, 300)).toBeCloseTo(1000 / (0.85 * 5.670374419e-8 * (300 ** 4 - 200 ** 4)), 9);
    const t = junctionTemperatures(20, 40);
    expect(t.tj).toBeCloseTo(40 + 20 * 0.5, 9);
    expect(t.nodes).toHaveLength(4);
  });
});
