import * as THREE from 'three';
import { CONFIG } from '../utils/config.js';
import { RATE_DAMP_FACTOR, INITIAL_PITCH } from '../constants/camera.js';

/** Max vertical speed for stick/R-F climb & descend (m/s) */
const CLIMB_SPEED = 400;

export default class FlightController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.position = new THREE.Vector3().copy(camera.position);
    this.quaternion = new THREE.Quaternion();
    this.yaw = 0;
    this.pitch = INITIAL_PITCH;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.keys = {};
    this.touchMove = { x: 0, y: 0 }; // virtual joystick: x = strafe, y = climb (+1) / descend (-1)
    this.throttle = 0.1; // cruise throttle 0..1 — persistent forward speed, plane flies on load
    this.locked = false;
    this.enabled = true;
    this.agility = 1.0; // plane-specific handling multiplier (set by aircraft selection)

    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._axisY = new THREE.Vector3(0, 1, 0);
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    // Initialize quaternion from initial pitch
    this.setOrientation(0, INITIAL_PITCH);

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onClick = this._onClick.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    domElement.addEventListener('click', this._onClick);
  }

  _onClick() {
    // requestPointerLock doesn't exist on iPad Safari — guard it
    if (!this.locked && typeof this.domElement.requestPointerLock === 'function') {
      this.domElement.requestPointerLock();
    }
  }

  _onPointerLockChange() {
    this.locked = document.pointerLockElement === this.domElement;
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    this.yawRate = -e.movementX * CONFIG.mouseSensitivity;
    this.pitchRate = -e.movementY * CONFIG.mouseSensitivity;
    this._pendingYaw += -e.movementX * CONFIG.mouseSensitivity;
    this._pendingPitch += -e.movementY * CONFIG.mouseSensitivity;
  }

  _onKeyDown(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.keys[e.code] = true;
  }

  _onKeyUp(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.keys[e.code] = false;
  }

  setOrientation(yaw, pitch) {
    this._euler.set(pitch, yaw, 0, 'YXZ');
    this.quaternion.setFromEuler(this._euler);
    this.yaw = yaw;
    this.pitch = pitch;
    this._pendingYaw = 0;
    this._pendingPitch = 0;
  }

  /**
   * Touch look: pixel deltas, same sign convention as mouse movement.
   * Used by TouchControls on touch devices (no pointer lock on iPad).
   */
  addLook(dxPx, dyPx) {
    const s = CONFIG.mouseSensitivity;
    this.yawRate = -dxPx * s;
    this.pitchRate = -dyPx * s;
    this._pendingYaw += -dxPx * s;
    this._pendingPitch += -dyPx * s;
  }

  /**
   * Touch movement stick: x = strafe (-1..1), y = climb (+1) / descend (-1).
   * Consumed in update() alongside the keyboard state.
   */
  setTouchMove(x, y) {
    this.touchMove.x = Math.max(-1, Math.min(1, x));
    this.touchMove.y = Math.max(-1, Math.min(1, y));
  }

  update(dt) {
    if (!this.enabled) return;

    // Discard minor-axis pitch during predominantly horizontal sweeps
    // to prevent drift from mouse contamination (~7% typical)
    const absYaw = Math.abs(this._pendingYaw);
    const absPitch = Math.abs(this._pendingPitch);
    if (absYaw > 0.0001 && absPitch / absYaw < 0.2) {
      this._pendingPitch = 0;
    }

    // Accumulate yaw/pitch as scalars (no gimbal lock)
    const hadPitchInput = this._pendingPitch !== 0;
    this.yaw += this._pendingYaw * this.agility;
    this.pitch += this._pendingPitch * this.agility;
    // Auto-level: when the pilot isn't actively pitching, gently ease the
    // nose back to level so cruise doesn't slowly descend into terrain.
    if (!hadPitchInput && dt > 0) {
      const levelRate = 0.1; // rad/s — subtle, doesn't fight deliberate input
      const dp = Math.min(Math.abs(this.pitch), levelRate * dt);
      this.pitch -= Math.sign(this.pitch) * dp;
    }
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    // Rebuild quaternion from scalar angles
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.quaternion.setFromEuler(this._euler);

    // Derive forward and right vectors from quaternion
    this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const fx = this._forward.x;
    const fy = this._forward.y;
    const fz = this._forward.z;
    const rx = this._right.x;
    const rz = this._right.z;

    // Throttle (cruise) + keyboard → forward input. Throttle is persistent:
    // the plane keeps flying without holding the stick.
    // Touch stick Y and R/F keys → direct climb/descend (vertical speed).
    // Keyboard W/S and A/D keep their old full-deflection behavior.
    const clampAxis = (v) => Math.max(-1, Math.min(1, v));
    let fwdInput = clampAxis(this.throttle || 0);
    let strafeInput = clampAxis(this.touchMove.x);
    if (this.keys['ArrowUp'] || this.keys['KeyW']) fwdInput = 1;
    else if (this.keys['ArrowDown'] || this.keys['KeyS']) fwdInput = -1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) strafeInput = 1;
    else if (this.keys['ArrowLeft'] || this.keys['KeyA']) strafeInput = -1;

    let climbInput = clampAxis(this.touchMove.y);
    if (this.keys['KeyE']) climbInput = 1;
    else if (this.keys['KeyQ']) climbInput = -1;

    let mx = fx * fwdInput + rx * strafeInput;
    let my = fy * fwdInput;
    let mz = fz * fwdInput + rz * strafeInput;

    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    // Proportional speed: throttle alone cruises at a fraction of cameraSpeed;
    // W still gives full speed.
    const speedScale = Math.min(1, len);
    const speed = CONFIG.cameraSpeed * speedScale * dt;
    if (len > 0) {
      mx /= len;
      my /= len;
      mz /= len;
    }

    this.position.x += mx * speed;
    this.position.y += my * speed + climbInput * CLIMB_SPEED * dt;
    this.position.z += mz * speed;

    this.yawRate *= Math.max(0, 1 - RATE_DAMP_FACTOR * dt);
    this.pitchRate *= Math.max(0, 1 - RATE_DAMP_FACTOR * dt);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.domElement.removeEventListener('click', this._onClick);
  }
}
