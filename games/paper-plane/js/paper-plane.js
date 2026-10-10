// Paper Plane Post — deliver a handwritten letter before sunset.
//
// The fantasy, per MiniMax's tagline: "an enchanted paper plane that turns
// with the lightest tilt — slow, floaty, and never out of control."
// Launch from a rooftop, ride gusts and updrafts between buildings, and slip
// the letter through one candle-lit window where someone has been waiting.

import * as THREE from 'three';
import { runGame } from '../../../js/games/shell.js';
import { makeBeacon, disposeTree } from '../../../js/games/marks.js';
import { soundFX } from '../../../js/audio/SoundFX.js';
import { showPopup } from '../../../js/ui/ScorePopups.js';

const TIME_LIMIT = 150;
const DELIVERY_RADIUS = 14;

// City district: 8 buildings in a loose cluster, ~600 m across.
const BUILDINGS = [
  { x: -180, z: -80, w: 60, d: 60, h: 90 },
  { x: -60, z: -160, w: 70, d: 55, h: 120 },
  { x: 80, z: -120, w: 55, d: 65, h: 75 },
  { x: 190, z: -40, w: 65, d: 60, h: 140 },
  { x: -140, z: 90, w: 60, d: 70, h: 65 },
  { x: 0, z: 60, w: 75, d: 60, h: 105 },
  { x: 140, z: 130, w: 60, d: 55, h: 85 },
  { x: -40, z: 220, w: 70, d: 65, h: 110 }, // target building (candle window)
];
const TARGET = { bx: 7, floor: 5, col: 2 }; // building idx, window row/col
const LAUNCH = { x: -180, z: -80, h: 90 }; // rooftop of building 0

// Wind hazards/helpers (MiniMax's trio): a rooftop vortex, AC updrafts
// between buildings, and a gentle funnel toward the target window.
const VORTEX = { x: 60, z: -40, r: 130, strength: 9 };
const UPDRAFTS = [
  { x: -110, z: -120, r: 45, lift: 4.5 },
  { x: 135, z: 45, r: 50, lift: 5 },
  { x: 50, z: 175, r: 45, lift: 4 },
];

