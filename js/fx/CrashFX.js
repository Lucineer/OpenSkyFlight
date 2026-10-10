import * as THREE from 'three';

/**
 * CrashFX — crash particles, camera shake, wreck-tumble animation, and the
 * crash / respawn UI for OpenSkyFlight.
 *
 * Everything is built programmatically (no HTML/CSS/asset changes needed):
 *  - one THREE.Points pool with a tiny custom shader for fire, smoke,
 *    sparks, and dust
 *  - a decaying camera shake applied after the camera phase each frame
 *  - a ~2.5s wreck animation that tumbles the FlightController directly
 *    (the aircraft mesh and camera follow because they read its state)
 *  - a "CRASHED!" banner with rotating quips and a FLY AGAIN button
 */

const MAX_PARTICLES = 512;
const CRASH_DURATION = 2.5;

const QUIPS = [
  'The mountain was here first.',
  'Gravity: 1, You: 0.',
  'That landing needs paperwork.',
  'The ground came out of nowhere!',
  'Somewhere, a flight instructor just winced.',
  'The warranty does not cover this.',
  'That mountain had the right of way.',
  'You have selected: the ground.',
  'Controlled flight into terrain. Emphasis on "into".',
];

const WATER_QUIPS = [
  'Splashdown. The fish have filed a complaint.',
  'That is not how seaplanes work.',
  'You have selected: the ocean.',
  'The water was harder than it looked.',
  'Ditching complete. 3 out of 10 for style.',
  'The coast guard has been notified.',
  'Somewhere, a lifeguard just facepalmed.',
  'Bellyflop! The judges give it a 2.',
  'That entry needed more tuck.',
];

const TYPE_LABELS = {
  fireball: 'FIREBALL',
  skid: 'SKIDDED OUT',
  cartwheel: 'CARTWHEEL!',
  bump: 'GENTLE BUMP',
  splash: 'SPLASHDOWN!',
  bellyflop: 'BELLYFLOP!',
  ditch: 'DITCHED',
  nosedive: 'NOSEDIVE!',
  cliffstrike: 'CLIFF STRIKE!',
  stalldrop: 'STALL DROP',
  bounce: 'BOUNCED IT!',
};

// Camera shake amplitude (meters) per crash type; decays over CRASH_DURATION.
const SHAKE_AMP = {
  fireball: 4.0,
  skid: 2.0,
  cartwheel: 2.0,
  bump: 0.8,
  splash: 1.2,
  bellyflop: 2.5,
  ditch: 0.6,
  nosedive: 5.0,
  cliffstrike: 3.5,
  stalldrop: 1.8,
  bounce: 1.5,
};

export default class CrashFX {
  constructor(scene) {
    this.scene = scene;
    this.active = false; // a crash animation is running
    this.bannerShown = false;
    this.type = null;
    this.t = 0;
    this.shakeAmp = 0;
    this.vel = new THREE.Vector3();
    this.spinAxis = new THREE.Vector3(1, 0, 0);
    this.spinRate = 0;
    this._worldSpin = false;
    this.groundAt = null;
    this._respawnHandler = null;
    this._flashOn = false;

    this._tmpQ = new THREE.Quaternion();
    this._axisX = new THREE.Vector3(1, 0, 0);

    this._buildParticles();
    this._buildUI();
  }

  // ---------------------------------------------------------------- particles

