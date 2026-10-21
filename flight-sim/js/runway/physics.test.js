// Tuning bounds for the PASI runway-performance tiers (REAL-SIM.md).
// Run: node physics.test.js  (from this directory)
import assert from 'node:assert';
import { AIRCRAFT, RUNWAY_M, simulateTakeoff, vSpeeds } from './physics.js';

const pct = (d) => ((d / RUNWAY_M) * 100).toFixed(1) + '%';

// C172 at max weight, dry: trivial — under 25% of the strip.
{
  const r = simulateTakeoff(AIRCRAFT.c172, { weightKg: AIRCRAFT.c172.mtowKg, wet: false });
  console.log(`c172 MTOW dry: liftoff ${r.liftoffDistM?.toFixed(0)} m (${pct(r.liftoffDistM ?? 0)}), overrun=${r.overrun}`);
  assert.ok(!r.overrun, 'c172 must not overrun');
  assert.ok(r.liftoffDistM < RUNWAY_M * 0.25, `c172 must use <25% (used ${pct(r.liftoffDistM)})`);
}

// 737-800 at typical weight, dry: comfortable — under 70%.
{
  const r = simulateTakeoff(AIRCRAFT.b737_800, { weightKg: AIRCRAFT.b737_800.mtowKg * 0.85, wet: false });
  console.log(`738 85% dry: liftoff ${r.liftoffDistM?.toFixed(0)} m (${pct(r.liftoffDistM ?? 0)}), overrun=${r.overrun}`);
  assert.ok(!r.overrun, '738 85% dry must not overrun');
  assert.ok(r.liftoffDistM < RUNWAY_M * 0.7, `738 85% dry must use <70% (used ${pct(r.liftoffDistM)})`);
}

// 737-800 heavy + wet: honest but safe — under 90%.
{
  const r = simulateTakeoff(AIRCRAFT.b737_800, { weightKg: AIRCRAFT.b737_800.mtowKg, wet: true });
  console.log(`738 MTOW wet: liftoff ${r.liftoffDistM?.toFixed(0)} m (${pct(r.liftoffDistM ?? 0)}), overrun=${r.overrun}`);
  assert.ok(!r.overrun, '738 MTOW wet must still make it');
  assert.ok(r.liftoffDistM < RUNWAY_M * 0.9, `738 MTOW wet must use <90% (used ${pct(r.liftoffDistM)})`);
}

// 737-900ER at max weight, wet: BARELY — at least 85% of the strip.
{
  const r = simulateTakeoff(AIRCRAFT.b737_900, { weightKg: AIRCRAFT.b737_900.mtowKg, wet: true });
  console.log(`739 MTOW wet: liftoff ${r.liftoffDistM?.toFixed(0)} m (${pct(r.liftoffDistM ?? 0)}), overrun=${r.overrun}`);
  assert.ok(r.liftoffDistM === null || r.liftoffDistM >= RUNWAY_M * 0.85,
    `739 MTOW wet must use >=85% (used ${pct(r.liftoffDistM ?? 0)}, overrun=${r.overrun})`);
}

// 737-900ER at typical weight, dry: still a jet, no drama — under 80%.
{
  const r = simulateTakeoff(AIRCRAFT.b737_900, { weightKg: AIRCRAFT.b737_900.mtowKg * 0.85, wet: false });
  console.log(`739 85% dry: liftoff ${r.liftoffDistM?.toFixed(0)} m (${pct(r.liftoffDistM ?? 0)}), overrun=${r.overrun}`);
  assert.ok(!r.overrun, '739 85% dry must not overrun');
  assert.ok(r.liftoffDistM < RUNWAY_M * 0.8, `739 85% dry must use <80% (used ${pct(r.liftoffDistM)})`);
}

// V-speed sanity: heavier = faster VR.
{
  const light = vSpeeds(AIRCRAFT.b737_800, AIRCRAFT.b737_800.mtowKg * 0.7, 3);
  const heavy = vSpeeds(AIRCRAFT.b737_800, AIRCRAFT.b737_800.mtowKg, 3);
  console.log(`738 VR light ${light.vr.toFixed(0)} kt vs heavy ${heavy.vr.toFixed(0)} kt`);
  assert.ok(heavy.vr > light.vr, 'VR must rise with weight');
}

console.log('ALL PHYSICS BOUNDS PASS');
