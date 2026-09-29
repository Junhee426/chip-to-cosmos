/** Minimal DOM helpers (no framework). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export function slider(o: SliderOpts): { el: HTMLElement; set: (v: number) => void } {
  const wrap = h('label', 'ctl');
  const head = h('div', 'ctl-head');
  const name = h('span', 'ctl-name', o.label);
  const val = h('span', 'ctl-val');
  head.append(name, val);
  const input = h('input');
  input.type = 'range';
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  input.value = String(o.value);
  const show = (v: number) => (val.textContent = `${o.format ? o.format(v) : v}${o.unit ? ` ${o.unit}` : ''}`);
  show(o.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    show(v);
    o.onInput(v);
  });
  wrap.append(head, input);
  return {
    el: wrap,
    set: (v: number) => {
      if (Number(input.value) !== v) input.value = String(v);
      show(v);
    },
  };
}

export function segmented<T extends string | number>(label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void): { el: HTMLElement; set: (v: T) => void } {
  const wrap = h('div', 'ctl');
  if (label) wrap.append(h('div', 'ctl-head', `<span class="ctl-name">${label}</span>`));
  const row = h('div', 'seg');
  const btns = options.map((opt) => {
    const b = h('button', 'seg-btn', opt.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      set(opt.value);
      onChange(opt.value);
    });
    row.append(b);
    return { b, v: opt.value };
  });
  const set = (v: T) => btns.forEach(({ b, v: bv }) => b.classList.toggle('on', bv === v));
  set(value);
  wrap.append(row);
  return { el: wrap, set };
}

export function section(title: string, kind?: 'calculated' | 'illustrative' | 'educational'): { el: HTMLElement; body: HTMLElement } {
  const el = h('section', 'psec');
  const badge = kind ? `<span class="badge badge-${kind}">${kind === 'educational' ? 'Simplified Educational Model' : kind.toUpperCase()}</span>` : '';
  el.innerHTML = `<header class="psec-head"><h3>${title}</h3>${badge}</header>`;
  const body = h('div', 'psec-body');
  el.append(body);
  return { el, body };
}

/** Key–value readout table; returns an updater. */
export function readout(rows: { key: string; label: string; unit?: string }[]): { el: HTMLElement; set: (vals: Record<string, string>) => void } {
  const table = h('div', 'readout');
  const cells = new Map<string, HTMLElement>();
  for (const r of rows) {
    const row = h('div', 'ro-row');
    const v = h('span', 'ro-val');
    row.append(h('span', 'ro-label', r.label), v, h('span', 'ro-unit', r.unit ?? ''));
    cells.set(r.key, v);
    table.append(row);
  }
  return {
    el: table,
    set: (vals) => {
      for (const [k, v] of Object.entries(vals)) {
        const c = cells.get(k);
        if (c && c.textContent !== v) c.textContent = v;
      }
    },
  };
}

export const fx = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—');
