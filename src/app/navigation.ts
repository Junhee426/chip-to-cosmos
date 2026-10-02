/**
 * Multiscale level graph. The main chain runs from COSMOS to ENERGY BAND;
 * side branches (the phased-array beam lab) hang off a parent level.
 * Pure logic — no Three.js — so it is unit-testable.
 */
export type LevelId =
  | 'cosmos'
  | 'satellite'
  | 'array'
  | 'payload'
  | 'pcb'
  | 'package'
  | 'die'
  | 'mosfet'
  | 'silicon'
  | 'energy';

export interface LevelInfo {
  id: LevelId;
  crumb: string;
  title: string;
  subtitle: string;
  parent: LevelId | null;
  /** metres represented by one scene unit (drives the scale bar) */
  metersPerUnit: number;
  /** true when geometry proportions are exaggerated for legibility */
  notToScale: boolean;
}

export const LEVELS: Record<LevelId, LevelInfo> = {
  cosmos: { id: 'cosmos', crumb: 'COSMOS', title: 'LEO Broadband Constellation', subtitle: 'Walker-delta shell · 550 km · 53°', parent: null, metersPerUnit: 637_100, notToScale: true },
  satellite: { id: 'satellite', crumb: 'SATELLITE', title: 'Communication Satellite', subtitle: 'Generic LEO broadband spacecraft', parent: 'cosmos', metersPerUnit: 1, notToScale: false },
  array: { id: 'array', crumb: 'BEAM LAB', title: 'Phased Array Beam Lab', subtitle: 'Planar array factor → 3D radiation surface', parent: 'satellite', metersPerUnit: 0.01, notToScale: false },
  payload: { id: 'payload', crumb: 'PAYLOAD', title: 'Communication Payload', subtitle: 'Regenerative Ka-band processor', parent: 'satellite', metersPerUnit: 0.1, notToScale: false },
  pcb: { id: 'pcb', crumb: 'PCB', title: 'Beamformer / Modem Board', subtitle: 'RF · digital · power on a multilayer PCB', parent: 'payload', metersPerUnit: 0.01, notToScale: false },
  package: { id: 'package', crumb: 'CHIP', title: 'Advanced Semiconductor Package', subtitle: '2.5D interposer · flip-chip · BGA', parent: 'pcb', metersPerUnit: 0.0025, notToScale: true },
  die: { id: 'die', crumb: 'DIE', title: 'Silicon Die', subtitle: 'RF-SoC functional floorplan', parent: 'package', metersPerUnit: 0.001, notToScale: false },
  mosfet: { id: 'mosfet', crumb: 'MOSFET', title: 'NMOS Transistor', subtitle: 'Cross-section · Simplified Educational Model', parent: 'die', metersPerUnit: 1e-7, notToScale: true },
  silicon: { id: 'silicon', crumb: 'SILICON', title: 'Silicon Crystal', subtitle: 'Diamond-cubic lattice · a = 0.543 nm', parent: 'mosfet', metersPerUnit: 1e-10 * 1.0, notToScale: false },
  energy: { id: 'energy', crumb: 'ENERGY', title: 'Energy Bands', subtitle: 'PN junction band diagram', parent: 'silicon', metersPerUnit: 5e-8, notToScale: true },
};

export const MAIN_CHAIN: LevelId[] = ['cosmos', 'satellite', 'payload', 'pcb', 'package', 'die', 'mosfet', 'silicon', 'energy'];

export function ancestors(id: LevelId): LevelId[] {
  const out: LevelId[] = [];
  let cur: LevelId | null = id;
  while (cur) {
    out.unshift(cur);
    cur = LEVELS[cur].parent;
  }
  return out;
}

export function depth(id: LevelId): number {
  return ancestors(id).length - 1;
}

export function children(id: LevelId): LevelId[] {
  return (Object.keys(LEVELS) as LevelId[]).filter((k) => LEVELS[k].parent === id);
}

export interface NavStep {
  from: LevelId;
  to: LevelId;
  dir: 'down' | 'up';
}

/** Shortest path in the tree: climb to the common ancestor, then descend. */
export function pathBetween(from: LevelId, to: LevelId): NavStep[] {
  if (from === to) return [];
  const a = ancestors(from);
  const b = ancestors(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  const steps: NavStep[] = [];
  for (let i = a.length - 1; i >= common; i--) {
    steps.push({ from: a[i], to: a[i - 1], dir: 'up' });
  }
  for (let i = common; i < b.length; i++) {
    steps.push({ from: b[i - 1], to: b[i], dir: 'down' });
  }
  return steps;
}

/** Breadcrumb trail for a level (root → level). */
export function breadcrumb(id: LevelId): LevelInfo[] {
  return ancestors(id).map((l) => LEVELS[l]);
}

/** Levels that should stay resident in GPU memory around the current one. */
export function residentSet(id: LevelId): Set<LevelId> {
  const s = new Set<LevelId>([id]);
  const p = LEVELS[id].parent;
  if (p) s.add(p);
  for (const c of children(id)) s.add(c);
  return s;
}

/** Human-readable length with SI prefix for the scale bar. */
export function formatLength(m: number): string {
  const units: [number, string][] = [[1e3, 'km'], [1, 'm'], [1e-2, 'cm'], [1e-3, 'mm'], [1e-6, 'µm'], [1e-9, 'nm'], [1e-10, 'Å']];
  for (const [s, u] of units) {
    if (m >= s) {
      const v = m / s;
      return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u}`;
    }
  }
  return `${(m / 1e-10).toFixed(2)} Å`;
}

/**
 * Structural validation of the level graph. Returns a list of problems (empty = valid):
 * exactly one root, all parents exist, no cycles, every node reaches the root,
 * MAIN_CHAIN is a parent→child path from the root, side branches hang off the chain.
 */
export function validateLevelGraph(levels: Record<string, { id: string; parent: string | null }> = LEVELS, mainChain: readonly string[] = MAIN_CHAIN): string[] {
  const errors: string[] = [];
  const ids = Object.keys(levels);
  const roots = ids.filter((id) => levels[id].parent === null);
  if (roots.length !== 1) errors.push(`expected exactly one root, found ${roots.length} (${roots.join(', ')})`);
  for (const id of ids) {
    if (levels[id].id !== id) errors.push(`${id}: id field "${levels[id].id}" does not match key`);
    const p = levels[id].parent;
    if (p !== null && !(p in levels)) errors.push(`${id}: parent "${p}" does not exist`);
  }
  for (const id of ids) {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur !== null && cur in levels) {
      if (seen.has(cur)) {
        errors.push(`${id}: cycle through ${[...seen].join(' → ')}`);
        break;
      }
      seen.add(cur);
      cur = levels[cur].parent;
    }
    if (cur === null && roots.length === 1 && !seen.has(roots[0])) errors.push(`${id}: does not reach root ${roots[0]}`);
  }
  if (mainChain.length) {
    if (levels[mainChain[0]]?.parent !== null) errors.push(`MAIN_CHAIN must start at the root, starts at ${mainChain[0]}`);
    for (let i = 1; i < mainChain.length; i++) {
      if (levels[mainChain[i]]?.parent !== mainChain[i - 1]) errors.push(`MAIN_CHAIN: ${mainChain[i]} is not a child of ${mainChain[i - 1]}`);
    }
    for (const id of ids) {
      if (mainChain.includes(id)) continue;
      const p = levels[id].parent;
      if (p === null || !mainChain.includes(p)) errors.push(`side branch ${id} must hang off a MAIN_CHAIN level (parent ${p})`);
    }
  }
  return errors;
}
