// Sitka Real Sim — runway-start takeoff + landing game.
//
// Separate page from the Phase 1 checklist sim: nothing here touches
// index.html. State machine: spawn (hold/final) -> roll -> air -> roll
// (landing) -> landed | overrun (splash). Physics lives in physics.js;
// this file is input, cameras, HUD and scene glue.

import * as THREE from 'three';
import { AIRCRAFT, KT, RUNWAY_M, createState, remainingFt, step, vSpeeds } from './physics.js?v=2';
import { buildAircraft } from './aircraft.js?v=2';
import { RUNWAY_Y, buildPasi } from './scene.js?v=2';

const $ = (id) => document.getElementById(id);
const FINAL_DIST_M = 9000; // landing scenario: start of final, metres out

// ------------------------------------------------------------------
// Scene
// ------------------------------------------------------------------
const { scene, sock } = buildPasi();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
$('scene').appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 2, 90000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------
// Sim state + plane groups
// ------------------------------------------------------------------
let st = null; // physics state
let yawGroup = null; // outer: yaw
let attGroup = null; // inner: pitch/roll
let model = null; // aircraft mesh group
let camMode = 'chase'; // chase | tower | nose
let scenario = 'takeoff';
let airborneAt = 0;
let landedShown = false;
let splashShown = false;

function aircraftId() {
  return $('aircraft').value;
}
function weightKg() {
  const ac = AIRCRAFT[aircraftId()];
  const f = parseFloat($('weight').value); // 0..1 slider: empty -> MTOW
  return ac.emptyKg + (ac.mtowKg - ac.emptyKg) * f;
}
function windKt() {
  return parseFloat($('wind').value); // + headwind, - tailwind
}

function placePlane() {
  if (!model) return;
  const yawRad = ((290 - st.headingDeg) * Math.PI) / 180;
  const fwdX = -Math.cos(yawRad);
  const fwdZ = Math.sin(yawRad);
  let x;
  if (scenario === 'takeoff') x = RUNWAY_M / 2 - st.distM;
  else x = -RUNWAY_M / 2 - FINAL_DIST_M + st.distM;
  // Lateral drift from heading changes (no crosswind model in slice 1).
  yawGroup.position.set(x, RUNWAY_Y + st.altM, 0);
  // Recompute z from heading history: integrate lateral motion in the loop
  // via yawGroup.userData.z (kept across frames).
  yawGroup.position.z = yawGroup.userData.z || 0;
  yawGroup.rotation.y = yawRad;
  attGroup.rotation.z = (-st.pitchDeg * Math.PI) / 180;
  attGroup.rotation.x = (-st.rollDeg * Math.PI) / 180;
  if (model.userData.prop) model.userData.prop.rotation.z += 0.35 * st.spool;
  if (model.userData.gear) model.userData.gear.visible = st.gearDown;
  return { fwdX, fwdZ };
}

