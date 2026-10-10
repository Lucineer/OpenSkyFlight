import * as THREE from 'three';
import Logger from '../utils/Logger.js';

/**
 * CloudLayer — volumetric-feeling sprite clouds for Sitka Skies.
 *
 * A THREE.Group of alpha-blended billboard puffs arranged in three altitude
 * layers (500 m / 1000 m / 1500 m). You can fly above, below, and straight
 * through them. The puff texture is procedural (value-noise FBM baked once
 * onto a canvas, 3 seeded variants) — no external images.
 *
 * iPad-cheap by design:
 *  - ~81 sprites total, one shared texture per variant, one shared material
 *    per (layer × variant) — sprites are trivial textured quads.
 *  - depthWrite:false / depthTest:true, NormalBlending (no expensive sorting
 *    tricks, no additive fill-rate blowout).
 *  - Zero allocations in the per-frame update path.
 *  - The cloud field wraps around the camera, so a fixed sprite count gives
 *    effectively infinite clouds with no streaming cost.
 *
 * Usage:
 *   import { createCloudLayer } from './scene/CloudLayer.js';
 *   const clouds = createCloudLayer();
 *   scene.add(clouds);               // it IS a THREE.Group
 *   // per frame:
 *   clouds.update(dt, camera.position);
 */
export function createCloudLayer(options = {}) {
  const {
    // [altitude, formations, puffsPerFormation, minScale, maxScale, opacity, windX, windZ, tint]
    layers = [
      {
        altitude: 500,
        formations: 12,
        puffs: 3,
        minScale: 220,
        maxScale: 420,
        opacity: 0.85,
        wind: [6, 2],
        tint: 0xe8edf2,
      },
      {
        altitude: 1000,
        formations: 9,
        puffs: 3,
        minScale: 320,
        maxScale: 600,
        opacity: 0.72,
        wind: [10, -3],
        tint: 0xf2f5f9,
      },
      {
        altitude: 1500,
        formations: 6,
        puffs: 3,
        minScale: 450,
        maxScale: 800,
        opacity: 0.6,
        wind: [14, 5],
        tint: 0xffffff,
      },
    ],
    fieldSize = 12000, // horizontal extent of each layer's wrapping field (m)
    textureSize = 256, // procedural puff texture resolution
    textureVariants = 3, // seeded noise variants for visual variety
  } = options;

  const group = new THREE.Group();
  group.name = 'CloudLayer';

  // --- Procedural puff texture (baked once, cached across calls) -------------
  const textures = getPuffTextures(textureSize, textureVariants);

  // --- Build sprites ---------------------------------------------------------
  // Per-layer state kept in plain arrays; update() mutates positions in place.
  const layerState = [];

  layers.forEach((L, li) => {
    // One shared material per (layer × texture variant).
    const materials = textures.map(
      (tex) =>
        new THREE.SpriteMaterial({
          map: tex,
          color: L.tint,
          transparent: true,
          opacity: L.opacity,
          depthWrite: false, // no self-sorting artifacts between puffs
          depthTest: true, // terrain still occludes clouds correctly
          blending: THREE.NormalBlending,
          fog: true, // distant clouds melt into the horizon haze
        }),
    );

    const sprites = [];
    const half = fieldSize / 2;
    for (let f = 0; f < L.formations; f++) {
      // Formation center, uniform in the field.
      const cx = (Math.random() * 2 - 1) * half;
      const cz = (Math.random() * 2 - 1) * half;
      const nPuffs = L.puffs + (Math.random() < 0.4 ? 1 : 0);
      for (let p = 0; p < nPuffs; p++) {
        const sprite = new THREE.Sprite(materials[(Math.random() * materials.length) | 0]);
        const s = L.minScale + Math.random() * (L.maxScale - L.minScale);
        sprite.scale.set(s, s * (0.55 + Math.random() * 0.25), 1); // wider than tall
        // Base position in field-local space; wrapped around the camera each frame.
        sprite.userData.bx = cx + (Math.random() * 2 - 1) * s * 0.9;
        sprite.userData.bz = cz + (Math.random() * 2 - 1) * s * 0.9;
        sprite.userData.by = L.altitude + (Math.random() * 2 - 1) * 70;
        sprite.position.set(sprite.userData.bx, sprite.userData.by, sprite.userData.bz);
        group.add(sprite);
        sprites.push(sprite);
      }
    }
    layerState.push({ def: L, sprites, t: Math.random() * 1000 });
  });

  const spriteCount = layerState.reduce((n, l) => n + l.sprites.length, 0);
  Logger.info('CloudLayer', `built ${spriteCount} puffs in ${layers.length} layers`);

  // --- Wrapping helper (no allocation) ---------------------------------------
  function wrap(v, min, range) {
    let r = (v - min) % range;
    if (r < 0) r += range;
    return min + r;
  }

  // --- Public API attached to the group --------------------------------------
  /**
   * Advance wind drift and keep each layer's field centered on the camera.
   * @param {number} dt seconds since last frame
   * @param {THREE.Vector3} [cameraPosition] — field follows this; drift still
   *   animates when omitted.
   */
  group.update = function update(dt, cameraPosition) {
    if (!group.visible || dt <= 0) return;
    const cx = cameraPosition ? cameraPosition.x : 0;
    const cz = cameraPosition ? cameraPosition.z : 0;
    const half = fieldSize / 2;
    for (let li = 0; li < layerState.length; li++) {
      const { def, sprites, t: t0 } = layerState[li];
      const t = t0 + dt;
      layerState[li].t = t;
      const ox = def.wind[0] * t;
      const oz = def.wind[1] * t;
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        const u = s.userData;
        s.position.x = wrap(u.bx + ox, cx - half, fieldSize);
        s.position.z = wrap(u.bz + oz, cz - half, fieldSize);
        s.position.y = u.by;
      }
    }
  };

  /** Change a layer's wind vector (m/s). */
  group.setWind = function setWind(layerIndex, x, z) {
    const l = layerState[layerIndex];
    if (l) {
      l.def.wind[0] = x;
      l.def.wind[1] = z;
    }
  };

  group.setVisible = function setVisible(v) {
    group.visible = v;
  };

  /** Free GPU textures/materials. */
  group.dispose = function dispose() {
    group.traverse((o) => {
      if (o.isSprite) {
        // Materials are shared per layer — dispose each once.
        if (o.material && !o.material.userData.disposed) {
          o.material.userData.disposed = true;
          o.material.dispose();
        }
      }
    });
    // Textures are module-cached and shared; do not dispose here.
  };

  return group;
}

