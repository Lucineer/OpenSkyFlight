/**
 * OceanSurface — animated ocean water for Sitka Skies.
 *
 * A camera-following grid mesh at sea level with a TSL water shader:
 *  - procedural animated wave normals (4 directional sine waves, analytic gradient)
 *  - sun specular glitter (Blinn-Phong, high shininess + perturbed normals)
 *  - Schlick fresnel sky reflection (F0 = 0.02, physical for water)
 *  - depth-based color (turquoise shallow -> dark blue deep) from a per-vertex
 *    depth attribute sampled on the CPU via GeoTerrainManager.getGroundElevation
 *  - cheap whitecaps on wave crests
 *  - radial alpha fade at the rim so the plane edge never shows at the horizon
 *
 * Drop-in: GeoTerrainManager creates and updates this automatically, so the
 * main game, the helicopter game, and all 8 mini-games get it with no changes
 * to their own code. One draw call, ~26k verts, trivial fragment math — iPad-safe.
 */
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  attribute,
  positionWorld,
  cameraPosition,
  time,
  sin,
  cos,
  pow,
  mix,
  clamp,
  smoothstep,
  normalize,
  dot,
  max,
  length,
} from 'three/tsl';
import * as THREE from 'three';
import { DIR_LIGHT_POSITION } from '../constants/rendering.js';

/** Sea level in metres — matches WATER_LEVEL_M in js/app.js and WATER_LEVEL in heli-game.js */
export const WATER_LEVEL = 1.0;

const SIZE = 120000; // 120 km plane, follows the camera
const SEG = 160; // grid segments (26k verts)
const STEP = SIZE / SEG;
const CHUNK = 384; // depth samples refreshed per frame (round-robin, no hitches)
const DEEP_DEFAULT = 60; // metres assumed before heightmap data arrives

// Directional wave trains: normalized direction, wavelength (m), amplitude (m).
// Dispersion is physical: omega = sqrt(g * k), g = 9.81.
const WAVES = [
  { dx: 0.958, dz: 0.287, len: 60.0, amp: 0.3 },
  { dx: -0.573, dz: 0.819, len: 23.0, amp: 0.15 },
  { dx: 0.371, dz: -0.928, len: 9.0, amp: 0.055 },
  { dx: -0.981, dz: -0.196, len: 3.7, amp: 0.022 },
];
const TOTAL_AMP = WAVES.reduce((s, w) => s + w.amp, 0);

/**
 * Analytic wave normal + height packed as vec4(n.xyz, h).
 * p: vec2 world xz, t: time seconds.
 */
const waterNormalHeight = Fn(([p, t]) => {
  let h = float(0.0);
  let gx = float(0.0);
  let gz = float(0.0);
  for (const w of WAVES) {
    const k = float((Math.PI * 2) / w.len);
    const omega = float(Math.sqrt(9.81 * ((Math.PI * 2) / w.len)));
    const phase = p.x.mul(w.dx).add(p.y.mul(w.dz)).mul(k).add(t.mul(omega));
    const s = sin(phase);
    const c = cos(phase);
    h = h.add(s.mul(w.amp));
    const d = c.mul(w.amp).mul(k);
    gx = gx.add(d.mul(w.dx));
    gz = gz.add(d.mul(w.dz));
  }
  const n = vec3(gx.negate(), float(1.0), gz.negate()).normalize();
  return vec4(n.x, n.y, n.z, h);
});

export default class OceanSurface {
  /**
   * @param {THREE.Scene} scene
   * @param {GeoTerrainManager} terrain — used for CPU depth sampling
   */
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geometry.rotateX(-Math.PI / 2); // lie flat in XZ

    const count = geometry.attributes.position.count;
    this._depths = new Float32Array(count).fill(DEEP_DEFAULT);
    this._depthAttr = new THREE.BufferAttribute(this._depths, 1);
    this._depthAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDepth', this._depthAttr);

    this._sunDir = uniform(new THREE.Vector3(...DIR_LIGHT_POSITION).normalize());
    this._center = uniform(new THREE.Vector2(0, 0));

    const sunDir = this._sunDir;
    const uCenter = this._center;

    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    // Pull slightly toward the camera to avoid z-fighting at the waterline
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;