function spawn() {
  const ac = AIRCRAFT[aircraftId()];
  if (model) yawGroup.remove(attGroup);
  yawGroup = new THREE.Group();
  attGroup = new THREE.Group();
  model = buildAircraft(ac);
  attGroup.add(model);
  yawGroup.add(attGroup);
  yawGroup.userData.z = 0;
  scene.add(yawGroup);

  const flapIdx = ac.kind === 'jet' ? 3 : 1;
  if (scenario === 'takeoff') {
    st = createState(ac, {
      weightKg: weightKg(),
      flapIdx,
      headingDeg: 290,
      windKt: windKt(),
      wet: $('wet').checked,
    });
    st.mode = 'hold';
    st.brake = true;
    st.throttle = 0;
  } else {
    st = createState(ac, {
      weightKg: weightKg(),
      flapIdx: ac.detentMap.length - 1, // full flaps on final
      headingDeg: 110,
      windKt: -windKt(), // headwind slider is relative to runway 29; landing on 11 flips it
      wet: $('wet').checked,
      thresholdDistM: FINAL_DIST_M,
      runwayEndM: FINAL_DIST_M + RUNWAY_M,
    });
    st.mode = 'final';
    st.altM = 900;
    st.vMs = ac.kind === 'jet' ? 72 : 33;
    st.vsMs = -4;
    st.pitchDeg = -2;
    st.throttle = 0.55;
    st.brake = false;
    st.gearDown = true;
  }
  $('flap-btn').textContent = 'FLAPS ' + ac.detents[st.flapIdx];
  $('gear-btn').textContent = ac.gearFixed ? 'GEAR FIXED' : 'GEAR DOWN';
  $('brake-btn').textContent = st.brake ? 'BRAKE SET' : 'BRAKE OFF';
  $('spawn-btn').textContent = 'RESET ON RUNWAY';
  airborneAt = 0;
  landedShown = false;
  splashShown = false;
  $('splash').hidden = true;
  $('score').hidden = true;
  placePlane();
  setBanner(
    scenario === 'takeoff'
      ? 'HOLD SHORT — runway 29. Release the brake, throttle up, rotate at VR.'
      : 'FINAL — runway 11, 5.6 mi out. Hold Vref, flare late, stop on the strip.',
  );
  startSound();
}

// ------------------------------------------------------------------
// Controls: throttle lever, yoke pad, buttons, keys
// ------------------------------------------------------------------
let leverDrag = false;
function setThrottleFromLever(clientY) {
  const r = $('lever-track').getBoundingClientRect();
  const f = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  st.throttle = f;
  $('lever-thumb').style.bottom = `${f * 100}%`;
  $('thr-val').textContent = Math.round(f * 100) + '%';
}
$('lever-track').addEventListener('pointerdown', (e) => {
  if (!st) return;
  leverDrag = true;
  $('lever-track').setPointerCapture(e.pointerId);
  setThrottleFromLever(e.clientY);
});
$('lever-track').addEventListener('pointermove', (e) => {
  if (leverDrag && st) setThrottleFromLever(e.clientY);
});
$('lever-track').addEventListener('pointerup', () => (leverDrag = false));

