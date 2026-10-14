/**
 * MotionTilePlayer — plays scripted maneuver tiles as kinematic tracks.
 *
 * A motion tile is a JSON track in FlightRecorder keyframe format, authored
 * in a local frame (origin at [0, entry.altitudeM, 0], entry heading). On
 * play(), the tile is transformed into world space anchored at the plane's
 * current position + heading, so the maneuver starts exactly where the plane
 * is and chains cleanly from the previous tile's exit state.
 *
 * Tiles chain: every tile's exit matches its entry (speed, heading,
 * altitude), so a queued sequence plays seamlessly. When playback ends,
 * control returns to the caller, which should sync the flight controller
 * to the final state.
 *
 * Decoupled: just needs an origin state {position, yaw} to anchor the
 * first tile, and provides getState() each frame. The caller owns the
 * aircraftState wiring (see app.js).
 */
import * as THREE from 'three';

const TILE_CATALOG = [
  {
    id: 'akira-A',
    label: 'Akira Slide — Subtle (20°)',
    url: '/motion-tiles/01-akira-sideslip/tile-01-akira-sideslip-A-subtle.json',
  },
  {
    id: 'akira-B',
    label: 'Akira Slide — Classic (34°)',
    url: '/motion-tiles/01-akira-sideslip/tile-01-akira-sideslip-B-classic.json',
  },
  {
    id: 'akira-C',
    label: 'Akira Slide — Dramatic (45°)',
    url: '/motion-tiles/01-akira-sideslip/tile-01-akira-sideslip-C-dramatic.json',
  },
];

export { TILE_CATALOG };

export default class MotionTilePlayer {
  constructor() {
    this.playing = false;
    this.queue = []; // pending tile objects (already loaded JSON)
    this.currentTile = null;
    this._keyframes = []; // world-space transformed keyframes for current tile
    this._duration = 0;
    this._playStart = 0;
    this._cache = new Map(); // url -> tile JSON

    this._posA = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._quatA = new THREE.Quaternion();
    this._quatB = new THREE.Quaternion();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._originPos = new THREE.Vector3();
    this._originQuat = new THREE.Quaternion();
    this._frameQuat = new THREE.Quaternion();
    this._axisY = new THREE.Vector3(0, 1, 0);
    this._tileOrigin = new THREE.Vector3();
  }

