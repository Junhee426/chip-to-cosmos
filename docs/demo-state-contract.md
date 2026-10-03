# Demo start / end contract (V4 follow-up)

Every demo run (`HeroDemo.play(mode)`) takes two snapshots **before it changes anything**:

- **Store snapshot** (`DemoSnapshot`): `mode`, `presentation`, `labels` and the beam parameters
  (`arrayN`, `spacingLambda`, `steerDeg`, `steerAzDeg`, `weighting`, `powerMode`, `paOutW`,
  `totalRfW`, `altitudeKm`, `freqGHz`, `rxGainDbi`).
- **Screen snapshot** (`PresentationSnapshot`): poster view (`hidden` / `landing` / `poster`),
  current level (null while a scale step was in flight), a **cloned** camera (position, target,
  up), the viewport size, and the Cosmos orbit state (`time`, `paused`) read through the explicit
  `BaseLevel.orbitState()` / `setOrbitState()` API. The orbit-control zoom range is kept with it.

Not restored on purpose: `selected`, `explode` and X-ray `emphasis`. They name level-specific
component IDs and every level arrival resets them, so restoring them on another level would be
wrong.

## End policy (`endAction(mode, reason, startView)`)

| Start screen / user action | Result |
|---|---|
| landing → Quick → Skip | Satellite landing: starting params, mode, labels, presentation; the stored camera when the viewport is unchanged, otherwise the landing frame for the current viewport. The landing card appears only after Satellite is current. |
| poster → Quick → Skip | Cosmos poster with the **user's** starting params (e.g. their Try-it steer, not `POSTER_STATE`), orbit time and paused state, and camera (refit when the viewport changed). |
| free exploration → demo → Skip | Stays in the current, settled scene (a scale step in flight completes first). Store snapshot restored; poster stays hidden; the camera is restored only if the scene is the one the demo started from (no camera transplant across levels). |
| any → Quick completes | Cosmos poster, `POSTER_STATE`, reference orbit (t = 0), orbit paused, the same frame a direct `?view=poster` load computes. Try-it moves during the last reading hold are kept. |
| poster → Engineering / Grating starts | Poster hidden and presentation off **before** the run; mode = signal, labels on. |
| Engineering / Grating completes | Free exploration with the resulting params; camera flies to the Cosmos overview (Earth-fixed), then the orbit resumes; completion toast. |
| Engineering / Grating → Skip | Same as a Quick Skip from the starting screen (e.g. back to the poster). |
| navigation during a demo (scale rail, breadcrumb, browser back) | The demo ends with reason `navigate`: store snapshot restored with presentation off, no screen restore; then the requested level is navigated to. |
| Explore freely during a demo (e.g. the Link segment) | Reason `explore`: current results kept, presentation left in place, orbit resumes. A late completion of that run cannot re-apply the poster or pause the orbit. |
| script error / failed navigation | Reason `error`: restore as for Skip; if the restore itself fails, the starting params are re-applied, presentation is left and the camera control range is reset. A toast offers "Run again". |

## Asynchronous rules

- `play()` resolves only after the end screen is composed and cleanup is done; while running it
  returns the same promise, and `skip()` / `stop(reason)` called repeatedly all await that promise
  (no `finish()` ↔ `skip()` wait cycle).
- A session token is bumped on every `play()`; detached continuations (reading holds, parameter
  tweens) of an older run see the token change and stop.
- Preparation (`preload`) races a stop signal, so a Skip during preparation ends immediately.
- Before the end screen is composed, any scale step in flight is finished (`ScaleManager.stop()` +
  `CameraRig.finishFlight()`, then wait while `isBusy`): renormalisation is never cut.
- Level retention for the demo route is released exactly once, after the end screen is in use.
- `running` becomes false only after all of the above; a following Replay or navigation starts
  from a settled state. An explicit navigate/explore issued while the end is being composed runs
  after it, so the newest request decides the final screen.

## Resize

When the poster is visible and the viewport changes (`resize`, `visualViewport.resize`,
`orientationchange`), the poster frame is recomputed once the size has been stable for 150 ms and
no camera flight or scale step is running. It uses the current orbit position and parameters
(nothing is reset) and is computed from scratch, so repeated resizes cannot drift. Free
exploration cameras are never moved.

The poster frame keeps the designed pose (radial up, camera below the nadir deck) and backs off
only as far as needed for the satellite body and every −3 dB contour point of the 0°, 25° and 50°
Try-it sweep (sample solutions only; the store is not changed) to sit inside the safe viewport
(HUD insets) and outside overlay boxes such as the footprint inset. It anchors on the reference
steer, so moving the slider never moves the camera.

## Footprint detail inset (narrow portrait screens)

On phones the spherical footprint seen from the poster camera is a thin sliver (≈ 31 × 3.5 px at
25° on 390 × 844 before this change). After shrinking the terminal marker and strengthening the
fill, the 3D contour is visible but still not readable as an area, so the poster adds
**Footprint detail · enlarged**:

- Source: the same `beamSolution(params).footprint` the 3D scene draws.
- Projection: `tangentPlaneKm()` — the solver's own local tangent plane at the beam centre
  (x along-track, y = n × x across). The along/cross extents shown are the solver's
  `alongTrackKm` / `crossTrackKm`, measured in exactly this plane (unit-tested).
- One scale for both axes (shape not stretched) and a km scale bar; the beam-centre terminal is a
  separate point inside the −3 dB outline.
- Redrawn only on parameter changes (no animation loop); shown only in the poster view on narrow
  portrait layouts and never during a demo; its box is excluded from the poster framing.
- Main-scene footprint geometry and link numbers are unchanged.

Alternatives considered: a larger camera close-up (loses the Satellite → Earth story of the
poster), or exaggerating the 3D contour (would misstate the physical footprint).
