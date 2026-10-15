/**
 * TiltController — iPad tilt-to-fly input.
 *
 * Turns the iPad into the yoke: tilt forward = nose down, tilt back =
 * nose up, tilt left/right = bank. Feeds FlightController through the same
 * setTouchMove(x, y) interface as the virtual joystick, so the flight model
 * is untouched — tilt is a 1:1 joystick replacement.
 *
 * iOS 13.4+ requires DeviceOrientationEvent.requestPermission() from a user
 * gesture; the permission flow is handled on the TILT button's tap.
 *
 * Smoothing: exponential moving average with dt-corrected alpha, plus a
 * per-axis deadzone around the calibrated neutral point.
 */
import Logger from '../utils/Logger.js';

// Max tilt (degrees from neutral) that maps to full deflection, per level.
const SENSITIVITY_LEVELS = {
  low: { maxTiltDeg: 45, label: 'L' },
  medium: { maxTiltDeg: 35, label: 'M' },
  high: { maxTiltDeg: 25, label: 'H' },
};
const SENSITIVITY_ORDER = ['low', 'medium', 'high'];
const DEADZONE_DEG = 2; // ignore drift smaller than this, per axis
const SMOOTH_RATE = 9; // EMA rate (1/s); higher = more responsive, lower = smoother
const CALIBRATION_SAMPLES = 30; // ~0.5s at 60Hz
const DOUBLE_TAP_MS = 350;

const STORE_SENS = 'osf-tilt-sensitivity';

export default class TiltController {
  /** True when the browser exposes DeviceOrientationEvent at all. */
  static isSupported() {
    return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
  }

  /** True on iOS 13.4+, where requestPermission() must run in a user gesture. */
  static needsPermission() {
    return TiltController.isSupported() && typeof window.DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * @param {FlightController} flightController
   * @param {object} [hooks] - { onStateChange(enabled), } UI sync callbacks
   */
  constructor(flightController, hooks = {}) {
    this.fc = flightController;
    this.hooks = hooks;

    this.enabled = false;
    this.permissionGranted = !TiltController.needsPermission();
    this.sensitivity = localStorage.getItem(STORE_SENS) || 'medium';
    if (!SENSITIVITY_LEVELS[this.sensitivity]) this.sensitivity = 'medium';

    // Calibration state
    this.calibrating = false;
    this._calSamples = [];
    this.pitch0 = 0; // neutral pitch (deg, screen space)
    this.roll0 = 0; // neutral roll (deg, screen space)

    // Smoothed deltas (deg)
    this._pitchSm = 0;
    this._rollSm = 0;
    this._lastT = 0;

    this._onOrientation = this._onOrientation.bind(this);
    this._lastTapT = 0;

    this._buildIndicator();
  }

  // ---------------- public API ----------------

  /**
   * Toggle tilt control. On iOS, the first tap runs the permission request
   * (must be inside this user gesture); enabling proceeds only if granted.
   */
  async toggle() {
    if (this.enabled) {
      this.disable();
      return;
    }
    if (!this.permissionGranted) {
      const granted = await this._requestPermission();
      if (!granted) {
        this._toast('Tilt permission denied');
        Logger.warn('Tilt', 'DeviceOrientation permission denied');
        return;
      }
      this.permissionGranted = true;
    }
    this.enable();
  }

  enable() {
    if (this.enabled) return;
    window.addEventListener('deviceorientation', this._onOrientation);
    this.enabled = true;
    document.body.classList.add('tilt-active');
    this._lastT = performance.now();
    this.startCalibration();
    this._syncUI();
    Logger.info('Tilt', `enabled (sensitivity: ${this.sensitivity})`);
  }

  disable() {
    if (!this.enabled) return;
    window.removeEventListener('deviceorientation', this._onOrientation);
    this.enabled = false;
    this.calibrating = false;
    document.body.classList.remove('tilt-active');
    this.fc.setTouchMove(0, 0);
    this._syncUI();
    Logger.info('Tilt', 'disabled');
  }

  /** Re-run neutral calibration (call while holding the iPad level). */
  startCalibration() {
    this._calSamples = [];
    this.calibrating = true;
    this._toast('Hold level — calibrating…');
  }

  /** Cycle low → medium → high sensitivity. */
  cycleSensitivity() {
    const i = SENSITIVITY_ORDER.indexOf(this.sensitivity);
    this.sensitivity = SENSITIVITY_ORDER[(i + 1) % SENSITIVITY_ORDER.length];
    localStorage.setItem(STORE_SENS, this.sensitivity);
    const lvl = SENSITIVITY_LEVELS[this.sensitivity];
    this._toast(`Tilt sensitivity: ${this.sensitivity} (±${lvl.maxTiltDeg}°)`);
    this._syncUI();
    Logger.info('Tilt', `sensitivity → ${this.sensitivity}`);
  }

  /**
   * Button tap handler: single tap toggles, double tap cycles sensitivity.
   * Wire the TILT HUD button's click to this.
   */
  handleButtonTap() {
    const now = performance.now();
    if (now - this._lastTapT < DOUBLE_TAP_MS && this.enabled) {
      this._lastTapT = 0;
      this.cycleSensitivity();
      return;
    }
    this._lastTapT = now;
    // Delay the toggle slightly so a second tap can cancel it into a
    // sensitivity cycle instead.
    setTimeout(() => {
      if (this._lastTapT !== 0) {
        this._lastTapT = 0;
        this.toggle();
      }
    }, DOUBLE_TAP_MS);
  }

  // ---------------- internals ----------------

  async _requestPermission() {
    try {
      const res = await window.DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch (err) {
      Logger.warn('Tilt', `permission request failed: ${err}`);
      return false;
    }
  }

  /**
   * Map raw beta/gamma to screen-space pitch/roll, compensating for screen
   * orientation. Returns degrees where:
   *   pitch > 0 → device tilted forward (top edge away from user)
   *   roll  > 0 → device tilted right (right edge down)
   */
  _screenTilt(beta, gamma) {
    let angle = 0;
    try {
      angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    } catch {
      angle = 0;
    }
    switch (angle) {
      case 90:
        return { pitch: gamma, roll: beta };
      case -90:
        return { pitch: -gamma, roll: -beta };
      case 180:
        return { pitch: -beta, roll: -gamma };
      default:
        return { pitch: beta, roll: gamma };
    }
  }

  _onOrientation(e) {
    if (!this.enabled || e.beta === null || e.gamma === null) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this._lastT) / 1000));
    this._lastT = now;

