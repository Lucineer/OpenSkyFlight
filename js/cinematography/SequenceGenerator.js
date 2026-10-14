/**
 * SequenceGenerator — generates endless flight cinematography sequences.
 *
 * A sequence is a set of motion tiles (plane choreography) plus a camera
 * track (cinematography) that plays alongside it. Sequences are generated
 * deterministically from a seed, so they can be replayed or shared.
 *
 * Camera styles:
 * - chase: follows behind and slightly above the plane
 * - orbit: circles the plane's path midpoint
 * - ground: fixed low camera looking up at the plane as it passes
 * - side: tracks alongside the plane at a fixed offset
 *
 * Decoupled: produces a plain sequence object { name, tiles, cameraTrack }.
 * The caller owns playback (MotionTilePlayer + CameraTrackPlayer).
 *
 * Security: sequences are purely synthetic — generated from public
 * terrain data and the motion tile library. No camera, microphone, GPS,
 * or personal data is involved.
 */
import * as THREE from 'three';
import { TILE_CATALOG } from './MotionTilePlayer.js';

const CAMERA_STYLES = ['chase', 'orbit', 'ground', 'side'];

// Seeded PRNG (mulberry32) — deterministic sequences from a seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class SequenceGenerator {
  constructor(tilePlayer) {
    this.tilePlayer = tilePlayer;
    this.sequenceCount = 0;
    this._cache = new Map();
  }

  /** Generate a sequence from a seed. Returns { name, tiles, cameraTrack, duration }. */
  async generate(seed) {
    const rng = mulberry32(seed);
    const tileCount = 2 + Math.floor(rng() * 3); // 2-4 tiles
    const tiles = [];
    const tileNames = [];
    for (let i = 0; i < tileCount; i++) {
      const idx = Math.floor(rng() * TILE_CATALOG.length);
      const catalogEntry = TILE_CATALOG[idx];
      const tile = await this.tilePlayer.loadTile(catalogEntry.url);
      if (tile) {
        tiles.push(tile);
        tileNames.push(catalogEntry.label);
      }
    }
    if (tiles.length === 0) return null;

    const style = CAMERA_STYLES[Math.floor(rng() * CAMERA_STYLES.length)];
    const cameraTrack = this._generateCameraTrack(tiles, style, rng);

    const name = `Seq ${seed} — ${tileNames.join(' → ')} [${style}]`;
    this.sequenceCount++;
    return {
      name,
      seed,
      tiles,
      cameraTrack,
      style,
      duration: this._estimateDuration(tiles),
    };
  }

  /** Estimate total duration from tile keyframes. */
  _estimateDuration(tiles) {
    let total = 0;
    for (const tile of tiles) {
      if (tile.keyframes && tile.keyframes.length > 0) {
        total += tile.keyframes[tile.keyframes.length - 1].t;
      }
    }
    return total;
  }

  /**
   * Generate a camera track that follows the plane's tile path.
   * Samples the plane path by walking tile keyframes, then places the
   * camera per the chosen style. Returns keyframes in
   * CameraTrackPlayer format: [{t, pos:[x,y,z], lookAt:[x,y,z]}].
   */
  _generateCameraTrack(tiles, style, rng) {
    // Build the plane's world-space path by concatenating tile keyframes.
    // Tiles are in local frame (origin [0, altitudeM, 0]); we place them
    // sequentially, each starting where the previous ended, heading -Z.
    const path = [];
    let offsetX = 0;
    let offsetZ = 0;
    let timeOffset = 0;

    for (const tile of tiles) {
      if (!tile.keyframes || tile.keyframes.length < 2) continue;
      for (const kf of tile.keyframes) {
        path.push({
          t: timeOffset + kf.t,
          pos: new THREE.Vector3(kf.pos[0] + offsetX, kf.pos[1], kf.pos[2] + offsetZ),
        });
      }
      const last = tile.keyframes[tile.keyframes.length - 1];
      offsetX += last.pos[0];
      offsetZ += last.pos[2];
      timeOffset += last.t;
    }
    if (path.length < 2) return [];

    // Sample the path at ~10 Hz for camera keyframes
    const duration = path[path.length - 1].t;
    const keyframes = [];
    const sampleCount = Math.max(2, Math.floor(duration * 10));
    const tmpPos = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();

    for (let i = 0; i <= sampleCount; i++) {
      const t = (i / sampleCount) * duration;
      const planePos = this._samplePath(path, t, tmpPos);
      // Plane forward: sample slightly ahead
      this._samplePath(path, Math.min(t + 0.5, duration), tmpDir);
      tmpDir.sub(planePos).normalize();

      let camPos, lookAt;
      switch (style) {
        case 'chase': {
          // Behind and above the plane, looking at it
          camPos = planePos
            .clone()
            .addScaledVector(tmpDir, -80)
            .add(new THREE.Vector3(0, 25, 0));
          lookAt = planePos.clone();
          break;
        }
        case 'orbit': {
          // Circle around the path midpoint, looking at the plane
          const angle = (t / duration) * Math.PI * 2;
          const radius = 150;
          const mid = path[Math.floor(path.length / 2)].pos;
          camPos = new THREE.Vector3(mid.x + Math.cos(angle) * radius, mid.y + 60, mid.z + Math.sin(angle) * radius);
          lookAt = planePos.clone();
          break;
        }
        case 'ground': {
          // Fixed low camera, plane flies overhead
          const groundY = 10;
          camPos = new THREE.Vector3(planePos.x - 100, groundY, planePos.z + 50);
          lookAt = planePos.clone();
          break;
        }
        case 'side':
        default: {
          // Alongside the plane, 60m to the right, looking at it
          const right = new THREE.Vector3(-tmpDir.z, 0, tmpDir.x);
          camPos = planePos
            .clone()
            .addScaledVector(right, 60)
            .add(new THREE.Vector3(0, 10, 0));
          lookAt = planePos.clone();
          break;
        }
      }

      // Add slight variation from rng so sequences feel different
      const jitter = (rng() - 0.5) * 5;
      camPos.x += jitter;
      camPos.y += jitter * 0.5;

      keyframes.push({
        t,
        pos: [camPos.x, camPos.y, camPos.z],
        lookAt: [lookAt.x, lookAt.y, lookAt.z],
      });
    }
    return keyframes;
  }

  /** Sample the plane path at time t (linear interp between keyframes). */
  _samplePath(path, t, out) {
    if (t <= path[0].t) {
      out.copy(path[0].pos);
      return out;
    }
    const last = path[path.length - 1];
    if (t >= last.t) {
      out.copy(last.pos);
      return out;
    }
    let lo = 0,
      hi = path.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (path[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = path[lo],
      b = path[hi];
    const span = b.t - a.t;
    const alpha = span > 0 ? (t - a.t) / span : 0;
    out.lerpVectors(a.pos, b.pos, alpha);
    return out;
  }
}
