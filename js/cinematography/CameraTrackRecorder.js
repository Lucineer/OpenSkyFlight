/**
 * CameraTrackRecorder — records the camera's motion as a reusable track.
 *
 * Samples camera position + a look-at point every SAMPLE_INTERVAL_MS while
 * recording. The look-at point is the camera position plus the camera's
 * forward direction scaled by LOOK_AHEAD, so playback with camera.lookAt()
 * reproduces the recorded framing.
 *
 * Track format: { version: 1, keyframes: [{t, pos:[x,y,z], lookAt:[x,y,z]}] }
 * where t is seconds since recording start.
 *
 * Persisted to localStorage so tracks survive reload. Decoupled from the
 * flight model — just samples whatever THREE.Camera you hand it each tick.
 */
import * as THREE from 'three';

const SAMPLE_INTERVAL_MS = 100;
const STORAGE_KEY = 'osf-camera-track-v1';
const MAX_KEYFRAMES = 36000; // 100ms * 36000 = 1 hour max
const LOOK_AHEAD = 100; // metres ahead of the camera for the look-at point

export default class CameraTrackRecorder {
  constructor() {
    this.recording = false;
    this.keyframes = [];
    this._startTime = 0;
    this._lastSample = 0;
    this._camera = null;
    this._forward = new THREE.Vector3();
  }

  /** Begin recording transforms from a THREE.Camera. */
  start(camera) {
    if (!camera) return false;
    this._camera = camera;
    this.keyframes = [];
    this._startTime = performance.now();
    this._lastSample = 0;
    this.recording = true;
    return true;
  }

  stop() {
    this.recording = false;
    this._camera = null;
    if (this.keyframes.length > 1) {
      this.save();
    }
    return this.keyframes.length;
  }

  isRecording() {
    return this.recording;
  }

  getKeyframeCount() {
    return this.keyframes.length;
  }

  getDuration() {
    if (this.keyframes.length < 2) return 0;
    return this.keyframes[this.keyframes.length - 1].t;
  }

  /** Call every frame; samples at ~10Hz while recording. */
  tick() {
    if (!this.recording || !this._camera) return;
    const now = performance.now();
    if (now - this._lastSample < SAMPLE_INTERVAL_MS) return;
    this._lastSample = now;
    if (this.keyframes.length >= MAX_KEYFRAMES) {
      this.stop();
      return;
    }
    const t = (now - this._startTime) / 1000;
    const p = this._camera.position;
    this._camera.getWorldDirection(this._forward);
    this.keyframes.push({
      t,
      pos: [p.x, p.y, p.z],
      lookAt: [
        p.x + this._forward.x * LOOK_AHEAD,
        p.y + this._forward.y * LOOK_AHEAD,
        p.z + this._forward.z * LOOK_AHEAD,
      ],
    });
  }

  toJSON() {
    return { version: 1, keyframes: this.keyframes };
  }

  fromJSON(data) {
    if (!data || !Array.isArray(data.keyframes)) return false;
    this.keyframes = data.keyframes;
    return this.keyframes.length > 0;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch {
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      return this.fromJSON(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  clear() {
    this.keyframes = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  hasTrack() {
    return this.keyframes.length > 1;
  }
}

export { STORAGE_KEY };
