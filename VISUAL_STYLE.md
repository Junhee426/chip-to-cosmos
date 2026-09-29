# Visual style

Target: *premium semiconductor visualization + high-end scientific visualization +
aerospace engineering visualization* — never a game UI, never neon.

## Palette

| Role | Value |
|---|---|
| Background | radial deep navy `#0d1a30` → near-black `#02040a` |
| Panels | `rgba(9,14,25,0.74)` + 14–16 px backdrop blur, 1 px hairline `rgba(140,170,210,0.14)` |
| Text | primary `#e8edf5`, secondary `#9aa7b8`, muted `#5d6b7e`, accent `#8fd0ff` |
| Modes | signal `#4fb3ff`, power `#f2b441`, thermal `#ff6a3d`, radiation `#c38bff` |
| Chart series | `#3987e5`, `#d95926`, `#199e70`, `#c98500` (dark-surface categorical order, fixed) |
| Carriers | electrons `#5cc8ff`, holes `#ff8a5c` |
| Badges | CALCULATED green, ILLUSTRATIVE amber, Simplified Educational Model gold |

## Materials (never one material for everything)

Silicon (dark reflective, clearcoat, faint iridescence) · Die (blue-green silicon with floorplan
texture) · aluminium / nickel / gold / copper / solder / tungsten metals (metalness 1, distinct
roughness) · semi-transparent interposer (clearcoat glass) · multilayer PCB (procedural artwork +
emissive trace mask for SIGNAL) · segmented triple-junction solar cells · matte aerospace
structure · crinkled MLI foil (bump-mapped) · controlled emissive only for active signals.

## Lighting

Warm key (the Sun, from upper-left so flat metal does not mirror it into default views),
cool rim from behind, low hemispheric fill. Reflections come from a procedural dark
"space studio" environment (near-black sky, faint earthshine, two soft boxes).
ACES tone mapping, exposure 0.95. Bloom is restrained (strength 0.3, threshold 0.92) so only
emissive signals glow. A subtle vignette + grain finishes the frame.

## Motion

Camera flights interpolate target, direction (slerp) and **log-distance**, so a 1000× zoom feels as
smooth as a 2× one. Context fades while the focus component cross-fades into the child level.
Explode animations are staggered per part. The intro uses letterboxing and sparse captions.

## Labels

Engineering callouts: 3D anchor → elbow → label column (left/right), de-overlapped each frame,
hairline leaders, title + mono sub-line. Selected callout turns accent; unrelated callouts dim in
engineering modes.

## Typography

Inter (300–600) for UI, JetBrains Mono for numbers, units and equations. Tracking is widened on
uppercase kickers (0.14–0.32 em).
