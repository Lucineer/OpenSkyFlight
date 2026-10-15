# Procedural Asset Factory

Algorithmic 3D asset generators for OpenSkyFlight. No hand-modeling, no
downloads — pure Python stdlib, runs headless on ARM Linux. The Oracle server
(`muse-worker`) runs these 24/7; the library grows with time.

## Generators

| Script | Output | Styles |
|---|---|---|
| `generate-plane.py` | Airplanes | bush, airliner, fighter, seaplane |
| `generate-building.py` | Sitka-style buildings | house, dock, warehouse, church, cannery |
| `generate-tree.py` | PNW conifers | spruce, hemlock, snag |
| `generate-boat.py` | Harbor boats | fishing, sailboat, skiff |

Each takes `--style {style|random} --seed N --out path.json`.

## Batch runner

```bash
python3 run-batch.py --out /home/ubuntu/asset-factory/output --count 8
```

Generates N randomized assets, appends to `manifest.json` (idempotent —
skips files that already exist). Warns on assets over the 5000-triangle
iPad budget.

## Output format: `osf-proc-asset` v1

Single JSON per asset:

```json
{
  "format": "osf-proc-asset", "version": 1, "name": "plane-bush-00007",
  "positions": [...], "normals": [...], "colors": [...],
  "indices": [...], "triangleCount": 441,
  "meta": {"type": "plane", "style": "bush", ...}
}
```

- Y-up, meters. Vertex colors (one material, one draw call).
- Load in Three.js with `js/assets/ProceduralAssetLoader.js`:

```js
import { loadProceduralAsset } from './assets/ProceduralAssetLoader.js';
const mesh = await loadProceduralAsset('/assets/proc/plane-bush-00007.json');
scene.add(mesh);
```

## Geometry library

`lib/geobuilder.py` — `GeoBuilder` class with primitives (box, cylinder,
cone, prism, sphere, tapered_box), affine transform composition, and flat-
shaded normal computation. New generators compose these; keep new
primitives here so all generators share them.

## Oracle factory

On `muse-worker`:

- Generators live at `/home/ubuntu/asset-factory/generators/`
- Output at `/home/ubuntu/asset-factory/output/` (+ `manifest.json`)
- `systemd` timer `asset-factory.timer` runs `run-batch.py --count 8`
  every 30 minutes
- Monitor: `ssh muse-worker 'tail /home/ubuntu/asset-factory/logs/batch.log'`
  or check `output/manifest.json` asset count

## Budgets

- Target < 5000 triangles per asset (iPad).
- Current averages: plane ~300, building ~250, tree ~170, boat ~150.
- One material per asset (vertex colors) = one draw call.