// --- Module-level texture cache ----------------------------------------------
let _cachedTextures = null;
let _cachedKey = '';

function getPuffTextures(size, variants) {
  const key = `${size}x${variants}`;
  if (_cachedTextures && _cachedKey === key) return _cachedTextures;
  const arr = [];
  for (let v = 0; v < variants; v++) arr.push(makePuffTexture(size, 1234 + v * 777));
  _cachedTextures = arr;
  _cachedKey = key;
  return arr;
}

/**
 * Bake one soft cloud-puff sprite: FBM value noise thresholded softly,
 * masked by a radial falloff so edges dissolve. White RGB, alpha in A.
 */
function makePuffTexture(size, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // Deterministic PRNG (mulberry32) so variants are stable per seed.
  let s = seed >>> 0;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Small permutation-free value-noise grid.
  const GS = 32;
  const grid = new Float32Array((GS + 1) * (GS + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const fade = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const x0 = ((xi % GS) + GS) % GS,
      y0 = ((yi % GS) + GS) % GS;
    const x1 = (x0 + 1) % GS,
      y1 = (y0 + 1) % GS;
    const a = grid[y0 * (GS + 1) + x0],
      b = grid[y0 * (GS + 1) + x1];
    const c = grid[y1 * (GS + 1) + x0],
      e = grid[y1 * (GS + 1) + x1];
    const u = fade(xf),
      v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }
  function fbm(x, y) {
    let v = 0,
      amp = 0.5,
      fx = x,
      fy = y;
    for (let o = 0; o < 4; o++) {
      v += amp * vnoise(fx, fy);
      fx *= 2.03;
      fy *= 2.11;
      amp *= 0.5;
    }
    return v; // ~[0, 0.94]
  }

  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size,
        ny = y / size;
      // 2-3 noise cells across the sprite for billowy lumps.
      const n = fbm(nx * 3.1 + seed * 0.013, ny * 3.1);
      // Soft density: clouds where noise is high, feathered edges.
      const density = smoothstep(0.32, 0.62, n);
      // Radial mask: 1 at center → 0 at rim.
      const dx = (x - half) / half,
        dy = (y - half) / half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = 1 - smoothstep(0.55, 1.0, dist);
      const a = Math.max(0, Math.min(1, density * mask));
      const idx = (y * size + x) * 4;
      d[idx] = 255;
      d[idx + 1] = 255;
      d[idx + 2] = 255;
      d[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
