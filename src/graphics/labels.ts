import * as THREE from 'three';

export interface LabelSpec {
  id: string;
  text: string;
  sub?: string;
  object: THREE.Object3D;
  /** anchor in the object's local space */
  local?: THREE.Vector3;
  group: string;
  /** higher = kept longer when label density drops (selected always wins) */
  priority?: number;
  onClick?: () => void;
}

interface LabelItem extends LabelSpec {
  el: HTMLDivElement;
  line: SVGPolylineElement;
  dot: SVGCircleElement;
  sx: number;
  sy: number;
  visible: boolean;
  highlighted: boolean;
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const _v = new THREE.Vector3();

/**
 * Engineering callouts: each 3D anchor is projected to screen and its label is
 * placed in a left or right column (technical-illustration style), with a
 * two-segment leader line. Columns are de-overlapped every frame.
 */
export class LabelLayer {
  private items: LabelItem[] = [];
  private svg: SVGSVGElement;
  private host: HTMLDivElement;
  private activeGroup: string | null = null;
  private opacity = 1;
  enabled = true;
  /** fraction of this level's callouts to show (graphics tier) */
  density = 1;
  /** hard cap for small screens (mobile shows few, essential callouts) */
  maxLabels = Infinity;
  insets: Insets = { left: 90, right: 380, top: 90, bottom: 110 };

  constructor(parent: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'label-layer';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('label-lines');
    this.host.appendChild(this.svg);
    parent.appendChild(this.host);
  }

  add(spec: LabelSpec): void {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<span class="callout-title">${spec.text}</span>${spec.sub ? `<span class="callout-sub">${spec.sub}</span>` : ''}`;
    if (spec.onClick) {
      el.classList.add('clickable');
      el.addEventListener('click', spec.onClick);
    }
    this.host.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '2.6');
    this.svg.append(line, dot);
    this.items.push({ ...spec, el, line, dot, sx: 0, sy: 0, visible: false, highlighted: false });
  }

  removeGroup(group: string): void {
    this.items = this.items.filter((it) => {
      if (it.group !== group) return true;
      it.el.remove();
      it.line.remove();
      it.dot.remove();
      return false;
    });
  }

  setActiveGroup(group: string | null, opacity = 1): void {
    this.activeGroup = group;
    this.opacity = opacity;
  }

  highlight(id: string | null): void {
    for (const it of this.items) {
      it.highlighted = it.id === id;
      it.el.classList.toggle('active', it.highlighted);
    }
  }

  setDimmed(ids: Set<string> | null): void {
    for (const it of this.items) it.el.classList.toggle('dim', ids !== null && !ids.has(it.id));
  }

  update(camera: THREE.Camera, w: number, h: number): void {
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.host.style.opacity = String(this.opacity);
    const active = this.items.filter((it) => it.group === this.activeGroup);
    for (const it of this.items) {
      if (it.group !== this.activeGroup || !this.enabled) this.hide(it);
    }
    if (!this.enabled || !active.length) return;
    // density: keep the selected callout, then navigable/essential ones, then the rest
    const budget = Math.max(1, Math.min(this.maxLabels, Math.ceil(active.length * this.density)));
    const ranked = [...active].sort((a, b) => (b.highlighted ? 1e6 : b.priority ?? 1) - (a.highlighted ? 1e6 : a.priority ?? 1));
    const allowed = new Set(ranked.slice(0, budget));
    const left: LabelItem[] = [];
    const right: LabelItem[] = [];
    const cx = (this.insets.left + (w - this.insets.right)) / 2;
    for (const it of active) {
      _v.copy(it.local ?? new THREE.Vector3());
      it.object.localToWorld(_v);
      _v.project(camera);
      const onScreen = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
      let visible = onScreen && allowed.has(it) && isShown(it.object);
      it.sx = (_v.x * 0.5 + 0.5) * w;
      it.sy = (-_v.y * 0.5 + 0.5) * h;
      if (it.sx < this.insets.left - 20 || it.sx > w - this.insets.right + 20) visible = false;
      it.visible = visible;
      if (!visible) {
        this.hide(it);
        continue;
      }
      (it.sx < cx ? left : right).push(it);
    }
    this.layoutColumn(left, this.insets.left + 12, 'left', h);
    this.layoutColumn(right, w - this.insets.right - 12, 'right', h);
  }

  private layoutColumn(col: LabelItem[], x: number, side: 'left' | 'right', h: number): void {
    col.sort((a, b) => a.sy - b.sy);
    const spacing = 40;
    const top = this.insets.top;
    const bottom = h - this.insets.bottom;
    const ys = col.map((it) => Math.min(Math.max(it.sy, top), bottom));
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + spacing);
    const overflow = ys.length ? ys[ys.length - 1] - bottom : 0;
    if (overflow > 0) for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.max(top, ys[i] - overflow);
    col.forEach((it, i) => {
      const y = ys[i];
      it.el.style.display = 'block';
      it.el.dataset.side = side;
      const elbowX = side === 'left' ? x + 150 : x - 150;
      if (side === 'left') {
        it.el.style.transform = `translate(${x}px, ${y - 18}px)`;
      } else {
        it.el.style.transform = `translate(calc(${x}px - 100%), ${y - 18}px)`;
      }
      const ex = side === 'left' ? Math.min(elbowX, it.sx - 20) : Math.max(elbowX, it.sx + 20);
      it.line.setAttribute('points', `${x + (side === 'left' ? 0 : 0)},${y} ${ex},${y} ${it.sx},${it.sy}`);
      it.line.style.display = '';
      it.dot.setAttribute('cx', String(it.sx));
      it.dot.setAttribute('cy', String(it.sy));
      it.dot.style.display = '';
      it.line.classList.toggle('active', it.highlighted);
      it.line.classList.toggle('dim', it.el.classList.contains('dim'));
    });
  }

  private hide(it: LabelItem): void {
    it.el.style.display = 'none';
    it.line.style.display = 'none';
    it.dot.style.display = 'none';
  }
}

function isShown(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible && !cur.userData.labelIgnoreVisibility) return false;
    cur = cur.parent;
  }
  return true;
}
