# Motion Tiles — scripted maneuver primitives

Flight-cinematography building blocks. Each tile is a parameterized maneuver
generated as a `FlightRecorder`-format keyframe track, replayable as a ghost
via `GhostPlayer` (`js/cinematography/`). Tiles chain: every tile's `exit`
matches its `entry` (speed, heading, altitude), so tiles compose into
sequences — the "motion sampling" idea from the cinematography toolkit.

## Format

```json
{
  "version": 1,
  "kind": "motion-tile",
  "name": "tile-01-akira-sideslip-B-classic",
  "params": { "slipAngleRad": 0.593, "...": "..." },
  "entry": { "speedMps": 45, "yawRad": -1.5708, "altitudeM": 300 },
  "exit":  { "speedMps": 45, "yawRad": -1.5708, "altitudeM": 300 },
  "keyframes": [ { "t": 0.0, "pos": [x, y, z], "quat": [x, y, z, w] }, "..." ]
}
```

Keyframes are 10 Hz (same as `FlightRecorder`). Conventions match
`js/camera/FlightController.js`: forward = `-Z` rotated by the quaternion,
Euler order `YXZ` (pitch, yaw, roll).

`GhostPlayer.setTrack()` takes the `keyframes` **array** (not the wrapper):

```js
const res = await fetch('assets/motion-tiles/tile-01-akira-sideslip-B-classic.json');
const tile = await res.json();
ghostPlayer.setTrack(tile.keyframes);
ghostPlayer.play();
```

## Tiles

| Tile | Variants | Description |
|------|----------|-------------|
| 01 — Akira Slide (sideslip) | A subtle 20°, B classic 34°, C dramatic 45° | Nose held at a fixed yaw offset from the direction of travel, cosmetic bank into the slip. The aviation version of Kaneda's sideways bike slide. |

## Generating

`scripts/generate-motion-tile-01.py` builds the tile-01 variants and
**numerically verifies** each one: nose-vs-track angle equals the slip angle
during the hold (±2°), nose aligned with track outside the slide, constant
speed, constant altitude, normalized quaternions.

```sh
TILE_OUTDIR=assets/motion-tiles python3 scripts/generate-motion-tile-01.py
```

## Verification status

- 2026-10-13: tile-01 A/B/C generated and numerically verified (hold slip
  error 0.0° on all three). Not yet wired into the game UI or playtested on
  device — preview via the console snippet above in the test browser.
