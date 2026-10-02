import * as THREE from 'three';
import { carbonTexture, crinkleTexture, radiatorTexture, solarCellTexture } from './textures';

/**
 * Material system. Every call returns a NEW material instance so that each
 * component can be faded/dimmed independently; textures are shared.
 */
export const COLORS = {
  signal: new THREE.Color('#4fb3ff'),
  power: new THREE.Color('#f2b441'),
  thermal: new THREE.Color('#ff6a3d'),
  radiation: new THREE.Color('#c38bff'),
  electron: new THREE.Color('#5cc8ff'),
  hole: new THREE.Color('#ff8a5c'),
};

export const mat = {
  /** Polished single-crystal silicon: dark, reflective, slight blue cast. */
  silicon(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color: 0x1a1f28, metalness: 0.35, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15, iridescence: 0.25, iridescenceIOR: 1.6 });
  },
  die(map?: THREE.Texture): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color: 0xc4dae2, map, metalness: 0.25, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25, iridescence: 0.35, iridescenceIOR: 1.8 });
  },
  aluminum(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xa9adb3, metalness: 1, roughness: 0.38 });
  },
  anodized(color = 0x2a2f38): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.45 });
  },
  aerospace(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x8c9098, metalness: 0.55, roughness: 0.62 });
  },
  nickel(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xb4b7ba, metalness: 1, roughness: 0.36 });
  },
  gold(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xe0b060, metalness: 1, roughness: 0.28 });
  },
  copper(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xc57a4a, metalness: 1, roughness: 0.32 });
  },
  solder(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 1, roughness: 0.3 });
  },
  tungsten(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x8e9299, metalness: 1, roughness: 0.4 });
  },
  /** Silicon interposer rendered semi-transparent to reveal TSVs and RDL. */
  interposer(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color: 0x5f7a8a, metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.42, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false, side: THREE.DoubleSide });
  },
  glass(color = 0x9fc5d8, opacity = 0.25): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.08, transparent: true, opacity, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  },
  substrate(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x2c3a2a, metalness: 0.1, roughness: 0.7 });
  },
  fr4(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x3c4a32, metalness: 0.05, roughness: 0.8 });
  },
  pcb(map?: THREE.Texture, rough?: THREE.Texture, emissive?: THREE.Texture): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughnessMap: rough ?? null, roughness: 0.55, metalness: 0.25 });
    if (emissive) {
      m.emissiveMap = emissive;
      m.emissive.set(0x000000);
    }
    return m;
  },
  moldCompound(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.05, roughness: 0.65 });
  },
  ceramic(color = 0x8b6d4e): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.55 });
  },
  solarCell(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ map: solarCellTexture(), metalness: 0.4, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  },
  /** Multi-layer insulation: crinkled metallised polyimide (gold) or aluminised film (silver). */
  mli(kind: 'gold' | 'silver' = 'gold'): THREE.MeshStandardMaterial {
    const t = crinkleTexture();
    return new THREE.MeshStandardMaterial({ color: kind === 'gold' ? 0xb88a3e : 0xa9aeb5, metalness: 1, roughness: 0.48, bumpMap: t, bumpScale: 1.6 });
  },
  radiator(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: radiatorTexture(), color: 0xb8bec8, metalness: 0.2, roughness: 0.45 });
  },
  /** Carbon-fibre composite: dark, low metal, weave visible only in grazing light. */
  cfrp(): THREE.MeshStandardMaterial {
    const t = carbonTexture();
    return new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.15, roughness: 0.42, bumpMap: t, bumpScale: 0.6, roughnessMap: t });
  },
  /** White thermal paint (radiator frames, bezels): high albedo, diffuse. */
  whitePaint(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0, roughness: 0.75 });
  },
  darkPanel(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x1b1f26, metalness: 0.4, roughness: 0.5 });
  },
  /** Controlled emissive for active signals — never neon-saturated. */
  emissive(color: THREE.ColorRepresentation, intensity = 1.2, opacity = 1): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: new THREE.Color(color), emissiveIntensity: intensity, metalness: 0, roughness: 0.6, transparent: opacity < 1, opacity });
  },
  doped(color: THREE.ColorRepresentation, opacity = 0.55): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.4, transparent: true, opacity, depthWrite: false, clearcoat: 0.3 });
  },
  line(color: THREE.ColorRepresentation, opacity = 0.5): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  },
};