  /** Fetch + cache a tile JSON by URL. Returns the parsed tile or null. */
  async loadTile(url) {
    if (this._cache.has(url)) return this._cache.get(url);
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const tile = await res.json();
      if (!tile || !Array.isArray(tile.keyframes) || tile.keyframes.length < 2) return null;
      this._cache.set(url, tile);
      return tile;
    } catch {
      return null;
    }
  }

  /** Preload all catalog tiles (best-effort, for snappy UI). */
  async preloadCatalog() {
    await Promise.all(TILE_CATALOG.map((t) => this.loadTile(t.url)));
  }

  /**
   * Play a tile (or array of tiles) anchored at the given origin state.
   * origin: { position: THREE.Vector3, yaw: number } — plane's current state.
   * Replaces any in-progress playback.
   */
  play(tiles, origin) {
    const list = Array.isArray(tiles) ? tiles : [tiles];
    if (list.length === 0 || !origin) return false;
    this.queue = list.slice(1);
    this.currentTile = list[0];
    if (!this._startTile(this.currentTile, origin)) return false;
    this.playing = true;
    return true;
  }

  /** Append tiles to the queue (chain mode). Starts playback if idle. */
  queueTiles(tiles, origin) {
    const list = Array.isArray(tiles) ? tiles : [tiles];
    if (list.length === 0) return false;
    if (!this.playing) return this.play(list, origin);
    this.queue.push(...list);
    return true;
  }

  /** Stop playback. Returns the final state for handoff, or null. */
  stop() {
    const final = this.playing ? this._currentState() : null;
    this.playing = false;
    this.currentTile = null;
    this.queue = [];
    this._keyframes = [];
    this._duration = 0;
    return final;
  }

  isPlaying() {
    return this.playing;
  }

  getQueueLength() {
    return this.queue.length;
  }

  getCurrentTileName() {
    return this.currentTile ? this.currentTile.name : null;
  }

  /**
   * Transform a tile's local keyframes into world space anchored at origin.
   * Tile local frame: origin [0, entry.altitudeM, 0], heading = entry.yawRad.
   */
  _startTile(tile, origin) {
    if (!tile || !tile.entry || !Array.isArray(tile.keyframes)) return false;
    const entryYaw = typeof tile.entry.yawRad === 'number' ? tile.entry.yawRad : -Math.PI / 2;
    const entryAlt = typeof tile.entry.altitudeM === 'number' ? tile.entry.altitudeM : 0;
    const deltaYaw = origin.yaw - entryYaw;
    this._frameQuat.setFromAxisAngle(this._axisY, deltaYaw);
    this._originPos.copy(origin.position);
    this._tileOrigin.set(0, entryAlt, 0);

    this._keyframes = tile.keyframes.map((kf) => {
      // pos: world = origin + R * (local - tileOrigin)
      this._tmpPos.set(kf.pos[0], kf.pos[1], kf.pos[2]).sub(this._tileOrigin);
      this._tmpPos.applyQuaternion(this._frameQuat);
      this._tmpPos.add(this._originPos);
      // quat: world = R * local
      this._tmpQuat.set(kf.quat[0], kf.quat[1], kf.quat[2], kf.quat[3]);
      this._tmpQuat.premultiply(this._frameQuat);
      return {
        t: kf.t,
        pos: [this._tmpPos.x, this._tmpPos.y, this._tmpPos.z],
        quat: [this._tmpQuat.x, this._tmpQuat.y, this._tmpQuat.z, this._tmpQuat.w],
      };
    });
    this._duration = this._keyframes[this._keyframes.length - 1].t;
    this._playStart = performance.now();
    return true;
  }

  /** Current sampled state. Call every frame while playing. */
  tick() {
    if (!this.playing || this._keyframes.length < 2) return null;
    let elapsed = (performance.now() - this._playStart) / 1000;
    if (elapsed >= this._duration) {
      // Tile complete — advance to next in queue, anchored at current state
      const endState = this._currentState();
      if (this.queue.length > 0) {
        this.currentTile = this.queue.shift();
        const origin = {
          position: endState.position.clone(),
          yaw: endState.yaw,
        };
        if (!this._startTile(this.currentTile, origin)) {
          this.stop();
          return endState;
        }
        elapsed = 0;
      } else {
        this.playing = false;
        this.currentTile = null;
        this._keyframes = [];
        this._duration = 0;
        return endState;
      }
    }
    return this._currentState(elapsed);
  }

  /** Sample the current tile at time t (defaults to now). */
  _currentState(t) {
    const kf = this._keyframes;
    if (kf.length === 0) return null;
    if (t === undefined) t = (performance.now() - this._playStart) / 1000;
    t = Math.max(0, Math.min(t, this._duration));

    let pos, quat;
    if (t <= kf[0].t) {
      pos = this._posA.set(kf[0].pos[0], kf[0].pos[1], kf[0].pos[2]);
      quat = this._quatA.set(kf[0].quat[0], kf[0].quat[1], kf[0].quat[2], kf[0].quat[3]);
    } else if (t >= kf[kf.length - 1].t) {
      const last = kf[kf.length - 1];
      pos = this._posA.set(last.pos[0], last.pos[1], last.pos[2]);
      quat = this._quatA.set(last.quat[0], last.quat[1], last.quat[2], last.quat[3]);
    } else {
      // Binary search for the segment containing t
      let lo = 0,
        hi = kf.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (kf[mid].t <= t) lo = mid;
        else hi = mid;
      }
      const a = kf[lo],
        b = kf[hi];
      const span = b.t - a.t;
      const alpha = span > 0 ? (t - a.t) / span : 0;
      this._posA.set(a.pos[0], a.pos[1], a.pos[2]);
      this._posB.set(b.pos[0], b.pos[1], b.pos[2]);
      this._quatA.set(a.quat[0], a.quat[1], a.quat[2], a.quat[3]);
      this._quatB.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
      this._tmpPos.lerpVectors(this._posA, this._posB, alpha);
      this._tmpQuat.slerpQuaternions(this._quatA, this._quatB, alpha);
      pos = this._tmpPos;
      quat = this._tmpQuat;
    }

    // Extract yaw/pitch for aircraftState consumers
    this._tmpEuler.setFromQuaternion(quat, 'YXZ');
    return {
      position: pos.clone(),
      quaternion: quat.clone(),
      yaw: this._tmpEuler.y,
      pitch: this._tmpEuler.x,
      yawRate: 0,
      pitchRate: 0,
      roll: 0,
    };
  }
}
