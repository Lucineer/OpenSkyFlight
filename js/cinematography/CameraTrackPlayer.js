/**
 * CameraTrackPlayer — replays a recorded camera track.
 *
 * Interpolates camera position + look-at target between keyframes in sync
 * with the sim clock, then drives the camera with camera.position /
 * camera.lookAt(). Loops by default.
 *
 * Decoupled: just needs a THREE.Camera and a keyframe array in
 * CameraTrackRecorder track format. Call tick() AFTER the normal camera
 * phase in the animate loop so the track overrides the live camera.
 * Can play alongside a plane track (ghost or motion tile) for
 * choreographed shots.
 */
import * as THREE from 'three';

export default class CameraTrackPlayer {
  constructor() {
    this.keyframes = [];
    this.playing = false;
    this.loop = true;
    this._playStart = 0;
    this._duration = 0;

    this._posA = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._lookA = new THREE.Vector3();
    this._lookB = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
    this._tmpLook = new THREE.Vector3();
  }

  /** Load keyframes in CameraTrackRecorder track format. */
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
    if (!this.hasTrack()) return false;
    this._playStart = performance.now();
    this.playing = true;
    return true;
  }

  stop() {
    this.playing = false;
  }

  isPlaying() {
    return this.playing;
  }

  /** Call every frame, AFTER the normal camera phase, with the live camera. */
  tick(camera) {
    if (!this.playing || !camera || !this.hasTrack()) return;
    let elapsed = (performance.now() - this._playStart) / 1000;
    if (this.loop) {
      elapsed = elapsed % this._duration;
    } else if (elapsed >= this._duration) {
      this.stop();
      return;
    }
    this._sampleAt(elapsed, camera);
  }

  _sampleAt(t, camera) {
    const kf = this.keyframes;
    if (t <= kf[0].t) {
      this._applyKeyframe(kf[0], camera);
      return;
    }
    const hi0 = kf.length - 1;
    if (t >= kf[hi0].t) {
      this._applyKeyframe(kf[hi0], camera);
      return;
    }
    // Binary search for the segment containing t
    let lo = 0,
      hi = hi0;
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
    this._lookA.set(a.lookAt[0], a.lookAt[1], a.lookAt[2]);
    this._lookB.set(b.lookAt[0], b.lookAt[1], b.lookAt[2]);
    this._tmpPos.lerpVectors(this._posA, this._posB, alpha);
    this._tmpLook.lerpVectors(this._lookA, this._lookB, alpha);
    camera.position.copy(this._tmpPos);
    camera.lookAt(this._tmpLook);
  }

  _applyKeyframe(k, camera) {
    camera.position.set(k.pos[0], k.pos[1], k.pos[2]);
    camera.lookAt(k.lookAt[0], k.lookAt[1], k.lookAt[2]);
  }
}
