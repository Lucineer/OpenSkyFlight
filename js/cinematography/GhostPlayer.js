/**
 * GhostPlayer — replays a recorded flight track as a semi-transparent ghost plane.
 *
 * Spawns a clone of the player's aircraft model, applies ghost materials
 * (transparent, emissive tint), and interpolates position/quaternion between
 * keyframes in sync with the sim clock. Loops by default.
 *
 * Decoupled: just needs a THREE.Scene, a source Object3D to clone, and a
 * keyframe array in FlightRecorder track format.
 */
import * as THREE from 'three';

const GHOST_OPACITY = 0.45;
const GHOST_TINT = 0x7df9ff; // cyan glow

export default class GhostPlayer {
  constructor(scene) {
    this.scene = scene;
    this.ghost = null;
    this.keyframes = [];
    this.playing = false;
    this.visible = true;
    this.loop = true;
    this._playStart = 0;
    this._duration = 0;

    this._posA = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._quatA = new THREE.Quaternion();
    this._quatB = new THREE.Quaternion();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
  }

  /**
   * Build the ghost from a source Object3D (e.g. aircraftManager.group).
   * Clones the hierarchy and swaps materials for transparent ghost versions.
   */
  buildFrom(source) {
    this.dispose();
    if (!source) return false;
    this.ghost = source.clone(true);
    this.ghost.traverse((child) => {
      if (child.isMesh) {
        child.material = this._ghostMaterial(child.material);
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    return true;
  }

  _ghostMaterial(orig) {
    const mat = new THREE.MeshBasicMaterial({
      color: GHOST_TINT,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    });
    // Preserve original color as a tint blend if available
    if (orig && orig.color) {
      mat.color.copy(orig.color).lerp(new THREE.Color(GHOST_TINT), 0.5);
    }
    return mat;
  }

  /** Load keyframes in FlightRecorder track format. */
  setTrack(keyframes) {
    if (!Array.isArray(keyframes) || keyframes.length < 2) return false;
    this.keyframes = keyframes;
    this._duration = keyframes[keyframes.length - 1].t;
    return true;
  }

  getDuration() {
    return this._duration;
  }

  hasTrack() {
    return this.keyframes.length > 1;
  }

  play() {
    if (!this.hasTrack() || !this.ghost) return false;
    this._playStart = performance.now();
    this.playing = true;
    this.ghost.visible = this.visible;
    return true;
  }

  stop() {
    this.playing = false;
    if (this.ghost) this.ghost.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    if (this.ghost) this.ghost.visible = v && this.playing;
  }

  isPlaying() {
    return this.playing;
  }

  /** Call every frame. */
  tick() {
    if (!this.playing || !this.ghost || !this.hasTrack()) return;
    let elapsed = (performance.now() - this._playStart) / 1000;
    if (this.loop) {
      elapsed = elapsed % this._duration;
    } else if (elapsed >= this._duration) {
      this.stop();
      return;
    }
    this._sampleAt(elapsed);
  }

  _sampleAt(t) {
    const kf = this.keyframes;
    // Binary search for the segment containing t
    let lo = 0,
      hi = kf.length - 1;
    if (t <= kf[0].t) {
      this._applyKeyframe(kf[0]);
      return;
    }
    if (t >= kf[hi].t) {
      this._applyKeyframe(kf[hi]);
      return;
    }
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
    this.ghost.position.copy(this._tmpPos);
    this.ghost.quaternion.copy(this._tmpQuat);
  }

  _applyKeyframe(k) {
    this.ghost.position.set(k.pos[0], k.pos[1], k.pos[2]);
    this.ghost.quaternion.set(k.quat[0], k.quat[1], k.quat[2], k.quat[3]);
  }

  dispose() {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((child) => {
        if (child.isMesh && child.material) child.material.dispose();
      });
      this.ghost = null;
    }
    this.playing = false;
    this.keyframes = [];
    this._duration = 0;
  }
}