let yokeDrag = false;
let yoke = { x: 0, y: 0 };
function setYoke(clientX, clientY) {
  const r = $('yoke').getBoundingClientRect();
  const dx = Math.max(-1, Math.min(1, ((clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.2));
  const dy = Math.max(-1, Math.min(1, ((clientY - (r.top + r.height / 2)) / (r.height / 2)) * 1.2));
  yoke = { x: dx, y: -dy }; // drag up = pull = positive elevator
  $('yoke-dot').style.left = `${50 + dx * 38}%`;
  $('yoke-dot').style.top = `${50 - yoke.y * 38}%`;
}
$('yoke').addEventListener('pointerdown', (e) => {
  if (!st) return;
  yokeDrag = true;
  $('yoke').setPointerCapture(e.pointerId);
  setYoke(e.clientX, e.clientY);
});
$('yoke').addEventListener('pointermove', (e) => {
  if (yokeDrag && st) setYoke(e.clientX, e.clientY);
});
$('yoke').addEventListener('pointerup', () => {
  yokeDrag = false;
  yoke = { x: 0, y: 0 };
  $('yoke-dot').style.left = '50%';
  $('yoke-dot').style.top = '50%';
});

function holdButton(el, on, off) {
  el.addEventListener('pointerdown', () => {
    if (st) on();
  });
  const end = () => {
    if (st) off();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
}
holdButton($('rudder-l'), () => (st.rudder = -1), () => (st.rudder = 0));
holdButton($('rudder-r'), () => (st.rudder = 1), () => (st.rudder = 0));
holdButton($('rev-btn'), () => (st.reverse = true), () => (st.reverse = false));

$('flap-btn').addEventListener('click', () => {
  if (!st) return;
  st.flapIdx = (st.flapIdx + 1) % st.ac.detentMap.length;
  st.speeds = vSpeeds(st.ac, st.weightKg, st.flapIdx);
  $('flap-btn').textContent = 'FLAPS ' + st.ac.detents[st.flapIdx];
});
$('gear-btn').addEventListener('click', () => {
  if (!st || st.ac.gearFixed) return;
  st.gearDown = !st.gearDown;
  $('gear-btn').textContent = st.gearDown ? 'GEAR DOWN' : 'GEAR UP';
});
$('brake-btn').addEventListener('click', () => {
  if (!st) return;
  st.brake = !st.brake;
  $('brake-btn').textContent = st.brake ? 'BRAKE SET' : 'BRAKE OFF';
});
$('spd-btn').addEventListener('click', () => {
  if (!st) return;
  st.speedbrake = !st.speedbrake;
  $('spd-btn').textContent = st.speedbrake ? 'SPDBRK OUT' : 'SPDBRK';
});
$('trim-up').addEventListener('click', () => {
  if (st) st.trimDeg = Math.min(6, st.trimDeg + 1);
});
$('trim-down').addEventListener('click', () => {
  if (st) st.trimDeg = Math.max(-6, st.trimDeg - 1);
});
$('cam-btn').addEventListener('click', () => {
  camMode = camMode === 'chase' ? 'tower' : camMode === 'tower' ? 'nose' : 'chase';
  $('cam-btn').textContent = 'CAM: ' + camMode.toUpperCase();
});
$('spawn-btn').addEventListener('click', spawn);
$('scenario').addEventListener('change', (e) => {
  scenario = e.target.value;
  spawn();
});
$('aircraft').addEventListener('change', () => {
  if (st) spawn();
});
$('sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound-btn').textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
  if (!soundOn) stopSound();
});

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (!st) return;
  if (e.key.toLowerCase() === 'f') $('flap-btn').click();
  if (e.key.toLowerCase() === 'g') $('gear-btn').click();
  if (e.key.toLowerCase() === 'p') $('brake-btn').click();
  if (e.key.toLowerCase() === 'b') $('spd-btn').click();
  if (e.key.toLowerCase() === 'c') $('cam-btn').click();
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

function applyKeys() {
  if (!st) return;
  // Releasing the brake on the runway starts the roll.
  if (st.mode === 'hold' && !st.brake) st.mode = 'roll';
  if (keys['w']) st.throttle = Math.min(1, st.throttle + 0.008);
  if (keys['s']) st.throttle = Math.max(0, st.throttle - 0.008);
  if (!yokeDrag) {
    let ey = 0;
    let ax = 0;
    if (keys['arrowup']) ey += 1;
    if (keys['arrowdown']) ey -= 1;
    if (keys['arrowleft']) ax -= 1;
    if (keys['arrowright']) ax += 1;
    if (keys['q']) st.rudder = -1;
    else if (keys['e']) st.rudder = 1;
    else if (!keys['q'] && !keys['e']) st.rudder = 0;
    st.elevator = yokeDrag ? yoke.y : ey;
    st.aileron = yokeDrag ? yoke.x : ax;
  } else {
    st.elevator = yoke.y;
    st.aileron = yoke.x;
  }
  if (keys['r']) st.reverse = true;
  else if (!document.querySelector('#rev-btn:active')) st.reverse = false;
  $('lever-thumb').style.bottom = `${st.throttle * 100}%`;
  $('thr-val').textContent = Math.round(st.throttle * 100) + '%';
}

// ------------------------------------------------------------------
// Engine hum (tiny WebAudio; starts on first user gesture)
// ------------------------------------------------------------------
let actx = null;
let osc = null;
let oscGain = null;
let soundOn = true;
function startSound() {
  if (!soundOn) return;
  try {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      osc = actx.createOscillator();
      osc.type = 'sawtooth';
      oscGain = actx.createGain();
      oscGain.gain.value = 0;
      osc.connect(oscGain).connect(actx.destination);
      osc.start();
    }
    if (actx.state === 'suspended') actx.resume();
  } catch {
    /* audio unavailable — fly silent */
  }
}
function stopSound() {
  try {
    if (oscGain) oscGain.gain.value = 0;
  } catch {
    /* ignore */
  }
}
function updateSound() {
  if (!actx || !oscGain || !soundOn) return;
  const target = st ? 0.02 + st.spool * 0.05 : 0;
  osc.frequency.value = 45 + (st ? st.spool * 55 : 0);
  oscGain.gain.setTargetAtTime(target, actx.currentTime, 0.2);
}

