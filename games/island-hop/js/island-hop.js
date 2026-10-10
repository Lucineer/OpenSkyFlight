// Island Hop — a scenic tour with no way to fail.
//
// The deliberate counterweight to the rest of the catalogue. No clock, no
// crash punishment, no score to beat. You are guided from landmark to landmark
// around Sitka Sound and the only feedback is how far along the tour you are.
// It exists to answer a question the others cannot: can this be a game that is
// not a test of skill, and does the sim still work when nobody is chasing a
// number?

import * as THREE from 'three';
import { runGame } from '../../../js/games/shell.js';
import { makeBeacon, disposeTree } from '../../../js/games/marks.js';
import { buildPlane } from '../../../js/aircraft/planes/PlaneFactory.js';
import { showPopup } from '../../../js/ui/ScorePopups.js';
import { soundFX } from '../../../js/audio/SoundFX.js';

// Real places around Sitka Sound, in a rough loop.
const STOPS = [
  { name: 'Sitka Sound', x: 0, z: 0, y: 320 },
  { name: 'Kruzof Island', x: 1500, z: -1500, y: 380 },
  { name: 'Mount Edgecumbe', x: 2600, z: -3200, y: 520 },
  { name: 'Sitka Airport', x: 400, z: 1400, y: 300 },
  { name: 'Cape Edgecumbe', x: 3400, z: -4600, y: 420 },
  { name: 'Hoonah', x: -2000, z: -1800, y: 360 },
];

runGame({
  id: 'island-hop',
  name: 'ISLAND HOP',
  accent: '#5db8ff',
  tagline: 'A tour of Sitka Sound. No clock, no fail, just the view',
  bar: { label: 'TOUR' },
  // The shared crash rule would preempt this game's own end condition:
  // this is explicitly a no-fail game.
  crashTest: () => false,
  camera: { distance: 46, height: 16 },
  throttle: 0.42,

  start(ctx) {
    const { scene, terrain, flight } = ctx;
    const s0 = STOPS[0];
    const g0 = terrain.getGroundElevation(s0.x, s0.z);
    flight.position.set(s0.x, Math.max(s0.y, g0 + 180), s0.z + 420);
    flight.yaw = 0;
    flight.pitch = 0;
    flight.speed = 48;

    const { group } = buildPlane('extra');
    scene.add(group);
    ctx.plane = group;

    ctx.beacons = [];
    STOPS.forEach((s, i) => {
      const g = terrain.getGroundElevation(s.x, s.z);
      const b = makeBeacon({
        position: new THREE.Vector3(s.x, g + 20, s.z),
        height: 260,
        radius: 10,
        color: 0x5db8ff,
      });
      b.visible = i === 0;
      scene.add(b);
      ctx.beacons.push(b);
    });
    ctx.next = 0;

    return () => {
      ctx.beacons.forEach(disposeTree);
      disposeTree(ctx.plane);
      ctx.beacons = [];
    };
  },

  update(dt, ctx) {
    const { flight, input, terrain } = ctx;
    flight.update(dt, input.sample());
    ctx.plane.position.copy(flight.position);
    ctx.plane.quaternion.copy(flight.quaternion);

    const s = STOPS[ctx.next];
    const d = Math.hypot(flight.position.x - s.x, flight.position.z - s.z);
    ctx.range = d;
    if (d < 220) {
      ctx.beacons[ctx.next].visible = false;
      ctx.next++;
      showPopup('+100');
      soundFX.pickup();
      if (ctx.next >= STOPS.length) {
        ctx.finished = true;
        soundFX.win();
      } else {
        ctx.beacons[ctx.next].visible = true;
        ctx.msg = STOPS[ctx.next].name.toUpperCase();
        ctx.msgUntil = ctx.t + 2.2;
      }
    }

    // Keep it honest: you can crash, you just do not lose anything.
    const g = terrain.getGroundElevation(flight.position.x, flight.position.z);
    ctx.agl = flight.position.y - g;
  },

  render(ctx) {
    const bar = document.getElementById('prox-bar');
    const d = document.getElementById('hud-dist');
    if (bar) bar.style.width = `${(ctx.next / STOPS.length) * 100}%`;
    if (d) {
      d.textContent = ctx.finished ? 'tour complete' : `${STOPS[ctx.next].name} · ${Math.round(ctx.range ?? 0)} m`;
    }
  },

  scoring(ctx) {
    return { score: ctx.next * 100, over: !!ctx.finished };
  },
});
