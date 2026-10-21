// Sitka Real Sim — flight physics core (no rendering dependency).
//
// Units: metres, kg, m/s internally; knots only for display (1 kt = 0.514444 m/s).
// Model: takeoff roll integrates thrust - drag - rolling resistance; after
// liftoff an energy model trades speed for altitude. Tuned so runway
// performance at PASI is the gameplay: see REAL-SIM.md tiers and the
// bounds asserted in physics.test.js.

export const KT = 0.514444;

// Runway 11/29 at PASI. See REAL-SIM.md: plan said 6,600 ft, recollection
// says 7,200 ft — one FAA confirmation still owed; single constant.
export const RUNWAY_M = 2195;
export const RUNWAY_FT = 7200;

const RHO = 1.225; // sea-level air density kg/m^3

// Flap detents: lift/drag increments (737-style; C172 maps onto 0/10/20/30
// via the same table index by its own detent list in AIRCRAFT).
const FLAP_TABLE = [
  { cl: 0.00, cd: 0.000 }, // 0
  { cl: 0.25, cd: 0.012 }, // 1
  { cl: 0.45, cd: 0.022 }, // 5
  { cl: 0.70, cd: 0.040 }, // 15
  { cl: 0.95, cd: 0.070 }, // 30
];

export const AIRCRAFT = {
  c172: {
    id: 'c172',
    name: 'Cessna 172 Skyhawk',
    kind: 'prop',
    emptyKg: 744,
    mtowKg: 1157,
    thrustN: 3400, // ~180 hp prop, static
    wingM2: 16.2,
    cd0: 0.032,
    kInduced: 0.055,
    lengthM: 8.2,
    spanM: 11.0,
    vrBaseKt: 55, // at mtow
    vsKt: 48,
    detents: ['0', '10', '20', '30'],
    // index into FLAP_TABLE: 0->0, 10->1, 20->2, 30->3
    detentMap: [0, 1, 2, 3],
    gearFixed: true,
    desc: 'Trainer. Trivial runway needs.',
  },
  b737_700: {
    id: 'b737_700',
    name: 'Boeing 737-700',
    kind: 'jet',
    emptyKg: 37648,
    mtowKg: 70080,
    thrustN: 2 * 121000,
    wingM2: 125,
    cd0: 0.020,
    kInduced: 0.045,
    lengthM: 33.6,
    spanM: 35.8,
    vrBaseKt: 132,
    vsKt: 118,
    detents: ['0', '1', '5', '15', '30'],
    detentMap: [0, 1, 2, 3, 4],
    gearFixed: false,
    desc: 'Alaska workhorse. Comfortable.',
  },
  b737_800: {
    id: 'b737_800',
    name: 'Boeing 737-800',
    kind: 'jet',
    emptyKg: 41413,
    mtowKg: 79015,
    thrustN: 2 * 121000,
    wingM2: 125,
    cd0: 0.020,
    kInduced: 0.045,
    lengthM: 39.5,
    spanM: 35.8,
    vrBaseKt: 141,
    vsKt: 126,
    detents: ['0', '1', '5', '15', '30'],
    detentMap: [0, 1, 2, 3, 4],
    gearFixed: false,
    desc: 'The main Sitka jet. Honest when heavy + wet.',
  },
  b737_900: {
    id: 'b737_900',
    name: 'Boeing 737-900ER',
    kind: 'jet',
    emptyKg: 44776,
    mtowKg: 85139,
    thrustN: 2 * 121000,
    wingM2: 125,
    cd0: 0.021,
    kInduced: 0.045,
    lengthM: 42.1,
    spanM: 35.8,
    vrBaseKt: 150,
    vsKt: 132,
    detents: ['0', '1', '5', '15', '30'],
    detentMap: [0, 1, 2, 3, 4],
    gearFixed: false,
    desc: 'The stretch. Barely, when heavy + wet.',
  },
};

// V-speeds scale with sqrt(weight) — heavier needs more speed to fly.
export function vSpeeds(ac, weightKg, flapIdx) {
  const f = Math.sqrt(weightKg / ac.mtowKg);
  const vr = ac.vrBaseKt * f;
  const flapBonus = flapIdx >= 3 ? 0.96 : flapIdx >= 2 ? 0.98 : 1.0;
  return {
    v1: vr * 0.94 * flapBonus,
    vr: vr * flapBonus,
    v2: vr * 1.06 * flapBonus,
    vs: ac.vsKt * f,
  };
}

function flapAero(ac, flapDetentIdx) {
  const t = FLAP_TABLE[ac.detentMap[Math.min(flapDetentIdx, ac.detentMap.length - 1)]];
  return t;
}

