/**
 * FlightRecorder — records the aircraft's world transform as a reusable track.
 *
 * Samples position + quaternion every SAMPLE_INTERVAL_MS while recording.
 * Track format: { version: 1, keyframes: [{t, pos:[x,y,z], quat:[x,y,z,w]}] }
 * where t is seconds since recording start.
 *
 * Persisted to localStorage so tracks survive reload. Decoupled from the
 * flight model — just samples whatever Object3D you hand it each tick.
 */
const SAMPLE_INTERVAL_MS = 100;
const STORAGE_KEY = "osf-flight-track-v1";
const MAX_KEYFRAMES = 36000; // 100ms * 36000 = 1 hour max

export default class FlightRecorder {
  constructor() {
    this.recording = false;
    this.keyframes = [];
    this._startTime = 0;
    this._lastSample = 0;
    this._target = null;
  }

  /** Begin recording transforms from a THREE.Object3D (e.g. aircraft group). */
  start(target) {
    if (!target) return false;
    this._target = target;
    this.keyframes = [];
    this._startTime = performance.now();
    this._lastSample = 0;
    this.recording = true;
    return true;
  }

  stop() {
    this.recording = false;
    this._target = null;
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
    if (!this.recording || !this._target) return;
    const now = performance.now();
    if (now - this._lastSample < SAMPLE_INTERVAL_MS) return;
    this._lastSample = now;
    if (this.keyframes.length >= MAX_KEYFRAMES) {
      this.stop();
      return;
    }
    const t = (now - this._startTime) / 1000;
    const p = this._target.position;
    const q = this._target.quaternion;
    this.keyframes.push({
      t,
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w],
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
