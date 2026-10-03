import type { AppState, Store } from '../app/state';
import { solveSystem } from '../app/system';
import type { XrayKey } from '../app/xray';
import { REQUIRED_EBN0 } from '../models/system-model';
import { fx, h } from './dom';

const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${fx(Math.abs(v), d)}`;

/**
 * Link Budget X-ray: the downlink as a vertical chain, transmitter to decision.
 * Every value is read from the system model (same BeamSolution as the scenes).
 * Hover / focus a stage → the matching hardware or propagation path is
 * emphasised in 3D (store.emphasis); click pins it.
 */
export function linkXray(store: Store): { el: HTMLElement; update: (s: AppState) => void } {
  const el = h('div', 'xray');
  el.setAttribute('role', 'list');
  el.setAttribute('aria-label', 'Link budget chain, transmitter to receiver');
  const note = h('p', 'note', 'Hover or focus a stage to see where it happens. Calculated from the same beam state as the 3D scene.');
  const list = h('div', 'xray-list');
  el.append(note, list);
  let pinned: XrayKey | null = null;
  const emph = (k: XrayKey | null) => store.set({ emphasis: k });

  const update = (s: AppState) => {
    const sys = solveSystem(s.params);
    const b = sys.beam;
    const L = sys.link;
    const ptDbw = 10 * Math.log10(b.power.rfW);
    const rows: { k: XrayKey; name: string; value: string; unit: string; sub: string; kind: 'gain' | 'loss' | 'level' }[] = [
      { k: 'pa', name: 'PA OUTPUT', value: sgn(ptDbw), unit: 'dBW', sub: `${fx(b.power.rfW, 0)} W total · ${fx(b.power.perElementW, 2)} W / element`, kind: 'level' },
      { k: 'tx', name: 'TX ANTENNA', value: sgn(sys.gainDbi), unit: 'dBi', sub: `${b.input.arrayN}×${b.input.arrayN} phased array, Earth-facing`, kind: 'gain' },
      { k: 'eirp', name: 'EIRP', value: sgn(sys.eirpDbw), unit: 'dBW', sub: 'Pt + Gt', kind: 'level' },
    ];
    if (L) {
      rows.push(
        { k: 'path', name: 'FREE SPACE', value: sgn(-L.fsplDb), unit: 'dB', sub: `R = ${fx(L.rangeKm, 0)} km at El ${fx(L.elevationDeg, 0)}°`, kind: 'loss' },
        { k: 'losses', name: 'OTHER LOSSES', value: sgn(-3), unit: 'dB', sub: 'atmosphere, pointing, polarisation (lumped)', kind: 'loss' },
        { k: 'rx', name: 'RX ANTENNA', value: sgn(s.params.rxGainDbi), unit: 'dBi', sub: 'user terminal at the beam centre', kind: 'gain' },
        { k: 'rxpower', name: 'RECEIVED POWER', value: sgn(L.rxPowerDbm), unit: 'dBm', sub: `${fx(L.rxPowerDbw, 1)} dBW`, kind: 'level' },
        { k: 'ebn0', name: 'Eb/N0', value: fx(L.ebN0Db, 1), unit: 'dB', sub: `C/N0 ${fx(L.cn0DbHz, 1)} dB-Hz · ${fx(sys.dataRateBps / 1e6, 0)} Mb/s`, kind: 'level' },
        { k: 'margin', name: 'LINK MARGIN', value: sgn(L.marginDb), unit: 'dB', sub: `vs required ${fx(REQUIRED_EBN0[s.params.modulation], 1)} dB (${s.params.modulation})`, kind: 'level' },
      );
    }
    list.innerHTML = rows
      .map((r, i) => `${i ? '<div class="xr-arrow" aria-hidden="true">↓</div>' : ''}<button type="button" class="xr xr-${r.kind}${r.k === 'margin' && L && L.marginDb < 0 ? ' neg' : ''}${pinned === r.k ? ' on' : ''}" data-k="${r.k}" role="listitem" aria-pressed="${pinned === r.k}"><span class="xr-name">${r.name}</span><b>${r.value}<em>${r.unit}</em></b><small>${r.sub}</small></button>`)
      .join('') + (L ? '' : '<p class="note">Beam centre above the horizon — no ground link.</p>');
    for (const btn of list.querySelectorAll<HTMLElement>('.xr')) {
      const k = btn.dataset.k as XrayKey;
      btn.addEventListener('pointerenter', () => emph(k));
      btn.addEventListener('focus', () => emph(k));
      btn.addEventListener('pointerleave', () => emph(pinned));
      btn.addEventListener('blur', () => emph(pinned));
      btn.addEventListener('click', () => {
        pinned = pinned === k ? null : k;
        emph(pinned);
        for (const o of list.querySelectorAll<HTMLElement>('.xr')) {
          o.classList.toggle('on', o.dataset.k === pinned);
          o.setAttribute('aria-pressed', String(o.dataset.k === pinned));
        }
      });
    }
  };
  return { el, update };
}