    const { pitch, roll } = this._screenTilt(e.beta, e.gamma);

    // Calibration: average samples, then lock in the neutral point.
    if (this.calibrating) {
      this._calSamples.push([pitch, roll]);
      if (this._calSamples.length >= CALIBRATION_SAMPLES) {
        const n = this._calSamples.length;
        this.pitch0 = this._calSamples.reduce((s, p) => s + p[0], 0) / n;
        this.roll0 = this._calSamples.reduce((s, p) => s + p[1], 0) / n;
        this.calibrating = false;
        this._pitchSm = 0;
        this._rollSm = 0;
        this._toast('Tilt ready');
        Logger.info('Tilt', `calibrated neutral pitch=${this.pitch0.toFixed(1)}° roll=${this.roll0.toFixed(1)}°`);
      }
      this.fc.setTouchMove(0, 0);
      return;
    }

    // Deltas from neutral, with deadzone.
    let dPitch = pitch - this.pitch0;
    let dRoll = roll - this.roll0;
    if (Math.abs(dPitch) < DEADZONE_DEG) dPitch = 0;
    if (Math.abs(dRoll) < DEADZONE_DEG) dRoll = 0;

    // Exponential moving average (dt-corrected).
    const a = 1 - Math.exp(-SMOOTH_RATE * dt);
    this._pitchSm += a * (dPitch - this._pitchSm);
    this._rollSm += a * (dRoll - this._rollSm);

    // Normalize to -1..1. Tilt forward (pitch+) = nose down = descend (-y).
    const maxTilt = SENSITIVITY_LEVELS[this.sensitivity].maxTiltDeg;
    const y = Math.max(-1, Math.min(1, this._pitchSm / maxTilt));
    const x = Math.max(-1, Math.min(1, this._rollSm / maxTilt));
    this.fc.setTouchMove(x, y);

    this._updateIndicator(x, y);
  }

  // ---------------- UI ----------------

  _syncUI() {
    if (this.hooks.onStateChange) this.hooks.onStateChange(this.enabled, this.sensitivity);
    const ind = document.getElementById('tc-tilt-indicator');
    if (ind) ind.style.display = this.enabled ? 'block' : 'none';
  }

  _buildIndicator() {
    if (document.getElementById('tc-tilt-indicator')) return;
    const el = document.createElement('div');
    el.id = 'tc-tilt-indicator';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div id="tc-tilt-dot"></div><div id="tc-tilt-level">M</div>';
    el.style.display = 'none';
    document.body.appendChild(el);
    this._indicator = el;
    this._dot = el.querySelector('#tc-tilt-dot');
    this._level = el.querySelector('#tc-tilt-level');
  }

  _updateIndicator(x, y) {
    if (!this._dot) return;
    // Dot moves with tilt: right = +x, up = +y(climb). 24px max travel.
    this._dot.style.transform = `translate(${x * 24}px, ${-y * 24}px)`;
    const lbl = SENSITIVITY_LEVELS[this.sensitivity].label;
    if (this._level && this._level.textContent !== lbl) this._level.textContent = lbl;
  }

  _toast(msg) {
    let t = document.getElementById('tc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  dispose() {
    this.disable();
    if (this._indicator) this._indicator.remove();
    const t = document.getElementById('tc-toast');
    if (t) t.remove();
  }
}