    material.colorNode = Fn(() => {
      const wp = positionWorld;
      const wxz = vec2(wp.x, wp.z);
      const t = time;

      const wh = waterNormalHeight(wxz, t);
      const N = vec3(wh.x, wh.y, wh.z);
      const h = wh.w;
      const depth = attribute('aDepth');

      const toCam = cameraPosition.sub(wp);
      const dist = length(toCam);
      const V = normalize(toCam);
      const L = sunDir;
      const H = normalize(L.add(V));

      const ndl = max(dot(N, L), float(0.0));

      // Depth-based water color: turquoise shallows -> dark blue deep
      const shallow = vec3(0.1, 0.55, 0.58);
      const mid = vec3(0.02, 0.28, 0.46);
      const deep = vec3(0.004, 0.08, 0.2);
      let base = mix(shallow, mid, smoothstep(float(0.0), float(14.0), depth));
      base = mix(base, deep, smoothstep(float(14.0), float(70.0), depth));

      // Simple diffuse wrap so wave flanks aren't pitch black
      let col = base.mul(float(0.38).add(float(0.62).mul(ndl)));

      // Schlick fresnel sky reflection (F0 = 0.02 for water)
      const NoV = max(dot(N, V), float(0.0));
      const F = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NoV), float(5.0))));
      const sky = vec3(0.45, 0.62, 0.78);
      col = mix(col, sky, clamp(F.mul(float(2.0)), float(0.0), float(0.85)));

      // Sun glitter path — tight specular, faded with distance to kill shimmer
      const specFade = float(1.0).sub(smoothstep(float(9000.0), float(22000.0), dist));
      const spec = pow(max(dot(N, H), float(0.0)), float(600.0));
      col = col.add(vec3(1.0, 0.96, 0.88).mul(spec.mul(float(2.5)).mul(specFade)));

      // Whitecaps on crests (cheap)
      const hNorm = h.div(float(TOTAL_AMP)).mul(float(0.5)).add(float(0.5));
      const foam = smoothstep(float(0.7), float(0.98), hNorm);
      col = mix(col, vec3(0.9, 0.94, 0.96), foam.mul(float(0.5)));

      // Radial alpha fade at the rim — the plane edge never shows at the horizon
      const r = length(wxz.sub(uCenter)).div(float(SIZE * 0.5));
      const alpha = float(1.0).sub(smoothstep(float(0.8), float(0.995), r));

      return vec4(col, alpha);
    })();

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);

    this._cursor = 0;
    this._frame = 0;
    this._snappedX = null;
    this._snappedZ = null;
  }

  /**
   * @param {THREE.Vector3} cameraPosition
   * @param {boolean} debugMode — hide the ocean in synthetic/debug texture modes
   */
  update(cameraPosition, debugMode) {
    if (debugMode) {
      this.mesh.visible = false;
      return;
    }
    // (Re-)show; the periodic land check below may hide it again over high terrain.
    this.mesh.visible = true;

    // Snap the mesh to the vertex grid so depth samples stay glued to world points
    const cx = Math.round(cameraPosition.x / STEP) * STEP;
    const cz = Math.round(cameraPosition.z / STEP) * STEP;
    if (cx !== this._snappedX || cz !== this._snappedZ) {
      this._snappedX = cx;
      this._snappedZ = cz;
      this.mesh.position.x = cx;
      this.mesh.position.z = cz;
      this._center.value.set(cx, cz);
    }

    // Round-robin depth refresh: a few hundred verts per frame, zero hitches.
    // Depth only refines as heightmap tiles stream in, so continuous refresh is right.
    const pos = this.mesh.geometry.attributes.position;
    const count = pos.count;
    let start = this._cursor;
    for (let i = 0; i < CHUNK; i++) {
      const idx = this._cursor;
      const wx = cx + pos.getX(idx);
      const wz = cz + pos.getZ(idx);
      let elev = 0;
      try {
        elev = this.terrain.getGroundElevation(wx, wz);
      } catch {
        elev = 0;
      }
      this._depths[idx] = Math.max(0, WATER_LEVEL - elev);
      this._cursor++;
      if (this._cursor >= count) this._cursor = 0;
    }
    const attr = this._depthAttr;
    if (typeof attr.addUpdateRange === 'function') {
      attr.clearUpdateRanges();
      // The refreshed span may wrap around the end of the buffer
      if (start + CHUNK <= count) {
        attr.addUpdateRange(start, CHUNK);
      } else {
        attr.addUpdateRange(start, count - start);
        attr.addUpdateRange(0, (start + CHUNK) % count);
      }
    }
    attr.needsUpdate = true;

    // Hide entirely when the camera is high over land (saves the draw call)
    this._frame++;
    if (this._frame % 30 === 0) {
      let e = 0;
      try {
        e = this.terrain.getGroundElevation(cameraPosition.x, cameraPosition.z);
      } catch {
        e = 0;
      }
      this.mesh.visible = e < 40;
    }
  }

  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