  _buildParticles() {
    this._cursor = 0;
    this._pos = new Float32Array(MAX_PARTICLES * 3);
    this._vel = new Float32Array(MAX_PARTICLES * 3);
    this._col = new Float32Array(MAX_PARTICLES * 3);
    this._size = new Float32Array(MAX_PARTICLES);
    this._alpha = new Float32Array(MAX_PARTICLES);
    this._life = new Float32Array(MAX_PARTICLES);
    this._maxLife = new Float32Array(MAX_PARTICLES);
    this._grav = new Float32Array(MAX_PARTICLES);
    this._drag = new Float32Array(MAX_PARTICLES);
    this._grow = new Float32Array(MAX_PARTICLES);
    this._baseSize = new Float32Array(MAX_PARTICLES);
    this._baseAlpha = new Float32Array(MAX_PARTICLES);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this._col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this._size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this._alpha, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float px = aSize * (240.0 / max(1.0, -mv.z));
          gl_PointSize = min(px, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.12, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.scene.add(this.points);
  }

  _spawn(x, y, z, kind) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % MAX_PARTICLES;
    const i3 = i * 3;
    const r = Math.random;
    this._pos[i3] = x;
    this._pos[i3 + 1] = y;
    this._pos[i3 + 2] = z;

    if (kind === 'fire') {
      const heat = r(); // 0 = yellow-hot, 1 = deep red
      this._col[i3] = 1.0;
      this._col[i3 + 1] = 0.35 + 0.45 * (1 - heat);
      this._col[i3 + 2] = 0.05 + 0.1 * (1 - heat);
      const sp = 15 + r() * 45;
      const th = r() * Math.PI * 2;
      const ph = r() * Math.PI;
      this._vel[i3] = Math.sin(ph) * Math.cos(th) * sp;
      this._vel[i3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9 + 12;
      this._vel[i3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this._life[i] = this._maxLife[i] = 0.5 + r() * 0.5;
      this._baseSize[i] = 9 + r() * 9;
      this._grow[i] = -6;
      this._grav[i] = -30; // buoyant, rises
      this._drag[i] = 1.6;
      this._baseAlpha[i] = 0.95;
    } else if (kind === 'smoke') {
      const g = 0.22 + r() * 0.18;
      this._col[i3] = g;
      this._col[i3 + 1] = g;
      this._col[i3 + 2] = g * 1.05;
      const sp = 8 + r() * 18;
      const th = r() * Math.PI * 2;
      this._vel[i3] = Math.cos(th) * sp;
      this._vel[i3 + 1] = 10 + r() * 18;
      this._vel[i3 + 2] = Math.sin(th) * sp;
      this._life[i] = this._maxLife[i] = 1.8 + r() * 1.2;
      this._baseSize[i] = 15 + r() * 12;
      this._grow[i] = 9;
      this._grav[i] = -10;
      this._drag[i] = 0.9;
      this._baseAlpha[i] = 0.5;
    } else if (kind === 'spark') {
      this._col[i3] = 1.0;
      this._col[i3 + 1] = 0.85 + r() * 0.15;
      this._col[i3 + 2] = 0.4 + r() * 0.3;
      const sp = 60 + r() * 120;
      const th = r() * Math.PI * 2;
      this._vel[i3] = Math.cos(th) * sp;
      this._vel[i3 + 1] = r() * 0.9 * sp * 0.5;
      this._vel[i3 + 2] = Math.sin(th) * sp;
      this._life[i] = this._maxLife[i] = 0.3 + r() * 0.35;
      this._baseSize[i] = 3 + r() * 2.5;
      this._grow[i] = 0;
      this._grav[i] = 320; // falls fast
      this._drag[i] = 0.6;
      this._baseAlpha[i] = 1.0;
    } else if (kind === 'splash') {
      const w = 0.75 + r() * 0.25; // white to pale cyan
      this._col[i3] = w * 0.82;
      this._col[i3 + 1] = w * 0.94;
      this._col[i3 + 2] = w;
      const sp = 25 + r() * 55;
      const th = r() * Math.PI * 2;
      const up = 0.75 + r() * 0.6; // mostly-upward cone: the plume
      this._vel[i3] = Math.cos(th) * sp * 0.45;
      this._vel[i3 + 1] = sp * up;
      this._vel[i3 + 2] = Math.sin(th) * sp * 0.45;
      this._life[i] = this._maxLife[i] = 0.7 + r() * 0.7;
      this._baseSize[i] = 10 + r() * 10;
      this._grow[i] = 6;
      this._grav[i] = 260; // arcs back down into the water
      this._drag[i] = 0.8;
      this._baseAlpha[i] = 0.9;
    } else {
      // 'dust'
      const t = 0.72 + r() * 0.1;
      this._col[i3] = t;
      this._col[i3 + 1] = t * 0.87;
      this._col[i3 + 2] = t * 0.66;
      const sp = 14 + r() * 30;
      const th = r() * Math.PI * 2;
      this._vel[i3] = Math.cos(th) * sp;
      this._vel[i3 + 1] = 4 + r() * 12;
      this._vel[i3 + 2] = Math.sin(th) * sp;
      this._life[i] = this._maxLife[i] = 1.0 + r() * 0.9;
      this._baseSize[i] = 13 + r() * 10;
      this._grow[i] = 11;
      this._grav[i] = -7;
      this._drag[i] = 1.4;
      this._baseAlpha[i] = 0.55;
    }
    this._size[i] = this._baseSize[i];
    this._alpha[i] = this._baseAlpha[i];
  }

  burst(x, y, z, kind, count) {
    for (let n = 0; n < count; n++) this._spawn(x, y, z, kind);
    this.points.visible = true;
  }

  _updateParticles(dt) {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this._life[i] <= 0) continue;
      this._life[i] -= dt;
      const i3 = i * 3;
      if (this._life[i] <= 0) {
        this._alpha[i] = 0;
        continue;
      }
      any = true;
      const dragK = Math.max(0, 1 - this._drag[i] * dt);
      this._vel[i3] *= dragK;
      this._vel[i3 + 1] *= dragK;
      this._vel[i3 + 2] *= dragK;
      this._vel[i3 + 1] -= this._grav[i] * dt;
      this._pos[i3] += this._vel[i3] * dt;
      this._pos[i3 + 1] += this._vel[i3 + 1] * dt;
      this._pos[i3 + 2] += this._vel[i3 + 2] * dt;
      const lf = this._life[i] / this._maxLife[i];
      this._alpha[i] = this._baseAlpha[i] * lf;
      this._size[i] = Math.max(0.5, this._baseSize[i] + this._grow[i] * (1 - lf));
    }
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aColor.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
    this.points.visible = any || this.active;
  }