// ------------------------------------------------------------------
// HUD + banners
// ------------------------------------------------------------------
function setBanner(html) {
  $('banner').innerHTML = html;
}
function fmt(n, d = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}
function updateHud() {
  if (!st) return;
  const iasKt = st.vMs / KT + st.windKt;
  $('hud-ias').textContent = Math.round(iasKt) + ' kt';
  $('hud-alt').textContent = fmt(Math.round(st.altM * 3.28084)) + ' ft';
  $('hud-vsi').textContent = fmt(Math.round(st.vsMs * 196.85)) + ' fpm';
  $('hud-hdg').textContent = String(Math.round(st.headingDeg)).padStart(3, '0') + '°';
  $('hud-n1').textContent = Math.round(st.spool * 100) + '%';
  $('hud-flap').textContent = st.ac.detents[st.flapIdx];
  $('hud-gear').textContent = st.ac.gearFixed ? 'FIXED' : st.gearDown ? 'DOWN' : 'UP';
  $('hud-v1').textContent = Math.round(st.speeds.v1);
  $('hud-vr').textContent = Math.round(st.speeds.vr);
  $('hud-v2').textContent = Math.round(st.speeds.v2);
  const rem = remainingFt(st);
  const remEl = $('hud-rwy');
  remEl.textContent = fmt(Math.round(rem)) + ' ft';
  remEl.className = rem > 1500 ? 'ok' : rem > 500 ? 'warn' : 'bad';
  $('hud-weight').textContent = fmt(Math.round(st.weightKg)) + ' kg';
  $('hud-wind').textContent = (st.windKt >= 0 ? '+' : '') + Math.round(st.windKt) + ' kt' + (st.wet ? ' · WET' : '');
  if (st.stalled) setBanner('<span class="bad">STALL! Nose down, full power.</span>');
  else if (st.mode === 'hold') setBanner('HOLD SHORT — release the brake, throttle up.');
  else if (st.mode === 'roll' && scenario === 'takeoff') {
    const v = st.vMs / KT;
    if (v < st.speeds.v1) setBanner('ROLLING — hold centerline, watch VR.');
    else if (v < st.speeds.vr) setBanner('<span class="warn">V1 — committed. ROTATE at VR.</span>');
    else setBanner('<span class="go">ROTATE! Pull back gently.</span>');
  } else if (st.mode === 'air' && scenario === 'takeoff') {
    if (!airborneAt) {
      airborneAt = st.timeS;
      setBanner(
        `<span class="go">AIRBORNE — off in ${fmt(Math.round(st.liftoffDistM))} m ` +
          `(${(st.liftoffDistM / RUNWAY_M * 100).toFixed(0)}% of the strip). Gear up, flaps up when fast.</span>`,
      );
    }
  } else if (st.mode === 'final') {
    setBanner('FINAL — hold Vref, flare at ~50 ft, plant it in the zone.');
  } else if (st.mode === 'roll' && scenario === 'landing') {
    if (st.touchdown && !landedShown) {
      const td = st.touchdown;
      const good = td.distM >= 100 && td.distM <= 600 && td.sinkMs < 3.5;
      setBanner(
        `TOUCHDOWN — ${fmt(Math.round(td.distM))} m past the threshold, ` +
          `${td.sinkMs.toFixed(1)} m/s sink. ${good ? '<span class="go">In the zone.</span>' : '<span class="warn">Outside the zone.</span>'} Brakes + reverse!`,
      );
    }
    if (st.vMs < 1 && st.touchdown && !landedShown) {
      landedShown = true;
      $('score').hidden = false;
      $('score').innerHTML =
        `<b>LANDED.</b> Touchdown ${fmt(Math.round(st.touchdown.distM))} m past the threshold · ` +
        `sink ${st.touchdown.sinkMs.toFixed(1)} m/s · stopped with ${fmt(Math.round(remainingFt(st)))} ft to spare.`;
    }
  }
}

