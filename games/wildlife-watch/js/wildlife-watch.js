// Wildlife Watch — find it, name it, nothing else.
//
// A spotting game, not a flying game. The aircraft is incidental; the loop is
// fly low, find a marker, tap it, and identify what you found. There is no
// timer and no fail, because the failure state in a spotting game is a player
// who concludes the game is not for them.
//
// The species are placed at real coordinates around the sound and are drawn
// from the birds and mammals that actually live there — this is not a
// wildlife-simulator claim, it is a spotting list.

import * as THREE from 'three';
import { runGame } from '../../../js/games/shell.js';
import { disposeTree } from '../../../js/games/marks.js';
import { buildPlane } from '../../../js/aircraft/planes/PlaneFactory.js';
import { showPopup } from '../../../js/ui/ScorePopups.js';
import { soundFX } from '../../../js/audio/SoundFX.js';

const SPECIES = [
  { name: 'Bald Eagle', x: 900, z: -1200 },
  { name: 'Tufted Puffin', x: -800, z: -2200 },
  { name: 'Black Bear', x: 2200, z: -1800 },
  { name: 'Sea Otter', x: 400, z: -600 },
  { name: 'Harbour Seal', x: -1500, z: 600 },
  { name: 'Red Squirrel', x: 1200, z: 900 },
  { name: 'Common Raven', x: -400, z: 200 },
  { name: 'Humpback Whale', x: 1800, z: -3000 },
];

runGame({
  id: 'wildlife-watch',
  name: 'WILDLIFE WATCH',
  accent: '#c58cff',
  tagline: 'Find and identify what lives here. No clock, no failing',
  bar: { label: 'LOGGED' },
  camera: { distance: 50, height: 18 },
  throttle: 0.38,
  crashTest: () => false, // you cannot fail at looking

  extra: `
    <div id="log-panel">
      <div class="log-title">FIELD LOG</div>
      <ul id="log-list"><li class="empty">Nothing identified yet</li></ul>
    </div>`,

  start(ctx) {
    const { scene, terrain, flight } = ctx;
    flight.position.set(0, 420, 900);
    flight.yaw = 0;
    flight.pitch = 0;
    flight.speed = 46;

    const { group } = buildPlane('extra');
    scene.add(group);
    ctx.plane = group;

    ctx.marks = [];
    SPECIES.forEach((s) => {
      const g = terrain.getGroundElevation(s.x, s.z);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(14, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xc58cff, transparent: true, opacity: 0.75 }),
      );
      m.position.set(s.x, g + 40, s.z);
      m.userData = { ...s, found: false };
      scene.add(m);
      ctx.marks.push(m);
    });
    ctx.found = 0;
    _log(ctx);
    ctx.msg = 'SPOT SOMETHING AND TAP IT';
    ctx.msgUntil = ctx.t + 3;

    // Tap a marker to log it. Pointer events, so it works on touch and mouse.
    ctx.onTap = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || el !== ctx.renderer.domElement) return;
      const pick = nearest(ctx, ev);
      if (pick) _identify(ctx, pick);
    };
    window.addEventListener('pointerdown', ctx.onTap);

    return () => {
      window.removeEventListener('pointerdown', ctx.onTap);
      ctx.marks.forEach(disposeTree);
      disposeTree(ctx.plane);
      ctx.marks = [];
    };
  },

  update(dt, ctx) {
    const { flight, input, terrain } = ctx;
    flight.update(dt, input.sample());
    ctx.plane.position.copy(flight.position);
    ctx.plane.quaternion.copy(flight.quaternion);
    const g = terrain.getGroundElevation(flight.position.x, flight.position.z);
    // Soft floor: you dip, you do not die.
    if (flight.position.y < g + 30) flight.position.y = g + 30;
    ctx.agl = flight.position.y - g;
  },

  render(ctx) {
    const bar = document.getElementById('prox-bar');
    const d = document.getElementById('hud-dist');
    if (bar) bar.style.width = `${(ctx.found / SPECIES.length) * 100}%`;
    if (d) d.textContent = `${ctx.found}/${SPECIES.length} identified`;
  },

  scoring(ctx) {
    return { score: ctx.found * 100, over: ctx.found >= SPECIES.length, text: `LOG COMPLETE — ${ctx.found} SPECIES` };
  },
});

/** Closest un-found marker within a generous tap radius, using actual tap raycast. */
function nearest(ctx, ev) {
  const cam = ctx.camera;
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  // Convert tap to normalized device coordinates
  const ndc = {
    x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  };
  // Raycast from camera through tap point
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, cam);
  // Check each unfound marker for intersection
  let best = null;
  let bestD = Infinity;
  for (const m of ctx.marks) {
    if (m.userData.found) continue;
    const d = m.position.distanceTo(cam.position);
    if (d > 2200) continue;
    // Raycast against the marker mesh
    const intersects = raycaster.intersectObject(m, true);
    if (intersects.length > 0) {
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
  }
  // Fallback: if no direct hit, check screen-space distance (generous tap radius)
  if (!best) {
    for (const m of ctx.marks) {
      if (m.userData.found) continue;
      const d = m.position.distanceTo(cam.position);
      if (d > 2200) continue;
      // Project marker to screen space
      const v = m.position.clone().project(cam);
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const tapX = ev.clientX - rect.left;
      const tapY = ev.clientY - rect.top;
      const screenDist = Math.hypot(sx - tapX, sy - tapY);
      // 100px tap radius (generous for touch)
      if (screenDist < 100 && d < bestD) {
        bestD = d;
        best = m;
      }
    }
  }
  return bestD < 1600 ? best : null;
}

function _identify(ctx, mesh) {
  mesh.userData.found = true;
  mesh.material.color.setHex(0x00ff88);
  ctx.found++;
  ctx.msg = mesh.userData.name.toUpperCase();
  ctx.msgUntil = ctx.t + 2.2;
  showPopup(`+100 · ${mesh.userData.name.toUpperCase()}`, '50%', '35%', '#7cfc00');
  soundFX.pickup();
  _log(ctx);
}

function _log(ctx) {
  const list = document.getElementById('log-list');
  if (!list) return;
  const seen = ctx.marks.filter((m) => m.userData.found);
  list.innerHTML = seen.length
    ? seen.map((m) => `<li>${m.userData.name}</li>`).join('')
    : '<li class="empty">Nothing identified yet</li>';
}
