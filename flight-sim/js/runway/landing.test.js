// Slice 1 landing outcomes (backlog L1/L2/L3). Run: node landing.test.js
// Spawn mirrors main.js exactly: 3° final, airspeed = level-flight speed
// at full flaps, throttle 0.18. Policies are scripted pilots.
import assert from 'node:assert';
import { AIRCRAFT, KT, RUNWAY_M, createState, levelSpeedMs, step } from './physics.js';

const FINAL = 9000;
const GLIDE = Math.tan((3 * Math.PI) / 180);
const dt = 1 / 120;

function spawnLanding(ac, weightFrac, windKt) {
  const weightKg = ac.emptyKg + (ac.mtowKg - ac.emptyKg) * weightFrac;
  const flapIdx = ac.detentMap.length - 1;
  const st = createState(ac, { weightKg, flapIdx, headingDeg: 110, windKt, wet: false, thresholdDistM: FINAL, runwayEndM: FINAL + RUNWAY_M });
  st.mode = 'final';
  st.altM = FINAL * GLIDE;
  st.vMs = Math.max(0, levelSpeedMs(ac, weightKg, flapIdx) - windKt * KT);
  st.vsMs = -st.vMs * GLIDE;
  st.pitchDeg = -3;
  st.throttle = 0.18;
  st.brake = false;
  st.gearDown = true;
  return st;
}

function run(st, policy, maxS = 400) {
  let t = 0;
  while (t < maxS) {
    policy(st, t);
    step(st, dt);
    t += dt;
    if (['roll', 'splash', 'crash', 'missed', 'overrun'].includes(st.mode)) break;
  }
  return t;
}

// Guided: -3° pitch, throttle PI to hold spawn airspeed, flare level +
// chop power under 15 m, brake + reverse after touchdown.
function guided(spawnIas) {
  return (st) => {
    if (st.mode === 'final') {
      const ias = st.vMs / KT + st.windKt;
      if (st.altM > 15) {
        st.elevator = -0.17;
        st.throttle = Math.max(0, Math.min(0.4, 0.18 + (spawnIas - ias) * 0.01));
      } else {
        st.elevator = 0;
        st.throttle = 0;
      }
    } else if (st.mode === 'roll') {
      st.brake = true;
      st.reverse = true;
      st.throttle = 0;
    }
  };
}

// L1: a guided approach lands on the runway and stops (all four aircraft).
for (const [name, ac, wind] of [['738', AIRCRAFT.b737_800, 0], ['738 tailwind', AIRCRAFT.b737_800, -5], ['739', AIRCRAFT.b737_900, 0], ['737', AIRCRAFT.b737_700, 0], ['c172', AIRCRAFT.c172, 0]]) {
  const st = spawnLanding(ac, 0.85, wind);
  const ias0 = st.vMs / KT + st.windKt;
  run(st, guided(ias0));
  console.log(`${name} guided: mode=${st.mode} td=${st.touchdown ? st.touchdown.distM.toFixed(0) + 'm sink=' + st.touchdown.sinkMs.toFixed(1) : 'none'}`);
  assert.strictEqual(st.mode, 'roll', `${name} guided approach must land (got ${st.mode})`);
  assert.ok(st.touchdown && st.touchdown.distM >= 0 && st.touchdown.distM < RUNWAY_M, `${name} must touch down on the runway`);
}

// L1: flying past the far end still airborne = missed approach.
{
  const st = spawnLanding(AIRCRAFT.b737_800, 0.85, 0);
  run(st, (s) => { if (s.mode === 'final') { s.elevator = 0.17; s.throttle = 0.5; } });
  console.log(`fly-past: mode=${st.mode}`);
  assert.strictEqual(st.mode, 'missed', 'fly-past must end missed');
}

// L2: gentle short landing = splash, not a landing.
{
  const st = spawnLanding(AIRCRAFT.b737_800, 0.85, 0);
  run(st, (s) => { if (s.mode === 'final') { s.elevator = -0.24; s.throttle = 0.12; } });
  console.log(`gentle short: mode=${st.mode} td=${st.touchdown ? st.touchdown.distM.toFixed(0) + 'm' : 'none'}`);
  assert.strictEqual(st.mode, 'splash', 'gentle short landing must splash');
  assert.ok(st.touchdown.distM < 0, 'short touchdown must be before the threshold');
}

// L3: stall dive into the ground = crash, not a silent roll.
{
  const st = createState(AIRCRAFT.b737_800, { weightKg: 73375, flapIdx: 4, headingDeg: 110, windKt: 0, wet: false, thresholdDistM: FINAL, runwayEndM: FINAL + RUNWAY_M });
  st.mode = 'final'; st.altM = 300; st.distM = 5000; st.vMs = 40; st.throttle = 0; st.elevator = 0; st.brake = false;
  run(st, () => {});
  console.log(`stall dive: mode=${st.mode} sink=${st.touchdown ? st.touchdown.sinkMs.toFixed(1) : 'none'}`);
  assert.strictEqual(st.mode, 'crash', 'stall dive must crash');
}

// L3: violent idle descent = crash (not a splash: 11 m/s sink is concrete).
{
  const st = spawnLanding(AIRCRAFT.b737_800, 0.85, 0);
  run(st, (s) => { if (s.mode === 'final') { s.elevator = -0.5; s.throttle = 0; } });
  console.log(`idle steep: mode=${st.mode}`);
  assert.strictEqual(st.mode, 'crash', 'violent idle descent must crash');
}

console.log('ALL LANDING OUTCOME TESTS PASS');