  // --------------------------------------------------------------------- UI

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #osf-crash-flash{position:fixed;inset:0;z-index:89;pointer-events:none;
        background:radial-gradient(ellipse at center,rgba(255,240,200,0.95) 0%,rgba(255,120,30,0.55) 45%,rgba(255,60,10,0) 75%);opacity:0;}
      #osf-crash-banner{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;
        pointer-events:auto;background:radial-gradient(ellipse at center,rgba(0,0,0,0.2) 0%,rgba(0,0,0,0.62) 100%);
        font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;-webkit-tap-highlight-color:transparent;}
      .osf-crash-card{background:rgba(8,10,14,0.94);border:2px solid #ff5a2a;border-radius:14px;
        padding:28px 36px;text-align:center;color:#fff;max-width:84vw;box-shadow:0 0 44px rgba(255,90,42,0.35);}
      .osf-crash-title{font-size:46px;font-weight:800;letter-spacing:5px;color:#ff5a2a;margin:0 0 2px;}
      .osf-crash-sub{font-size:14px;font-weight:700;letter-spacing:3px;color:#ffb08a;margin:0 0 14px;}
      .osf-crash-quip{font-size:18px;font-style:italic;color:#cfd6dd;margin:0 0 24px;line-height:1.4;}
      .osf-crash-btn{min-height:64px;min-width:230px;font-size:22px;font-weight:800;letter-spacing:1px;
        color:#14100a;background:#ffb02a;border:none;border-radius:12px;padding:0 38px;cursor:pointer;touch-action:manipulation;}
      .osf-crash-btn:active{transform:scale(0.96);background:#ff9d1a;}
    `;
    document.head.appendChild(style);
    this._styleEl = style;

    this._flash = document.createElement('div');
    this._flash.id = 'osf-crash-flash';
    this._flash.style.display = 'none';
    document.body.appendChild(this._flash);

    this._banner = document.createElement('div');
    this._banner.id = 'osf-crash-banner';
    this._banner.innerHTML =
      '<div class="osf-crash-card">' +
      '<p class="osf-crash-title">CRASHED!</p>' +
      '<p class="osf-crash-sub"></p>' +
      '<p class="osf-crash-quip"></p>' +
      '<button class="osf-crash-btn" type="button">FLY AGAIN</button>' +
      '</div>';
    document.body.appendChild(this._banner);
    this._subEl = this._banner.querySelector('.osf-crash-sub');
    this._quipEl = this._banner.querySelector('.osf-crash-quip');
    this._banner.querySelector('.osf-crash-btn').addEventListener('click', () => {
      if (this._respawnHandler) this._respawnHandler();
    });
  }

  setRespawnHandler(cb) {
    this._respawnHandler = cb;
  }

  showBanner() {
    const quips = this.type === 'splash' || this.type === 'bellyflop' || this.type === 'ditch' ? WATER_QUIPS : QUIPS;
    this._quipEl.textContent = quips[(Math.random() * quips.length) | 0];
    this._subEl.textContent = TYPE_LABELS[this.type] || '';
    this._banner.style.display = 'flex';
  }

  hideBanner() {
    this._banner.style.display = 'none';
  }

  // --------------------------------------------------------------- crashes

  /**
   * Begin a crash animation.
   * @param {string} type 'fireball' | 'skid' | 'cartwheel' | 'bump' | 'splash'
   * @param {object} fc the FlightController (tumbled directly)
   * @param {function} groundAt (x, z) => ground elevation in meters
   * @param {THREE.Vector3} impactVel aircraft velocity at impact (m/s)
   */
  startCrash(type, fc, groundAt, impactVel) {
    this.active = true;
    this.bannerShown = false;
    this.type = type;
    this.t = 0;
    this.groundAt = groundAt;
    this.shakeAmp = SHAKE_AMP[type] ?? 1.5;
    this.vel.copy(impactVel);
    this._worldSpin = false;

    const p = fc.position;
    if (type === 'fireball') {
      this.vel.multiplyScalar(0.25);
      this.spinAxis.set(1, 0, 0); // end-over-end, aircraft-local X
      this.spinRate = 7;
      this.burst(p.x, p.y, p.z, 'fire', 46);
      this.burst(p.x, p.y, p.z, 'smoke', 26);
      this.burst(p.x, p.y, p.z, 'spark', 30);
      this._flash.style.display = 'block';
      this._flash.style.opacity = '0.85';
      this._flashOn = true;
    } else if (type === 'skid') {
      this.vel.y = 0;
      this.spinAxis.set(0, 1, 0); // slow yaw spin, world Y
      this.spinRate = 1.1;
      this._worldSpin = true;
      this.burst(p.x, p.y, p.z, 'spark', 24);
      this.burst(p.x, p.y, p.z, 'dust', 18);
    } else if (type === 'cartwheel') {
      this.vel.multiplyScalar(0.6);
      this.spinAxis.set(0, 0, 1); // roll, aircraft-local Z
      this.spinRate = 5.5;
      this.burst(p.x, p.y, p.z, 'dust', 22);
      this.burst(p.x, p.y, p.z, 'smoke', 10);
    } else if (type === 'splash') {
      this.vel.multiplyScalar(0.2);
      this.vel.y = Math.min(this.vel.y, 0);
      this.spinAxis.set(1, 0, 0);
      this.spinRate = 0.25; // gentle nose-down settle into the water
      this.burst(p.x, p.y, p.z, 'splash', 60);
      this.burst(p.x, p.y, p.z, 'splash', 30);
    } else if (type === 'bellyflop') {
      // Fast flat water smack — huge spray, skip and tumble
      this.vel.multiplyScalar(0.5);
      this.vel.y = Math.abs(this.vel.y) * 0.3; // bounce up
      this.spinAxis.set(1, 0, 0);
      this.spinRate = 4;
      this.burst(p.x, p.y, p.z, 'splash', 80);
      this.burst(p.x, p.y, p.z, 'splash', 40);
      this.burst(p.x, p.y, p.z, 'smoke', 12);
    } else if (type === 'ditch') {
      // Gentle controlled water landing — soft splash, settle
      this.vel.multiplyScalar(0.1);
      this.vel.y = 0;
      this.spinRate = 0;
      this.burst(p.x, p.y, p.z, 'splash', 25);
    } else if (type === 'nosedive') {
      // Straight down — massive explosion
      this.vel.set(0, this.vel.y * 0.1, 0);
      this.spinRate = 0;
      this.burst(p.x, p.y, p.z, 'fire', 60);
      this.burst(p.x, p.y, p.z, 'smoke', 35);
      this.burst(p.x, p.y, p.z, 'spark', 40);
      this.burst(p.x, p.y, p.z, 'dust', 30);
      this._flash.style.display = 'block';
      this._flash.style.opacity = '1.0';
      this._flashOn = true;
    } else if (type === 'cliffstrike') {
      // Into a wall — explosion, debris falls
      this.vel.multiplyScalar(0.1);
      this.vel.y = -Math.abs(this.vel.y) * 0.5; // slide down
      this.spinAxis.set(1, 0, 0);
      this.spinRate = 3;
      this.burst(p.x, p.y, p.z, 'fire', 35);
      this.burst(p.x, p.y, p.z, 'smoke', 25);
      this.burst(p.x, p.y, p.z, 'dust', 35);
      this.burst(p.x, p.y, p.z, 'spark', 20);
    } else if (type === 'stalldrop') {
      // Fell out of sky — thud, minimal forward
      this.vel.multiplyScalar(0.05);
      this.spinAxis.set(0, 0, 1);
      this.spinRate = 2;
      this.burst(p.x, p.y, p.z, 'dust', 30);
      this.burst(p.x, p.y, p.z, 'smoke', 15);
    } else if (type === 'bounce') {
      // Skipped off surface — bounce and keep sliding
      this.vel.y = Math.abs(this.vel.y) * 0.6; // bounce up
      this.vel.multiplyScalar(0.7); // keep most forward speed
      this.spinAxis.set(1, 0, 0);
      this.spinRate = 2.5;
      this.burst(p.x, p.y, p.z, 'dust', 20);
      this.burst(p.x, p.y, p.z, 'spark', 15);
    } else {
      // 'bump'
      this.vel.multiplyScalar(0.15);
      this.vel.y = 0;
      this.spinRate = 0;
      this.burst(p.x, p.y, p.z, 'dust', 16);
    }
  }

  /**
   * Advance the crash animation. Tumbles the flight controller's position
   * and quaternion directly; the aircraft mesh and camera follow.
   */
  update(dt, fc, groundAt) {
    if (!this.active) {
      this._updateParticles(dt);
      return;
    }
    this.t += dt;
    const done = this.t >= CRASH_DURATION;
    const p = fc.position;
    const ground = (groundAt || this.groundAt)(p.x, p.z);

    this._tmpQ.setFromAxisAngle(this.spinAxis, this.spinRate * dt);
    if (this._worldSpin) fc.quaternion.premultiply(this._tmpQ);
    else fc.quaternion.multiply(this._tmpQ);

    if (this.type === 'fireball') {
      this.vel.y -= 420 * dt;
      this.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      p.addScaledVector(this.vel, dt);
      if (p.y < ground + 1) {
        p.y = ground + 1;
        this.vel.y *= -0.25;
        this.vel.x *= 0.6;
        this.vel.z *= 0.6;
      }
      if (!done) {
        this.burst(p.x, p.y, p.z, 'fire', 3);
        this.burst(p.x, p.y, p.z, 'smoke', 2);
        if (Math.random() < 0.5) this.burst(p.x, p.y, p.z, 'spark', 2);
      }
    } else if (this.type === 'skid') {
      this.vel.multiplyScalar(Math.max(0, 1 - 2.4 * dt));
      p.addScaledVector(this.vel, dt);
      p.y = ground + 2.5;
      if (!done) {
        this.burst(p.x, p.y, p.z, 'spark', 3);
        this.burst(p.x, p.y, p.z, 'dust', 2);
      }
    } else if (this.type === 'cartwheel') {
      this.vel.multiplyScalar(Math.max(0, 1 - 1.1 * dt));
      p.x += this.vel.x * dt;
      p.z += this.vel.z * dt;
      const hop = Math.abs(Math.sin(this.t * 5.2)) * 13 * Math.max(0, 1 - this.t / CRASH_DURATION);
      p.y = ground + 3 + hop;
      if (!done) {
        this.burst(p.x, p.y, p.z, 'dust', 2);
        if (Math.random() < 0.4) this.burst(p.x, p.y, p.z, 'smoke', 1);
      }
    } else if (this.type === 'splash') {
      this.vel.multiplyScalar(Math.max(0, 1 - 2.0 * dt));
      p.addScaledVector(this.vel, dt);
      // settle onto the water with a gentle bob
      const bob = Math.sin(this.t * 3.0) * 1.2 * Math.max(0, 1 - this.t / CRASH_DURATION);
      p.y += (ground + 1.5 + bob - p.y) * Math.min(1, 3 * dt);
      if (!done && this.t < 1.2) this.burst(p.x, p.y, p.z, 'splash', 4);
    } else {
      // 'bump'
      const k = Math.min(1, this.t / 0.9);
      p.y = ground + 2 + Math.sin(k * Math.PI) * 9;
      if (this.t < 0.5) {
        // nose tips down, comically
        this._tmpQ.setFromAxisAngle(this._axisX, -1.6 * dt);
        fc.quaternion.multiply(this._tmpQ);
        if (!done) this.burst(p.x, p.y, p.z, 'dust', 2);
      }
      p.x += this.vel.x * dt;
      p.z += this.vel.z * dt;
    }

    if (this._flashOn) {
      const o = parseFloat(this._flash.style.opacity || '0');
      const no = Math.max(0, o - dt * 2.2);
      this._flash.style.opacity = String(no);
      if (no <= 0) {
        this._flash.style.display = 'none';
        this._flashOn = false;
      }
    }

    this._updateParticles(dt);

    if (done && !this.bannerShown) {
      this.bannerShown = true;
      this.showBanner();
    }
  }

  /**
   * Decaying random camera offset. Safe to call after the camera phase:
   * both camera modes rebuild camera.position/quaternion every frame.
   */
  applyShake(camera) {
    if (!this.active) return;
    const k = Math.max(0, 1 - this.t / CRASH_DURATION);
    if (k <= 0) return;
    const a = this.shakeAmp * k;
    camera.position.x += (Math.random() * 2 - 1) * a;
    camera.position.y += (Math.random() * 2 - 1) * a * 0.6;
    camera.position.z += (Math.random() * 2 - 1) * a;
    camera.rotateZ((Math.random() * 2 - 1) * 0.02 * k);
    camera.rotateX((Math.random() * 2 - 1) * 0.012 * k);
  }

  /** Clear crash state (called on respawn). */
  reset() {
    this.active = false;
    this.t = 0;
    this.bannerShown = false;
    this.type = null;
    this.shakeAmp = 0;
    this._life.fill(0);
    this._alpha.fill(0);
    this.points.visible = false;
    this._flash.style.display = 'none';
    this._flash.style.opacity = '0';
    this._flashOn = false;
    this.hideBanner();
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    if (this._banner && this._banner.parentNode) this._banner.parentNode.removeChild(this._banner);
    if (this._flash && this._flash.parentNode) this._flash.parentNode.removeChild(this._flash);
    if (this._styleEl && this._styleEl.parentNode) this._styleEl.parentNode.removeChild(this._styleEl);
  }
}