// ------------------------------------------------------------------
// Cameras
// ------------------------------------------------------------------
const camPos = new THREE.Vector3();
function updateCamera(fwdX, fwdZ) {
  const p = yawGroup.position;
  if (camMode === 'tower') {
    camPos.set(RUNWAY_M / 2 + 150, 45, 280);
    camera.position.lerp(camPos, 0.08);
    camera.lookAt(p.x, p.y + 3, p.z);
  } else if (camMode === 'nose') {
    camera.position.set(p.x + fwdX * (st.ac.lengthM / 2 - 2), p.y + 4.5, p.z + fwdZ * (st.ac.lengthM / 2 - 2));
    camera.lookAt(p.x + fwdX * 120, p.y + 2, p.z + fwdZ * 120);
  } else {
    const back = st.ac.lengthM * 1.6 + 18;
    camPos.set(p.x - fwdX * back, p.y + 10, p.z - fwdZ * back);
    camera.position.lerp(camPos, 0.14);
    camera.lookAt(p.x + fwdX * 16, p.y + 2, p.z + fwdZ * 16);
  }
}

// ------------------------------------------------------------------
// Main loop: fixed-step physics, per-frame render
// ------------------------------------------------------------------
let lastT = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dtFrame = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!st) {
    renderer.render(scene, camera);
    return;
  }
  applyKeys();
  // Brake button state: holding the yoke pad doesn't affect brakes.
  acc += dtFrame;
  const dt = 1 / 120;
  let n = 0;
  while (acc >= dt && n < 40) {
    step(st, dt);
    acc -= dt;
    n++;
  }
  // Lateral position from heading (slice 1 has no crosswind model).
  const yawRad = ((290 - st.headingDeg) * Math.PI) / 180;
  yawGroup.userData.z = (yawGroup.userData.z || 0) + Math.sin(yawRad) * st.vMs * dtFrame;
  const { fwdX, fwdZ } = placePlane();
  // Windsock aims into the wind (headwind component on 29).
  sock.rotation.y = st.windKt >= 0 ? 0 : Math.PI;
  sock.rotation.z = Math.PI / 2 - Math.min(0.5, Math.abs(st.windKt) * 0.03);
  updateCamera(fwdX, fwdZ);
  updateHud();
  updateSound();
  if (st.overrun && !splashShown) {
    splashShown = true;
    $('splash').hidden = false;
    $('splash-msg').textContent =
      scenario === 'takeoff'
        ? "Off the end — you're in Sitka Sound. Rotate earlier, or lighter, or drier."
        : "Off the far end — into the Sound. Touch down earlier, brake harder, reverse sooner.";
  }
  renderer.render(scene, camera);
}

// Boot: build the UI selects, spawn on the runway, run.
(function boot() {
  for (const [id, ac] of Object.entries(AIRCRAFT)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = ac.name; // AIRCRAFT values are objects, not labels
    $('aircraft').appendChild(o);
  }
  $('aircraft').value = 'b737_800'; // the main Sitka jet
  $('weight').value = 0.85;
  $('wind').value = 5;
  try {
    spawn();
  } catch (err) {
    // Never strand the player on "Loading…" — surface boot failures.
    setBanner('<span class="bad">Boot failed: ' + (err && err.message ? err.message : err) + '</span>');
    console.error('[real-sim] boot failed', err);
  }
  camera.position.set(RUNWAY_M / 2 + 120, 40, 200);
  camera.lookAt(RUNWAY_M / 2, RUNWAY_Y, 0);
  requestAnimationFrame(loop);
})();
