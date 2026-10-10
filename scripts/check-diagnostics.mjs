// Executable proof that the diagnostics actually detect what they claim.
//
// This exists because of a specific failure mode: a green CI badge over code
// nothing ever runs. The telemetry and watchdog modules are easy to write and
// impossible to trust unless something executes them and fails when they
// misbehave. Every assertion below is a claim we are willing to be wrong
// about in CI rather than in a bug report.
//
// Runs in plain Node with no dependencies. The modules touch a handful of
// browser globals, so those are installed before the dynamic import — which
// is also a check that the modules have no import-time side effects that
// would break in a different host.

import assert from 'node:assert/strict';

// --- Minimal browser surface, installed before import -----------------------
let fakeNow = 1000;
const listeners = new Map();

globalThis.window = {
  addEventListener: (k, f) => listeners.set(k, f),
  removeEventListener: (k) => listeners.delete(k),
  devicePixelRatio: 2,
  screen: { width: 1024, height: 768 },
  innerWidth: 1024,
  innerHeight: 768,
  __osfCapabilityTier: 'balanced',
  __osfCapabilityReasons: ['test fixture'],
};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// In Node 22 `navigator` and `performance` are getter-only accessors on
// globalThis — plain assignment throws. defineProperty is the only way to
// install a fixture here, and the fixture is installed BEFORE the modules are
// imported so it also proves they have no import-time browser dependency.
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node-diagnostics-fixture',
    platform: 'fixture',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => fakeNow },
  configurable: true,
});