// One simulation state. `mode`: 'hold' | 'roll' | 'air' | 'overrun' | 'landed' | 'splash' | 'final' | 'crash' | 'missed'
export function createState(ac, opts = {}) {
  const weightKg = opts.weightKg ?? ac.mtowKg * 0.85;
  const flapIdx = opts.flapIdx ?? (ac.kind === 'jet' ? 3 : 1); // jets: flaps 15; 172: 10
  const speeds = vSpeeds(ac, weightKg, flapIdx);
  return {
    ac,
    weightKg,
    flapIdx,
    speeds,
    mode: 'hold',
    // ground state
    distM: 0, // distance from threshold along runway
    vMs: 0, // ground speed (roll) / airspeed (air) — same number here
    // air state
    altM: 0,
    vsMs: 0,
    pitchDeg: 0,
    rollDeg: 0,
    headingDeg: opts.headingDeg ?? 290, // runway 29 departure heading
    // controls
    throttle: 0, // 0..1
    spool: 0, // first-order spool lag 0..1
    gearDown: true,
    brake: true, // parking brake set on spawn
    speedbrake: false,
    reverse: false,
    rudder: 0, // -1..1
    elevator: 0, // -1..1 (pull = positive)
    aileron: 0, // -1..1
    trimDeg: 0,
    // environment
    windKt: opts.windKt ?? 0, // + = headwind component on runway heading
    wet: !!opts.wet,
    // runway geometry for this scenario: takeoff starts AT the threshold
    // (thresholdDistM 0, runwayEndM RUNWAY_M); landing starts 9 km out on
    // final (thresholdDistM 9000, runwayEndM 9000 + RUNWAY_M). distM is
    // distance travelled from scenario start along the track.
    thresholdDistM: opts.thresholdDistM ?? 0,
    runwayEndM: opts.runwayEndM ?? RUNWAY_M,
    // outcome
    airborne: false,
    liftoffDistM: null,
    stalled: false,
    overrun: false,
    splash: false,
    crash: false,
    missed: false,
    touchdown: null, // { distM, sinkMs, offsetM } on landing scenario
    timeS: 0,
  };
}

// Headwind helps: effective airspeed = ground speed + headwind component.
function airspeedMs(st) {
  return Math.max(0, st.vMs + st.windKt * KT);
}

function dragN(st, cl) {
  const v = airspeedMs(st);
  const q = 0.5 * RHO * v * v;
  let cd = st.ac.cd0 + st.ac.kInduced * cl * cl;
  if (st.gearDown && !st.ac.gearFixed) cd += 0.018;
  if (st.speedbrake) cd += 0.045;
  if (st.reverse) cd += 0.06;
  return q * st.ac.wingM2 * cd;
}

function liftN(st, cl) {
  const v = airspeedMs(st);
  const q = 0.5 * RHO * v * v;
  let l = q * st.ac.wingM2 * cl;
  if (st.altM < 15) l *= 1.15; // ground effect
  return l;
}

