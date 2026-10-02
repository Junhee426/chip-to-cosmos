import * as THREE from 'three';
import { mulberry32 } from '../models/units';

/**
 * Procedurally generated textures (no external image assets, no licensing issues).
 * Cached: textures are shared between levels and never disposed with a level.
 */
const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  return t;
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Segmented photovoltaic panel: triple-junction cells, busbars, inter-cell gaps. */
export function solarCellTexture(): THREE.Texture {
  return cached('solar', () => {
    const [c, g] = canvas(1024, 1024);
    g.fillStyle = '#0c0f16';
    g.fillRect(0, 0, 1024, 1024);
    const rand = mulberry32(3);
    const cols = 8;
    const rows = 12;
    const cw = 1024 / cols;
    const ch = 1024 / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = i * cw + 3;
        const y = j * ch + 3;
        const w = cw - 6;
        const h = ch - 6;
        const grad = g.createLinearGradient(x, y, x + w, y + h);
        const v = 0.85 + rand() * 0.15;
        grad.addColorStop(0, `rgb(${18 * v},${30 * v},${62 * v})`);
        grad.addColorStop(1, `rgb(${12 * v},${20 * v},${46 * v})`);
        g.fillStyle = grad;
        // chamfered corners like real space cells
        const k = 7;
        g.beginPath();
        g.moveTo(x + k, y);
        g.lineTo(x + w - k, y);
        g.lineTo(x + w, y + k);
        g.lineTo(x + w, y + h - k);
        g.lineTo(x + w - k, y + h);
        g.lineTo(x + k, y + h);
        g.lineTo(x, y + h - k);
        g.lineTo(x, y + k);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(160,170,190,0.55)';
        g.lineWidth = 1;
        for (let f = 1; f < 6; f++) {
          const fy = y + (h * f) / 6;
          g.beginPath();
          g.moveTo(x + 2, fy);
          g.lineTo(x + w - 2, fy);
          g.stroke();
        }
        g.fillStyle = 'rgba(200,205,215,0.8)';
        g.fillRect(x + w * 0.5 - 1.5, y + 2, 3, h - 4);
      }
    }
    return finish(c);
  });
}

/** Low-amplitude crinkle pattern used as bump map for multi-layer insulation. */
export function crinkleTexture(): THREE.Texture {
  return cached('crinkle', () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 512, 512);
    const rand = mulberry32(11);
    for (let i = 0; i < 900; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      const l = 10 + rand() * 60;
      const a = rand() * Math.PI;
      const v = Math.floor(90 + rand() * 90);
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      g.lineWidth = 1 + rand() * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    return finish(c, false, true);
  });
}

/** Radiator panel: optical solar reflector tiles. */
export function radiatorTexture(): THREE.Texture {
  return cached('radiator', () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#c9ced6';
    g.fillRect(0, 0, 512, 512);
    const n = 16;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 200 + ((i * 7 + j * 13) % 17);
        g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
        g.fillRect((i * 512) / n + 1, (j * 512) / n + 1, 512 / n - 2, 512 / n - 2);
      }
    }
    return finish(c);
  });
}

/**
 * PCB artwork: solder mask, Manhattan copper routing, pads.
 * Returns diffuse map and a matching emissive trace mask for SIGNAL mode.
 */
export function pcbTextures(): { map: THREE.Texture; emissive: THREE.Texture; rough: THREE.Texture } {
  const map = cached('pcb-map', () => drawPcb(false));
  const emissive = cached('pcb-emis', () => drawPcb(true));
  const rough = cached('pcb-rough', () => drawPcb(false, true));
  return { map, emissive, rough };
}