const { Telemetry, LONG_FRAME_MS, formatReport } = await import('../js/diagnostics/Telemetry.js');
const { HealthWatchdog } = await import('../js/diagnostics/HealthWatchdog.js');

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ok  ${name}`);
};

// --- 1. Percentile maths is actually percentiles ---------------------------
{
  const t = new Telemetry();
  // The first tick has no predecessor, so it establishes the baseline and is
  // correctly not recorded as a frame. Prime it, then measure 100 frames.
  t.tick(fakeNow);
  // 100 frames: 99 fast (16ms) and one catastrophic (5000ms).
  for (let i = 0; i < 99; i++) {
    fakeNow += 16;
    t.tick(fakeNow);
  }
  fakeNow += 5000;
  t.tick(fakeNow);
  const s = t.stats();

  assert.equal(s.samples, 100, 'expected 100 samples');

  // The mean is honest and completely useless: 66ms looks like a 15fps app,
  // so nobody would ever investigate it, and the real story (one 5s stall
  // every 100 frames) is completely invisible.
  assert.ok(s.meanMs < 70, `mean should be ~66ms, got ${s.meanMs}`);

  // And p99 does NOT rescue us either. Nearest-rank p99 over 100 samples picks
  // index 98 of 0..99, which is still a 16ms frame — a single 1% outlier sits
  // exactly on the boundary and gets rounded away. This was a surprise during
  // development and it is the reason this module keeps the raw worst frames
  // and a separate max rather than trusting any single percentile.
  assert.equal(s.p99Ms, 16, `p99 lands on a 16ms frame at this ratio, got ${s.p99Ms}`);

  // The evidence survives only because max and the worst-frame list are
  // retained verbatim.
  assert.equal(s.maxMs, 5000, 'max frame must be retained exactly');
  assert.equal(s.longFrames, 1, 'the 5s frame must be flagged as a long frame');
  assert.equal(s.worstFrames[0].ms, 5000, 'worst frame must be the 5s one');
  assert.equal(s.worstFrames[0].label, 'frame');
  ok('raw worst-frames survive where mean and p99 both fail to show a 1% stall');
}

// --- 2. Long-frame events are recorded, not just counted -------------------
{
  const t = new Telemetry();
  t.tick(fakeNow); // baseline: no predecessor, so nothing to measure yet
  fakeNow += LONG_FRAME_MS + 500;
  t.tick(fakeNow); // the long frame
  t.tick(fakeNow + 1);
  const ev = t.events.find((e) => e.type === 'long-frame');
  assert.ok(ev, 'expected a long-frame event');
  assert.equal(ev.ms, LONG_FRAME_MS + 500);
  assert.ok(ev.at > 0, 'event must be timestamped');
  ok('long frames produce timestamped events for correlation with device loss');
}

// --- 3. A frame longer than 60s is a resume, not a measurement --------------
{
  const t = new Telemetry();
  t.tick(fakeNow); // baseline
  fakeNow += 16;
  t.tick(fakeNow); // one real, good frame
  assert.equal(t.stats().samples, 1, 'the good frame must be kept');

  fakeNow += 500000; // tab was in the background for ~8 minutes
  t.tick(fakeNow);
  assert.equal(t.stats().samples, 1, 'the background gap must be discarded, not recorded as a 500-second frame');
  assert.equal(t.stats().maxMs, 16, 'max must not be polluted by a resume');
  assert.equal(t.longFrames, 0, 'returning to the tab must not read as jank');
  ok('backgrounded-tab gaps are discarded rather than reported as jank');
}

// --- 4. The watchdog detects a stalled render loop --------------------------
{
  const t = new Telemetry();
  t.start();
  const w = new HealthWatchdog(t, { readState: () => null });

  t.tick(fakeNow);
  assert.equal(t.isStalled(), false, 'a fresh tick is not a stall');

  // Advance well past the stall threshold without ticking — this is exactly
  // what a dead rAF callback looks like to the rest of the page.
  fakeNow += 30000;
  assert.equal(t.isStalled(), true, 'a 30s silence must read as stalled');

  w.check();
  assert.equal(w.issues.length, 0, 'one poll is not enough — a stall must persist before we cry wolf');
  fakeNow += 5000;
  w.check();
  assert.ok(
    w.issues.some((i) => i.kind === 'stall'),
    'watchdog must report the stall',
  );
  assert.ok(
    t.events.some((e) => e.type === 'health:stall'),
    'stall must land in the shared event timeline',
  );

  // Recovery must clear the latch, or a session that stalls once would show a
  // permanent red "STALLED" badge for the rest of the flight.
  fakeNow += 16;
  t.tick(fakeNow);
  w.check();
  assert.equal(w.stallReported, false, 'a resumed render loop must clear the stall latch');
  assert.ok(t.events.some((e) => e.type === 'stall-recovered'));
  ok('stall is detected, confirmed, reported, and cleared on recovery');
}

// --- 5. The watchdog detects NaN flight state ------------------------------
{
  const t = new Telemetry();
  t.start();
  let state = { x: 1, y: 2, z: 3 };
  const w = new HealthWatchdog(t, { readState: () => state });

  w.check();
  assert.equal(w.issues.length, 0, 'healthy state must not report anything');

  state = { x: NaN, y: 2, z: 3 };
  w.check();
  const nan = w.issues.find((i) => i.kind === 'nan');
  assert.ok(nan, 'NaN must be detected');
  assert.deepEqual(nan.fields, ['x'], 'must name the offending field');
  assert.equal(w.status().nanReported, true, 'nanReported must be latched');

  // Latch behaviour: it must not spam one event per poll.
  const before = t.events.length;
  w.check();
  w.check();
  assert.equal(t.events.length, before, 'NaN must be reported once, not per poll');
  ok('NaN in flight state is detected, named, and reported exactly once');
}

// --- 6. A throwing state reader is not misreported as NaN ------------------
{
  const t = new Telemetry();
  t.start();
  const w = new HealthWatchdog(t, {
    readState: () => {
      throw new Error('reader exploded');
    },
  });
  w.check();
  assert.equal(w.issues.length, 0, 'a throwing reader must not masquerade as NaN');
  ok('a throwing state reader is not misreported as invalid flight state');
}

// --- 7. The report is serialisable and self-describing ---------------------
{
  const t = new Telemetry();
  t.attach({ isWebGPURenderer: true, info: { render: { drawCalls: 42, triangles: 9000 } } });
  t.start();
  t.tick(fakeNow); // baseline
  for (let i = 0; i < 30; i++) {
    fakeNow += 16;
    t.tick(fakeNow);
  }
  const r = t.report();
  const round = JSON.parse(JSON.stringify(r));
  assert.equal(round.backend, 'webgpu', 'backend must be detected from the renderer');
  assert.equal(round.tier, 'balanced', 'capability tier must be carried into the report');
  assert.equal(round.device.dpr, 2);
  assert.ok(typeof formatReport(r) === 'string' && formatReport(r).length > 20);
  assert.equal(round.perf.samples, 30);
  ok('report round-trips through JSON and carries tier, backend and device facts');
}

// --- 8. Memory is bounded over a long session ------------------------------
{
  const t = new Telemetry();
  t.start();
  for (let i = 0; i < 5000; i++) {
    fakeNow += 16;
    t.tick(fakeNow);
  }
  assert.ok(t.events.length <= 200, `event log must stay bounded, got ${t.events.length}`);
  assert.ok(t.worst.length <= 12 * 4, `worst-frame buffer must stay bounded, got ${t.worst.length}`);
  assert.ok(t.stats().samples <= 2400, 'frame window must stay bounded');
  ok('a 5000-frame session does not grow any buffer without bound');
}


// --- 9. The quality selector maps both ways and always yields a budget -----
// The games' graphics control reads these, and a typo here would render a menu
// that silently does nothing on a workstation — the one device that needs it.
{
  const { qualityToTier, tierToQuality, getBudget, TIER } = await import(
    '../js/rendering/CapabilityProbe.js'
  );
  for (const [q, tier] of [
    ['low', TIER.POTATO],
    ['medium', TIER.BALANCED],
    ['high', TIER.PERFORMANCE],
    ['potato', TIER.POTATO],
    ['performance', TIER.PERFORMANCE],
  ]) {
    assert.equal(qualityToTier(q), tier, `qualityToTier('${q}')`);
    assert.equal(tierToQuality(tier), q.replace('potato', 'low').replace('performance', 'high').replace('medium', 'medium').replace('balanced', 'medium'),
      `tierToQuality('${tier}')`);
  }
  assert.equal(qualityToTier('auto'), null, 'auto must defer to the probe');
  assert.equal(qualityToTier('nonsense'), null, 'an unknown value must not crash the probe');

  for (const tier of [TIER.POTATO, TIER.BALANCED, TIER.PERFORMANCE]) {
    const b = getBudget(tier);
    assert.ok(b && b.pixelRatio > 0, `budget for ${tier} must be usable`);
    assert.ok(b.maxTotalTiles > 0, `budget for ${tier} needs a tile budget`);
  }
  // A null tier means "auto" and must still give something renderable rather
  // than undefined, because the menu renders before the probe has answered.
  assert.ok(getBudget(null), 'getBudget(null) must fall back, not return undefined');

  // The performance tier must actually be the biggest budget, or the whole
  // point of forcing it on a workstation is lost.
  const lo = getBudget(TIER.POTATO);
  const hi = getBudget(TIER.PERFORMANCE);
  assert.ok(hi.maxTotalTiles > lo.maxTotalTiles, 'performance must allow more tiles');
  assert.ok(hi.lodThreshold > lo.lodThreshold, 'performance must allow more LOD');
  assert.ok(hi.maxTextureDimension > lo.maxTextureDimension, 'performance must allow bigger textures');
  ok('quality names, tiers and budgets are consistent in both directions');
}

console.log(`\ncheck-diagnostics: OK — ${passed} assertions on the diagnostics layer.`);