// Advance the sim by dt seconds. Returns nothing; mutates st.
export function step(st, dt) {
  const ac = st.ac;
  const W = st.weightKg * 9.81;
  const flap = flapAero(ac, st.flapIdx);
  st.timeS += dt;

  // Throttle spool-up lag (~2.5 s to full) — the roll starts soft.
  const spoolRate = 1 / 2.5;
  st.spool += (st.throttle - st.spool) * Math.min(1, spoolRate * dt * 3);
  st.spool = Math.max(0, Math.min(1, st.spool));

  if (st.mode === 'hold' || st.mode === 'roll') {
    if (st.mode === 'hold') return; // brakes set, nothing moves
    const v = airspeedMs(st);
    const thrust = ac.thrustN * st.spool * (1 - 0.20 * Math.min(1, v / 90));
    // On the ground, wing at low incidence until rotation.
    const clGround = 0.25 + flap.cl * 0.5;
    const L = liftN(st, clGround);
    const D = dragN(st, clGround);
    // Wet runway: standing-water drag is a real, large penalty — this is
    // what makes the heavy 900 marginal at PASI.
    const mu = st.wet ? 0.115 : 0.02;
    const rolling = Math.max(0, W - L) * mu;
    const braking = st.brake ? W * 0.35 : 0;
    const reverseThrust = st.reverse ? ac.thrustN * 0.3 : 0;
    const a = (thrust - D - rolling - braking - reverseThrust) / st.weightKg;
    st.vMs = Math.max(0, st.vMs + a * dt);
    st.distM += st.vMs * dt;

    // Rotation: pilot pulls (elevator) past VR, or holds it down.
    const vrMs = st.speeds.vr * KT;
    if (st.elevator > 0.25 && st.vMs >= vrMs * 0.97) {
      st.pitchDeg = Math.min(15, st.pitchDeg + 18 * dt * st.elevator);
    } else {
      st.pitchDeg = Math.max(0, st.pitchDeg - 30 * dt);
    }

    // Liftoff check: lift at rotation attitude must carry the weight.
    const clRot = 1.05 + flap.cl;
    if (st.pitchDeg > 4 && liftN(st, clRot) >= W) {
      st.mode = 'air';
      st.airborne = true;
      st.liftoffDistM = st.distM;
      st.altM = Math.max(st.altM, 0.5);
      st.vsMs = st.vMs * Math.sin((st.pitchDeg * Math.PI) / 180);
    }

    // Overrun: past the end still on the ground = into the Sound.
    if (st.distM >= st.runwayEndM && !st.airborne) {
      st.mode = 'overrun';
      st.overrun = true;
      st.splash = true;
    }
    return;
  }

  if (st.mode === 'air' || st.mode === 'final') {
    const v = airspeedMs(st);
    const thrust = ac.thrustN * st.spool * (1 - 0.20 * Math.min(1, v / 90));
    // Pitch attitude from elevator + trim, damped toward commanded.
    const targetPitch = st.elevator * 18 + st.trimDeg;
    st.pitchDeg += (targetPitch - st.pitchDeg) * Math.min(1, 2.2 * dt);
    const gamma = (st.pitchDeg * Math.PI) / 180;
    const cl = 0.9 + flap.cl * 0.6;
    const L = liftN(st, cl);
    const D = dragN(st, cl);
    const W2 = W;
    // Longitudinal: thrust - drag - gravity component along flight path.
    const aLong = (thrust - D) / st.weightKg - 9.81 * Math.sin(gamma);
    st.vMs = Math.max(0, st.vMs + aLong * dt);
    // Vertical: excess lift climbs, deficit sinks.
    const vsTarget = st.vMs * Math.sin(gamma) + ((L - W2) / st.weightKg) * 0.6;
    st.vsMs += (vsTarget - st.vsMs) * Math.min(1, 1.5 * dt);
    st.altM = Math.max(0, st.altM + st.vsMs * dt);
    // Track distance along the flight path (for runway-relative math).
    st.distM += st.vMs * Math.cos(gamma) * dt;
    // Roll/heading from aileron (gentle, arcade-stable). Positive aileron
    // = stick right = bank right = heading increases.
    st.rollDeg += ((st.aileron * 25 - st.rollDeg) * Math.min(1, 2.0 * dt));
    st.headingDeg = (st.headingDeg + st.rollDeg * 0.12 * dt * (st.vMs / 70) + 360) % 360;
    // Stall: below Vs the wing quits — buffet flag, nose drops, sink.
    const vsMs = st.speeds.vs * KT;
    st.stalled = v < vsMs * 0.98 && st.altM > 2;
    if (st.stalled) {
      st.pitchDeg = Math.max(-8, st.pitchDeg - 12 * dt);
      st.vsMs = Math.min(st.vsMs, -6);
    }
    // Touchdown (landing scenario / returning to ground).
    if (st.altM <= 0.5 && st.vsMs <= 0) {
      st.altM = 0;
      const relM = st.distM - st.thresholdDistM; // runway-relative: <0 = short, in water
      const sinkMs = -st.vsMs;
      const iasKt = st.vMs / KT + st.windKt;
      if (st.touchdown === null && st.distM > 0) {
        st.touchdown = { distM: relM, sinkMs, offsetM: 0 };
      }
      // L3 first: a violent impact is a crash on any surface — water at
      // 7 m/s sink and 100+ kt is concrete, not a ditching.
      if (sinkMs >= 6.0 || iasKt > 200) {
        st.mode = 'crash';
        st.crash = true;
      // L2: gentle short of the threshold = water, not a landing.
      } else if (relM < 0) {
        st.mode = 'splash';
        st.splash = true;
      } else {
        st.mode = 'roll';
        st.airborne = false;
      }
      st.vsMs = 0;
      st.pitchDeg = 0;
    }
    // L1: missed approach — flew past the far end still airborne (landing only).
    if (st.mode === 'final' && st.distM > st.runwayEndM) {
      st.mode = 'missed';
      st.missed = true;
    }
    return;
  }
  // 'overrun' / 'landed' / 'splash': frozen; UI handles reset.
}

// Simulate a full takeoff roll with a simple pilot policy: full throttle,
// brakes off at t=0, rotate at VR. Returns { liftoffDistM, overrun, timeS }.
export function simulateTakeoff(ac, opts = {}) {
  const st = createState(ac, opts);
  st.mode = 'roll';
  st.brake = false;
  st.throttle = 1;
  const dt = 1 / 120;
  let t = 0;
  while (t < 120) {
    if (st.vMs >= st.speeds.vr * KT) st.elevator = 1;
    step(st, dt);
    t += dt;
    if (st.airborne || st.overrun) break;
  }
  return {
    liftoffDistM: st.liftoffDistM,
    overrun: st.overrun,
    timeS: t,
    endSpeedKt: st.vMs / KT,
  };
}

// Runway remaining in feet from current position.
export function remainingFt(st) {
  return Math.max(0, (st.runwayEndM - st.distM) * 3.28084);
}

// Level-flight speed at given flaps: where lift equals weight. Used for
// landing spawns so a final starts at a flyable speed, not above it
// (which climbs away) or below it (which stalls on spawn).
export function levelSpeedMs(ac, weightKg, flapIdx) {
  const flap = flapAero(ac, flapIdx);
  const cl = 0.9 + flap.cl * 0.6;
  return Math.sqrt((2 * weightKg * 9.81) / (RHO * ac.wingM2 * cl));
}