function drawPcb(emissive: boolean, rough = false): THREE.Texture {
  const S = 2048;
  const [c, g] = canvas(S, S);
  g.fillStyle = emissive ? '#000' : rough ? '#b0b0b0' : '#0d1f1a';
  g.fillRect(0, 0, S, S);
  const rand = mulberry32(21);
  const copper = emissive ? '#6fd3ff' : rough ? '#404040' : '#8a6a3c';
  const pitch = 16;
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    let x = Math.floor((rand() * S) / pitch) * pitch;
    let y = Math.floor((rand() * S) / pitch) * pitch;
    const w = rand() < 0.15 ? 7 : 3;
    g.strokeStyle = copper;
    g.globalAlpha = emissive ? (rand() < 0.35 ? 1 : 0) : 0.9;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    const segs = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < segs; s++) {
      const len = (4 + Math.floor(rand() * 26)) * pitch;
      const dir = Math.floor(rand() * 4);
      const diag = rand() < 0.3;
      if (dir === 0) x += len; else if (dir === 1) x -= len; else if (dir === 2) y += len; else y -= len;
      if (diag) y += (rand() < 0.5 ? 1 : -1) * pitch * 2;
      g.lineTo(x, y);
    }
    g.stroke();
    if (!emissive) {
      g.globalAlpha = 1;
      g.fillStyle = rough ? '#303030' : '#b8924e';
      g.beginPath();
      g.arc(x, y, w + 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  if (!emissive && !rough) {
    // silkscreen marks
    g.strokeStyle = 'rgba(220,225,230,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = rand() * S;
      const y = rand() * S;
      g.strokeRect(x, y, 30 + rand() * 60, 20 + rand() * 40);
    }
  }
  return finish(c, !rough);
}

/** Die floorplan texture: standard-cell rows, SRAM macros, analog blocks, pad ring. */
export function dieTexture(): THREE.Texture {
  return cached('die', () => {
    const S = 2048;
    const [c, g] = canvas(S, S);
    g.fillStyle = '#0a1418';
    g.fillRect(0, 0, S, S);
    const rand = mulberry32(5);
    // standard-cell rows
    for (let y = 0; y < S; y += 6) {
      const v = 18 + Math.floor(rand() * 16);
      g.fillStyle = `rgb(${v - 6},${v + 8},${v + 12})`;
      g.fillRect(0, y, S, 3);
    }
    // metal routing grid
    g.globalAlpha = 0.18;
    g.strokeStyle = '#6a8fa0';
    for (let x = 0; x < S; x += 12) {
      if (rand() < 0.5) continue;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, S);
      g.stroke();
    }
    g.globalAlpha = 1;
    // pad ring
    for (let i = 40; i < S - 40; i += 36) {
      for (const [x, y] of [[i, 12], [i, S - 36], [12, i], [S - 36, i]]) {
        g.fillStyle = '#9ba6ad';
        g.fillRect(x, y, 24, 24);
      }
    }
    return finish(c);
  });
}

/** Regular micro-grid used on SRAM blocks. */
export function sramTexture(): THREE.Texture {
  return cached('sram', () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#10222c';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#1d3e4d';
    for (let x = 0; x < 512; x += 8) for (let y = 0; y < 512; y += 8) g.fillRect(x + 1, y + 1, 5, 5);
    g.fillStyle = '#2d5e70';
    for (let y = 0; y < 512; y += 64) g.fillRect(0, y, 512, 3);
    return finish(c);
  });
}

/** Vertical deep-space background gradient (screen-space). */
export function backgroundTexture(): THREE.Texture {
  return cached('bg', () => {
    const [c, g] = canvas(1024, 1024);
    const grad = g.createRadialGradient(512, 420, 40, 512, 560, 820);
    grad.addColorStop(0, '#0d1a30');
    grad.addColorStop(0.55, '#060c18');
    grad.addColorStop(1, '#02040a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 1024);
    return finish(c);
  });
}

/** Soft round sprite for particles. */
export function glowSprite(): THREE.Texture {
  return cached('glow', () => {
    const [c, g] = canvas(64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return finish(c);
  });
}

/** Carbon-fibre (CFRP) 2×2 twill weave, used as bump + subtle colour variation. */
export function carbonTexture(): THREE.Texture {
  return cached('carbon', () => {
    const [c, g] = canvas(256, 256);
    const n = 16;
    const cell = 256 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const over = (i + Math.floor(j / 2)) % 2 === 0;
        const grad = over ? g.createLinearGradient(i * cell, 0, (i + 1) * cell, 0) : g.createLinearGradient(0, j * cell, 0, (j + 1) * cell);
        grad.addColorStop(0, '#4a4a4a');
        grad.addColorStop(0.5, over ? '#9a9a9a' : '#7a7a7a');
        grad.addColorStop(1, '#4a4a4a');
        g.fillStyle = grad;
        g.fillRect(i * cell, j * cell, cell, cell);
      }
    }
    const tex = finish(c, false, true);
    tex.repeat.set(6, 6);
    return tex;
  });
}
