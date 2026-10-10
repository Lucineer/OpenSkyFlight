/**
 * BUSH PILOT — land on real ground, gently, near the middle.
 *
 * The sim already has a `cub` and a `beaver` described in their own words as
 * backcountry aircraft, and it has a DEM that knows where the mountains are.
 * So: find a flat spot on real terrain and put the wheels down on it.
 *
 * Scoring rewards what a bush pilot is actually judged on:
 *   - a gentle touchdown (low sink rate at contact)
 *   - staying on the surface (not tripping a wing)
 *   - landing near the middle of the clearing
 *   - not simply dropping out of the sky onto the first flat pixel
 */

import * as THREE from 'three';
import {
  bootWorld,
  tickTelemetry,
  centerMsg,
  hideMsg,
  setHud,
  scoreStore,
  waitForTerrain,
  wireChrome,
} from '../../../js/games/GameRuntime.js';
import { buildPlane } from '../../../js/aircraft/planes/PlaneFactory.js';
import { makeBeacon } from '../../../js/games/marks.js';
import { showPopup } from '../../../js/ui/ScorePopups.js';
import { soundFX } from '../../../js/audio/SoundFX.js';

const LAT = 57.0472;
const LON = -135.3619;

const LAND = {
  TOUCHDOWN_SINK: 3.5, // m/s — gentler than this is a good landing
  MAX_SINK: 9, //        m/s — harder than this wrecks the gear
  CLEARING_R: 140, //    m — how far from the aim point still counts as "on the strip"
  PERFECT_R: 25, //       m — bullseye
  MAX_TILT: 0.45, //     rad — bank/pitch past this on touchdown is a tip-over
  ARM_SINK: 0.9, //      m/s — below this at contact you're "floating", not landing
};

const $ = (id) => document.getElementById(id);

// Nominal height above the terrain at the start of the approach.
const APPROACH_HEIGHT = 110;

// Candidate search grid, shared by the primer and the search itself.
const SCOUT_ANGLES = [0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6];
const SCOUT_DISTANCES = [1200, 2400, 3600, 5200, 7000];

/**
 * Pre-fetch every DEM tile the clearing search will sample.
 *
 * getGroundElevation is synchronous and returns 0 for an unloaded tile, which
 * is indistinguishable from sea level. Sampling 45 candidate spots across
 * kilometres therefore returns "all water" unless the tiles are already in the
 * cache. This walks the same coordinates the search uses, awaits each tile via
 * the provider, and only then lets the search run.
 */
async function primeScoutTiles(terrain) {
  const provider = terrain.elevationProvider;
  if (!provider || typeof provider.fetchHeightmap !== 'function') return;
  const zoom = 12;
  const n = 1 << zoom;
  const seen = new Set();
  const jobs = [];
  // world2geo is the same world->lon/lat conversion getGroundElevation does.
  const probe = new THREE.Vector3();
  for (const startAngle of SCOUT_ANGLES) {
    for (const dist of SCOUT_DISTANCES) {
      const cx = Math.cos(startAngle) * dist;
      const cz = Math.sin(startAngle) * dist;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const [px, pz] of [
          [cx, cz],
          [cx + Math.cos(a) * 90, cz + Math.sin(a) * 90],
        ]) {
          let geo;
          try {
            geo = terrain.tileMap.world2geo(probe.set(px, 0, pz));
          } catch {
            continue;
          }
          if (!geo || isNaN(geo.x) || isNaN(geo.y)) continue;
          const lon = geo.x;
          const latRad = (geo.y * Math.PI) / 180;
          const tileX = Math.floor(((lon + 180) / 360) * n);
          const tileY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
          const key = `${zoom}/${tileX}/${tileY}`;
          if (seen.has(key)) continue;
          seen.add(key);
          jobs.push(provider.fetchHeightmap(tileX, tileY, zoom).catch(() => null));
        }
      }
    }
  }
  // Bounded concurrency: 45 spots x 17 samples is a lot of tiles.
  const CONC = 6;
  for (let i = 0; i < jobs.length; i += CONC) {
    await Promise.all(jobs.slice(i, i + CONC));
  }
}

