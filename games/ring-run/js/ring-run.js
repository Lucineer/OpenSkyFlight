// Ring Run — thread a course of gates against the clock.
//
// Distinct from Ridge Runner (proximity to terrain) and Bush Pilot (terminal
// touchdown): this is pure waypoint navigation, where the challenge is line
// choice rather than clearance. You are always looking for the next gate, and
// the score is time, so the incentive is a tight line, not a safe one.

import * as THREE from 'three';
import { runGame } from '../../../js/games/shell.js';
import { makeGate, makeGateTest, disposeTree } from '../../../js/games/marks.js';
import { buildPlane } from '../../../js/aircraft/planes/PlaneFactory.js';
import { soundFX } from '../../../js/audio/SoundFX.js';
import { showPopup } from '../../../js/ui/ScorePopups.js';

const GATE_COUNT = 8;
const TIME_LIMIT = 105;

// A ring course laid out as a rough figure-of-eight over the sound, so the
// player has to turn rather than just hold one heading.
const COURSE = [
  { x: 0, z: -700, y: 150 },
  { x: 900, z: -1500, y: 210 },
  { x: 1900, z: -2100, y: 300 },
  { x: 1500, z: -3400, y: 260 },
  { x: 200, z: -3000, y: 180 },
  { x: -1100, z: -2300, y: 240 },
  { x: -1700, z: -1000, y: 200 },
  { x: -700, z: 200, y: 160 },
];

runGame({
  id: 'ring-run',
  name: 'RING RUN',
  accent: '#ff6bd6',
  tagline: 'Thread the course before the clock runs out',
  bar: { label: 'NEXT GATE' },
  camera: { distance: 40, height: 13 },
  crashTest: () => true,

  start(ctx) {
    const { scene, terrain, flight } = ctx;
    const start = COURSE[0];
    flight.position.set(start.x, start.y + 40, start.z + 260);
    flight.yaw = 0;
    flight.pitch = 0;
    flight.speed = 60;
    ctx.input.throttle = 0.6;

    const { group } = buildPlane('rafale');
    scene.add(group);
    ctx.plane = group;

    ctx.gates = [];
    ctx.tests = [];
    ctx.next = 0;
    ctx.timeLeft = TIME_LIMIT;
    ctx.started = false;
    ctx.clearedShown = false;

    COURSE.forEach((c, i) => {
      const ground = terrain.getGroundElevation(c.x, c.z);
      const y = Math.max(c.y, ground + 90);
      const g = makeGate({ position: new THREE.Vector3(c.x, y, c.z), radius: 30, color: 0xff6bd6 });
      scene.add(g);
      ctx.gates.push(g);
      ctx.tests.push(makeGateTest(g, { radius: 30 }));
    });
    _paint(ctx);

    return () => {
      ctx.gates.forEach(disposeTree);
      disposeTree(ctx.plane);
      ctx.gates = [];
    };
  },

  update(dt, ctx) {
    const { flight, input, terrain, camera } = ctx;
    const s = input.sample();
    flight.update(dt, s);
    ctx.plane.position.copy(flight.position);
    ctx.plane.quaternion.copy(flight.quaternion);
    // Keep the camera from sinking through the ground on a low pass.
    const g = terrain.getGroundElevation(camera.position.x, camera.position.z);
    if (camera.position.y < g + 4) camera.position.y = g + 4;

    if (!ctx.started) {
      ctx.started = true;
      ctx.msgUntil = ctx.t + 1.6;
    }
    ctx.timeLeft -= dt;

    while (ctx.next < ctx.tests.length && ctx.tests[ctx.next].test(flight.position)) {
      ctx.gates[ctx.next].material.color.setHex(0x00ff88);
      ctx.next++;
      _paint(ctx);
      showPopup('+100');
      soundFX.pickup();
    }
    if (ctx.next >= ctx.tests.length && !ctx.clearedShown) {
      ctx.clearedShown = true;
      showPopup(`TIME BONUS +${Math.round(Math.max(0, ctx.timeLeft) * 10)}`, '50%', '28%', '#7cfc00');
      soundFX.win();
    }
  },

  render(ctx) {
    const el = document.getElementById('prox-bar');
    const d = document.getElementById('hud-dist');
    if (ctx.next < ctx.tests.length) {
      const dist = ctx.tests[ctx.next].distance(ctx.flight.position);
      if (el) el.style.width = `${Math.max(0, 100 - Math.min(100, dist / 3))}%`;
      if (d)
        d.textContent = `${Math.round(dist)} m to gate ${ctx.next + 1} — ${Math.max(0, ctx.timeLeft).toFixed(1)}s left`;
    } else if (el) el.style.width = '100%';
  },

  scoring(ctx) {
    const cleared = ctx.next >= ctx.tests.length;
    return {
      score: Math.max(0, Math.round(ctx.timeLeft * 10 + ctx.next * 100)),
      over: cleared || ctx.timeLeft <= 0,
      text: cleared
        ? `COURSE CLEARED — ${ctx.timeLeft.toFixed(1)}s LEFT`
        : `OUT OF TIME — ${ctx.next}/${ctx.tests.length} GATES`,
    };
  },
});

/** Light up the gate you are heading for; dim the rest. */
function _paint(ctx) {
  ctx.gates.forEach((g, i) => {
    const active = i === ctx.next;
    g.material.opacity = active ? 1 : 0.3;
    g.material.color.setHex(active ? 0xff6bd6 : 0x8844aa);
  });
}