runGame({
  id: 'paper-plane',
  name: 'PAPER PLANE POST',
  accent: '#ffd9a0',
  tagline: 'Deliver the letter before sunset',
  hud: [
    { id: 'hud-dist', initial: '' },
    { id: 'hud-time', initial: '' },
  ],
  bar: { label: 'TO THE WINDOW' },
  camera: { distance: 16, height: 5 },
  crashTest: () => false, // paper planes don't crash — they crumple

  start(ctx) {
    const { scene, terrain, flight } = ctx;

    // Ground the city on the terrain first — everything is relative to base.
    const base = terrain.getGroundElevation(0, 0);
    ctx.cityBase = base;

    // Slow, floaty, never stalls — the enchanted paper plane.
    flight.minSpeed = 8;
    flight.maxSpeed = 20;
    flight.speed = 14;
    ctx.input.throttle = 0.55;
    flight.position.set(LAUNCH.x, base + LAUNCH.h + 26, LAUNCH.z);
    flight.yaw = Math.PI; // face into the district
    flight.pitch = 0;

    ctx.timeLeft = TIME_LIMIT;
    ctx.delivered = false;
    ctx.crumples = 0;
    ctx.crumpleCooldown = 0;
    ctx.windT = Math.random() * 100;
    ctx.targetPos = null;

    // --- Paper plane model: a classic dart from folded triangles.
    const plane = _buildPaperPlane();
    scene.add(plane);
    ctx.plane = plane;

    // --- City.
    ctx.buildings = [];
    BUILDINGS.forEach((b, i) => {
      const mesh = _buildBuilding(b, i === TARGET.bx, base);
      scene.add(mesh);
      ctx.buildings.push({ ...b, mesh });
    });

    // The candle-lit window: a warm glowing quad on the target facade.
    const tb = BUILDINGS[TARGET.bx];
    const winPos = _windowWorldPos(tb, TARGET.floor, TARGET.col, base);
    ctx.targetPos = winPos;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 9),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 }),
    );
    glow.position.copy(winPos).add(new THREE.Vector3(0, 0, 0.6));
    scene.add(glow);
    ctx.glow = glow;

    // A soft beacon pillar so the target reads from across the district.
    const beacon = makeBeacon({
      position: winPos.clone().add(new THREE.Vector3(0, 40, 0)),
      height: 120,
      radius: 5,
      color: 0xffb347,
    });
    scene.add(beacon);
    ctx.beacon = beacon;

    // Ground the city on the terrain.
    // (base was captured at the top of start())

    return () => {
      disposeTree(ctx.plane);
      ctx.buildings.forEach((b) => disposeTree(b.mesh));
      disposeTree(ctx.glow);
      disposeTree(ctx.beacon);
      ctx.buildings = [];
    };
  },

  update(dt, ctx) {
    const { flight, input, scene } = ctx;
    ctx.timeLeft -= dt;
    ctx.windT += dt;

    // --- Wind: base drift + gusts + vortex + updrafts.
    const wind = _windAt(flight.position, ctx.windT);
    flight.position.addScaledVector(wind, dt);

    const s = input.sample();
    flight.update(dt, s);
    ctx.plane.position.copy(flight.position);
    ctx.plane.quaternion.copy(flight.quaternion);
    // Gentle banking sway — paper catches the air.
    ctx.plane.rotateZ(Math.sin(ctx.windT * 2.1) * 0.06);

    // Candle flicker.
    if (ctx.glow) {
      ctx.glow.material.opacity = 0.8 + Math.sin(ctx.windT * 9) * 0.12 + Math.sin(ctx.windT * 23) * 0.05;
    }

    // --- Building collision: crumple, don't crash.
    if (ctx.crumpleCooldown > 0) {
      ctx.crumpleCooldown -= dt;
    } else {
      const hit = _hitBuilding(flight.position, ctx.buildings, ctx.cityBase);
      if (hit) {
        ctx.crumples++;
        ctx.crumpleCooldown = 1.2;
        flight.position.set(LAUNCH.x, (ctx.cityBase ?? 0) + LAUNCH.h + 26, LAUNCH.z);
        flight.yaw = Math.PI;
        flight.pitch = 0;
        flight.speed = 14;
        showPopup('CRUMPLED!', '50%', '40%', '#ff6b6b');
        soundFX.crash();
      }
    }

    // --- Delivery check.
    if (!ctx.delivered && ctx.targetPos) {
      const d = flight.position.distanceTo(ctx.targetPos);
      if (d < DELIVERY_RADIUS) {
        ctx.delivered = true;
        const bonus = Math.round(Math.max(0, ctx.timeLeft) * 10);
        showPopup('💌 DELIVERED!', '50%', '30%', '#ffd9a0');
        showPopup(`TIME BONUS +${bonus}`, '50%', '38%', '#7cfc00');
        soundFX.win();
      }
    }
  },

  render(ctx) {
    const bar = document.getElementById('prox-bar');
    const dEl = document.getElementById('hud-dist');
    const tEl = document.getElementById('hud-time');
    if (ctx.targetPos && !ctx.delivered) {
      const dist = ctx.targetPos.distanceTo(ctx.flight.position);
      if (bar) bar.style.width = `${Math.max(0, 100 - Math.min(100, (dist / 450) * 100))}%`;
      if (dEl) dEl.textContent = `✉️ ${Math.round(dist)} m`;
    } else if (bar) {
      bar.style.width = '100%';
    }
    if (tEl) {
      const t = Math.max(0, ctx.timeLeft);
      tEl.textContent = `🌇 ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      tEl.style.color = t < 30 ? '#ff6b6b' : '';
    }
  },

  scoring(ctx) {
    if (ctx.delivered) {
      const bonus = Math.round(Math.max(0, ctx.timeLeft) * 10);
      return {
        score: 1000 + bonus - ctx.crumples * 50,
        over: true,
        text: `LETTER DELIVERED — ${ctx.crumples} CRUMPLE${ctx.crumples === 1 ? '' : 'S'}`,
      };
    }
    return {
      score: 0,
      over: ctx.timeLeft <= 0,
      text: ctx.timeLeft <= 0 ? 'SUNSET — THE WINDOW WENT DARK' : '',
    };
  },
});

// --- Paper plane: a dart folded from 4 triangles, double-sided paper.
function _buildPaperPlane() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf5f2e8,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  // Center crease body (nose at -z).
  const body = new THREE.BufferGeometry();
  body.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0,
        0.15,
        -2.2, // nose
        -0.06,
        0.32,
        1.6, // tail top
        0.06,
        0.32,
        1.6,
      ],
      3,
    ),
  );
  body.computeVertexNormals();
  g.add(new THREE.Mesh(body, mat));
  // Left wing.
  const wl = new THREE.BufferGeometry();
  wl.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.15, -2.2, 0, 0.32, 1.6, -2.6, 0.55, 1.2], 3));
  wl.computeVertexNormals();
  g.add(new THREE.Mesh(wl, mat));
  // Right wing (mirror).
  const wr = new THREE.BufferGeometry();
  wr.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.15, -2.2, 2.6, 0.55, 1.2, 0, 0.32, 1.6], 3));
  wr.computeVertexNormals();
  g.add(new THREE.Mesh(wr, mat));
  // Letter tucked under the wing.
  const letter = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xfff8e1, side: THREE.DoubleSide }),
  );
  letter.position.set(0.35, 0.28, 0.4);
  letter.rotation.x = -0.2;
  g.add(letter);
  return g;
}

// --- Buildings: boxes with a procedural lit-window facade texture.
function _facadeTexture(litRatio, warm) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#232838';
  x.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 14;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const lit = Math.random() < litRatio;
      x.fillStyle = lit ? (warm && Math.random() < 0.3 ? '#ffca7a' : '#ffe9b8') : '#12151f';
      x.fillRect(8 + i * 20, 10 + j * 17.5, 12, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function _buildBuilding(b, isTarget, base) {
  const tex = _facadeTexture(0.35, isTarget);
  const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const top = new THREE.MeshStandardMaterial({ color: 0x2c3242, roughness: 1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [side, side, top, top, side, side]);
  mesh.position.set(b.x, (base ?? 0) + b.h / 2, b.z);
  return mesh;
}

// Window world position on the +z facade.
function _windowWorldPos(b, floor, col, base) {
  const cols = 6;
  return new THREE.Vector3(
    b.x - b.w / 2 + (col + 0.5) * (b.w / cols),
    (base ?? 0) + ((10 + floor * 17.5 + 5) / 256) * b.h,
    b.z + b.d / 2,
  );
}

// AABB test against building boxes (city sits on terrain base).
function _hitBuilding(p, buildings, base) {
  for (const b of buildings) {
    const by = base ?? 0;
    if (Math.abs(p.x - b.x) < b.w / 2 + 1 && Math.abs(p.z - b.z) < b.d / 2 + 1 && p.y > by && p.y < by + b.h) {
      return true;
    }
  }
  return false;
}

// Wind field: base drift + gusts + rooftop vortex + updraft funnels.
const _w = new THREE.Vector3();
function _windAt(p, t) {
  // Base breeze, slowly veering.
  const baseA = 0.6 + Math.sin(t * 0.05) * 0.5;
  _w.set(Math.cos(baseA) * 1.6, 0, Math.sin(baseA) * 1.6);
  // Gusts: rolling bursts up to ~4 m/s (MiniMax's 50%-of-cruise ratio).
  const gust = Math.max(0, Math.sin(t * 0.7) + Math.sin(t * 1.9 + 1.3) - 0.6) * 2.2;
  _w.x += Math.cos(baseA + 0.4) * gust;
  _w.z += Math.sin(baseA + 0.4) * gust;
  // Rooftop vortex: swirl that flips every ~2 s (MiniMax's hazard).
  const dx = p.x - VORTEX.x;
  const dz = p.z - VORTEX.z;
  const vd = Math.hypot(dx, dz);
  if (vd < VORTEX.r && vd > 4) {
    const flip = Math.sin(t * Math.PI) > 0 ? 1 : -1; // ~2 s period
    const swirl = VORTEX.strength * (1 - vd / VORTEX.r) * flip;
    _w.x += (-dz / vd) * swirl;
    _w.z += (dx / vd) * swirl;
  }
  // AC updrafts between buildings (MiniMax's helper).
  let lift = 0;
  for (const u of UPDRAFTS) {
    const ud = Math.hypot(p.x - u.x, p.z - u.z);
    if (ud < u.r) lift += u.lift * (1 - ud / u.r);
  }
  _w.y = lift;
  return _w;
}