async function main() {
  const { renderer, scene, camera, terrain, input, flight, telemetry } = await bootWorld({
    lat: LAT,
    lon: LON,
    altitude: 1500,
  });
  input.attachTouch($('stick-zone'), $('throttle-zone'));

  const { group: planeModel } = buildPlane('cub'); // the bush plane
  const planeGroup = new THREE.Group();
  planeGroup.add(planeModel);
  scene.add(planeGroup);

  const G = {
    score: 0,
    best: scoreStore.read('bush-pilot'),
    agl: 999,
    vspeed: 0,
    landed: false,
    paused: false,
    armed: false, // crossed the "now descend" line
    approach: null, // the clearing we picked
    result: null,
  };

  // --- Pick a landing site -------------------------------------------------
  // Search outward for a spot that is flat AND not water, using the same DEM
  // the renderer uses. 16 samples per ring: if the neighbours are within a few
  // metres of the centre, there is something to land on.
  function findClearing() {
    let best = null;
    for (const startAngle of SCOUT_ANGLES) {
      for (const dist of SCOUT_DISTANCES) {
        const cx = Math.cos(startAngle) * dist;
        const cz = Math.sin(startAngle) * dist;
        const centre = terrain.getGroundElevation(cx, cz);
        if (centre <= 2) continue; // water / no data
        let min = centre,
          max = centre;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const g = terrain.getGroundElevation(cx + Math.cos(a) * 90, cz + Math.sin(a) * 90);
          if (g < min) min = g;
          if (g > max) max = g;
        }
        const roughness = max - min;
        // 12m of relief across a 180m circle is a usable clearing.
        if (roughness > 12) continue;
        const score = -roughness * 2 - dist * 0.02; // flat first, near second
        if (!best || score > best.score) best = { x: cx, z: cz, y: centre, score, roughness };
      }
      if (best) break; // take the first good ring
    }
    return best;
  }

  // Scout only once the DEM is actually answering, or every sample returns 0
  // and findClearing concludes the entire world is water.
  setHud('boot-status', 'Finding the terrain…');
  await waitForTerrain(terrain);

  // The DEM is fetched per tile on demand and getGroundElevation returns 0 for
  // a tile that has not arrived yet. A synchronous scout therefore sees "all
  // water" everywhere and finds no clearing. Prime the tiles the search will
  // sample FIRST, then scout synchronously against real data.
  setHud('boot-status', 'Scouting a clearing…');
  await primeScoutTiles(terrain);
  G.approach = findClearing();

  // If nothing flat was found (small DEM coverage), fall back to open ground
  // under the aircraft rather than a bogus "clearing" at the origin.
  const fallback = terrain.getGroundElevation(0, 0) || 0;
  const aim = G.approach || { x: 0, z: 0, y: fallback, roughness: 0, fallback: true };

  // Approach: on final, a few hundred metres out from the clearing.
  //
  // Height must be measured against the terrain UNDER THE START POINT, not
  // against the clearing's height. Sitka is a mountain range: a start point
  // 900m from a flat clearing is very often over a ridge 200m higher, and
  // starting at clearing+260m there means starting underground.
  const back = 700;
  const startX = aim.x - back;
  const startGround = terrain.getGroundElevation(startX, aim.z);
  // A standard 3-degree-ish approach: ~5m of height per 100m of run-in.
  const heightAboveStart = Math.max(APPROACH_HEIGHT, 140);
  flight.position.set(startX, Math.max(startGround + heightAboveStart, aim.y + 90), aim.z);
  flight.yaw = Math.PI / 2;
  flight.pitch = 0;
  input.throttle = 0.4;

  const overlay = $('boot-overlay');
  if (overlay) overlay.classList.add('hidden');

  wireChrome({
    gameId: 'bush-pilot',
    best: G.best,
    onPause: () => (G.paused = true),
    onResume: () => {
      G.paused = false;
      hideMsg();
    },
  });
  setHud('hud-best', G.best === null || G.best === undefined ? 'BEST —' : `BEST ${G.best}`);
  setHud('hud-dist', aim.fallback ? 'OPEN TERRAIN' : `CLEARING ${Math.round(aim.roughness)}m relief`);

  // A marker ring at the clearing so the aim point is visible from the air.
  const ringGeo = new THREE.RingGeometry(LAND.PERFECT_R, LAND.CLEARING_R, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(aim.x, aim.y + 1.5, aim.z);
  scene.add(ring);

  // A vertical beacon pillar at the aim point — the flat ring is edge-on and
  // near-invisible at 700m on approach, so the pillar marks the spot from far.
  const beacon = makeBeacon({
    position: new THREE.Vector3(aim.x, aim.y, aim.z),
    height: 260,
    radius: 10,
    color: 0x00ff88,
  });
  scene.add(beacon);

  let last = performance.now();
  let prevY = flight.position.y;

  function frame(now) {
    requestAnimationFrame(frame);
    tickTelemetry(telemetry, now);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.paused || G.landed) return;

    // Throttle on keyboard/touch; the pilot manages descent with attitude.
    if (input.keys.KeyW) input.throttle = Math.min(1, input.throttle + dt * 0.5);
    if (input.keys.KeyS) input.throttle = Math.max(0, input.throttle - dt * 0.5);
    const ctl = input.sample();
    flight.update(dt, ctl, { allowBank: true });

    const ground = terrain.getGroundElevation(flight.position.x, flight.position.z);
    G.agl = flight.position.y - ground;
    G.vspeed = (flight.position.y - prevY) / Math.max(dt, 1e-3);
    prevY = flight.position.y;

    if (G.agl < 220) G.armed = true;

    // --- Touchdown test ----------------------------------------------------
    if (G.agl <= 0.5) {
      G.landed = true;
      const sink = Math.max(0, -G.vspeed);
      const offset = Math.hypot(flight.position.x - aim.x, flight.position.z - aim.z);
      const tilt = Math.abs(flight.roll) + Math.abs(flight.pitch);

      let points = 0;
      const notes = [];
      const pops = []; // scored events for staggered popups
      const scored = (label, pts) => {
        notes.push(label);
        if (pts > 0) pops.push({ label, pts });
      };
      if (sink <= LAND.TOUCHDOWN_SINK) {
        points += 40;
        scored('GREASED IT', 40);
      } else if (sink <= LAND.MAX_SINK) {
        const p = Math.round(40 * (1 - (sink - LAND.TOUCHDOWN_SINK) / (LAND.MAX_SINK - LAND.TOUCHDOWN_SINK)));
        points += p;
        scored('FIRM', p);
      } else {
        notes.push('GEAR DAMAGE');
      }
      if (offset <= LAND.PERFECT_R) {
        points += 40;
        scored('BULLSEYE', 40);
      } else if (offset <= LAND.CLEARING_R) {
        const p = Math.round(40 * (1 - (offset - LAND.PERFECT_R) / (LAND.CLEARING_R - LAND.PERFECT_R)));
        points += p;
        scored('ON STRIP', p);
      } else {
        notes.push('OFF STRIP');
      }
      if (tilt <= LAND.MAX_TILT) {
        points += 20;
        pops.push({ label: 'SMOOTH', pts: 20 });
      } else {
        notes.push('WING LOW');
      }
      if (sink >= LAND.ARM_SINK) {
        points += 20;
        scored('SETTLED', 20);
      } else {
        notes.push('FLOATED');
      }
      G.score = points;
      G.result = notes.join(' · ');
      soundFX.score(points / 120); // 120 = max possible: brighter for better landings
      const isBest = scoreStore.write('bush-pilot', points);
      centerMsg(`${points}\n${G.result}`, isBest && points >= 80 ? 'good' : 'danger');
      setHud('hud-best', `BEST ${isBest ? points : (G.best ?? '—')}`);
      setHud('hud-score', `SCORE ${points}`);
      // Staggered score-breakdown popups, 0.35s apart.
      pops.forEach((p, i) =>
        setTimeout(() => showPopup(`+${p.pts} ${p.label}`, '50%', `${30 + i * 7}%`, '#7cfc00'), 500 + i * 350),
      );
      // Show restart button
      const restartBtn = document.getElementById('btn-restart');
      if (restartBtn) {
        restartBtn.style.display = '';
        restartBtn.onclick = () => location.reload();
      }
      return;
    }

    // --- Present ------------------------------------------------------------
    planeGroup.position.copy(flight.position);
    planeGroup.quaternion.copy(flight.quaternion);
    planeGroup.traverse((c) => {
      c.frustumCulled = false;
    });

    // Camera: chase, but a little wider so the clearing is visible on approach.
    const backv = new THREE.Vector3(0, 0, 40).applyQuaternion(flight.quaternion);
    const want = flight.position.clone().add(backv);
    want.y += 12;
    camera.position.lerp(want, Math.min(1, dt * 5));
    camera.quaternion.slerp(flight.quaternion, Math.min(1, dt * 6));

    setHud('hud-score', `SCORE ${G.score}`);
    setHud('hud-agl', `AGL ${Math.round(G.agl)} m`);
    setHud('hud-vs', `VS ${G.vspeed >= 0 ? '+' : ''}${G.vspeed.toFixed(1)}`);
    setHud('hud-speed', `${Math.round(flight.speed * 1.94)} kt`);
    const bar = $('prox-bar');
    if (bar) {
      const s = Math.min(1, Math.max(0, -G.vspeed / 12));
      bar.style.height = `${s * 100}%`;
    }
    const ro = $('throttle-readout');
    if (ro) ro.textContent = `${Math.round(input.throttle * 100)}%`;
    const fill = $('throttle-fill');
    if (fill) fill.style.height = `${input.throttle * 100}%`;

    if (G.armed && G.agl < 60) centerMsg('FLARE', 'danger', 0);
    else hideMsg();

    terrain.update(camera.position);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error('Bush Pilot failed to start:', err);
  const el = $('boot-status');
  if (el) el.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
});
