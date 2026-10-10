import * as THREE from 'three';
import { CONFIG, onChange, update } from './utils/config.js';
import {
  CLOUD_RENDER_ORDER,
  REALWORLD_FAR_PLANE,
  CLIP_PLANE_EPSILON,
} from './constants/rendering.js';
import { REALWORLD_START_ALTITUDE, DEFAULT_NEAR, MAX_ROLL, ROLL_SENSITIVITY, ROLL_DAMP_SPEED } from './constants/camera.js';
import { MAX_DELTA_TIME } from './constants/physics.js';
import { createRenderer, createScene, createCamera, setupResizeHandler } from './scene/SceneSetup.js';
import AdaptiveQualityManager from './rendering/AdaptiveQualityManager.js';
import InputManager from './input/InputManager.js';
import TouchControls from './input/TouchControls.js';
import GeoTerrainManager from './terrain/GeoTerrainManager.js';
import FlightController from './camera/FlightController.js';
import CrashFX from './fx/CrashFX.js';
import ControlPanel from './ui/ControlPanel.js';
import HUD from './ui/HUD.js';
import Minimap from './ui/Minimap.js';
import Logger from './utils/Logger.js';
import { showNotification } from './ui/Notification.js';
import AtmosphericSky from './atmosphere/AtmosphericSky.js';
import { createSky } from './scene/SkyShader.js';
import { createCloudLayer as createPuffClouds } from './scene/CloudLayer.js';
import CloudLayer from './atmosphere/CloudLayer.js';
import BenchmarkRunner from './benchmark/BenchmarkRunner.js';
import BenchmarkComparator from './benchmark/BenchmarkComparator.js';
import GPUTimer from './benchmark/GPUTimer.js';
import AircraftManager from './aircraft/AircraftManager.js';
import ChaseCameraController from './camera/ChaseCameraController.js';
import LiveTraffic from './traffic/LiveTraffic.js';
import FlightPlanRecorder from './flightplan/FlightPlanRecorder.js';
import Stats from 'stats.js';
import { detectTileMode, getTileMode } from './geo/TileUrls.js';

async function initApp() {
  // Hangar is now an in-game menu, not a blocking splash.
  // The game loads directly with the saved/default plane.
  // (Hangar setup happens after aircraftManager is created, below.)

  // --- Core scene ---
  // Guard against a hung GPU backend: surface a visible error instead of
  // leaving the boot overlay on "Initializing…" forever.
  const renderer = await Promise.race([
    createRenderer(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Renderer init timed out after 30s — this browser did not provide a usable GPU context.')),
        30000,
      ),
    ),
  ]);
  const { scene, dirLight, ambientLight } = createScene();
  const camera = createCamera();

  // --- Atmosphere ---
  // Side-effect: registers itself with scene, dirLight, and ambientLight
  const useProceduralSky = new URLSearchParams(window.location.search).get('sky') === 'procedural';
  let skyController = null;
  if (useProceduralSky) {
    // Procedural sky with time-of-day (opt-in via ?sky=procedural)
    skyController = createSky({ dirLight, ambientLight, hour: 10 });
    scene.add(skyController);
  } else {
    new AtmosphericSky(scene, dirLight, ambientLight);
  }
  const cloudLayer = new CloudLayer(scene);
  cloudLayer.mesh.renderOrder = CLOUD_RENDER_ORDER;
  // Puff clouds: fly-through billboard layer (complements the flat TSL layer above)
  const puffClouds = createPuffClouds();
  scene.add(puffClouds);

  // --- Terrain ---
  // Resolve tile serving mode first: local caching proxy vs direct upstream
  // fetches (direct mode is what makes GitHub Pages / iPad work).
  await detectTileMode();
  Logger.info('App', `Tile mode: ${getTileMode()}`);
  const geoTerrainManager = new GeoTerrainManager(scene, renderer);
  // ?lat= & ?lon= let the location picker (or a shared link) drop the
  // player anywhere on Earth; falls back to CONFIG defaults.
  try {
    const params = new URLSearchParams(location.search);
    const plat = parseFloat(params.get('lat'));
    const plon = parseFloat(params.get('lon'));
    if (Number.isFinite(plat) && Number.isFinite(plon) &&
        Math.abs(plat) <= 90 && Math.abs(plon) <= 180) {
      CONFIG.lat = plat;
      CONFIG.lon = plon;
      Logger.info('App', `Start location from URL: ${plat}, ${plon}`);
    }
  } catch { /* non-browser context — keep CONFIG defaults */ }
  geoTerrainManager.init(CONFIG.lat, CONFIG.lon);

  // --- Controllers ---
  const flightController = new FlightController(camera, renderer.domElement);
  const chaseCameraController = new ChaseCameraController();

  // --- Crash system ---
  // Replaces the old 60m terrain floor: fly into the ground and the plane
  // crashes with a physics-flavored animation (fireball / skid / cartwheel /
  // bump) chosen from the impact parameters, instead of bouncing off thin air.
  // (Constants declared up here: crashGraceT below reads CRASH_GRACE_S at init.)
  const CRASH_LOOKAHEAD_M = 100; // sample ground this far ahead of the nose
  const CRASH_GROUND_PAD_M = 4; // impact when the aircraft gets this close to terrain
  const CRASH_GRACE_S = 3; // no crash checks right after load/respawn
  const _crashFwd = new THREE.Vector3();
  const _prevPos = new THREE.Vector3(); // last frame's aircraft position (impact-speed tracking)
  const _impactVel = new THREE.Vector3(); // aircraft velocity captured at impact
  const crashFX = new CrashFX(scene);
  let crashing = false;
  let crashGraceT = CRASH_GRACE_S; // countdown — no crash checks while > 0
  let _horizSpeed = 0; // m/s, horizontal speed at impact
  let _vertSpeed = 0; // m/s, vertical speed at impact (negative = descending)
  _prevPos.copy(flightController.position);

  // Pick the crash flavor from impact parameters:
  //  splash    — into water (both ground samples at/below sea level)
  //  cartwheel — wing strike first (|roll| > ~0.35 rad; bank maxes at 0.5)
  //  fireball  — steep nose-down dive (pitch < -0.5 rad) at high sink rate
  //  skid      — shallow angle but fast across the ground
  //  bump      — slow and gentle (the funny minor one)
  // Water check: sea level reads ~0m from the DEM, so sample-at/below-1m on
  // both the below and ahead samples = water, not terrain. Cheap and right
  // for oceans/seas; high alpine lakes read as land (accepted limitation).
  const WATER_LEVEL_M = 1.0;
  function classifyCrash(roll, gndBelow, gndAhead) {
    const rollAbs = Math.abs(roll || 0);
    const pitch = flightController.pitch; // rad; negative = nose-down
    const surfaceBelow = Math.max(gndBelow, WATER_LEVEL_M);
    const surfaceAhead = Math.max(gndAhead, WATER_LEVEL_M);
    const isWater = surfaceBelow <= WATER_LEVEL_M + 0.5 && surfaceAhead <= WATER_LEVEL_M + 0.5;
    // Water impacts
    if (isWater) {
      if (_horizSpeed > 200 && Math.abs(pitch) < 0.3) return 'bellyflop'; // fast flat smack
      if (_horizSpeed < 80 && _vertSpeed > -50) return 'ditch'; // gentle controlled landing
      return 'splash'; // classic nose-down splash
    }
    // Terrain impacts
    const terrainRise = surfaceAhead - surfaceBelow; // positive = cliff/wall ahead
    if (pitch < -1.0 && _vertSpeed < -200) return 'nosedive'; // straight down
    if (terrainRise > 80 && _horizSpeed > 150) return 'cliffstrike'; // flew into a wall
    if (rollAbs > 0.35) return 'cartwheel'; // wing strike
    if (_horizSpeed < 60 && _vertSpeed < -100) return 'stalldrop'; // fell out of the sky
    if (Math.abs(pitch) < 0.12 && _horizSpeed > 250) return 'bounce'; // skipped off the surface
    if (pitch < -0.5 && _vertSpeed < -150) return 'fireball'; // steep dive
    if (_horizSpeed > 300 && _vertSpeed > -150) return 'skid'; // fast shallow
    return 'bump'; // gentle
  }

  // FLY AGAIN: drop back in 1200m above the crash site, wings level, and
  // hand the controls back with a fresh grace period.
  crashFX.setRespawnHandler(() => {
    const cx = flightController.position.x;
    const cz = flightController.position.z;
    const gnd = geoTerrainManager.getGroundElevation(cx, cz);
    flightController.position.set(cx, gnd + 1200, cz);
    flightController.setOrientation(flightController.yaw, 0);
    flightController.yawRate = 0;
    flightController.pitchRate = 0;
    flightController.throttle = 0.1;
    flightController.touchMove.x = 0;
    flightController.touchMove.y = 0;
    flightController.enabled = true;
    crashing = false;
    crashGraceT = CRASH_GRACE_S;
    _prevPos.copy(flightController.position);
    _horizSpeed = 0;
    _vertSpeed = 0;
    chaseCameraController.reset();
    crashFX.reset();
  });

  // Hidden debug hook (?debug=1) for automated playtesting only.
  // Exposes internals on window.__osf and forces the touch UI on desktop
  // so the LOC button / throttle / stick can be exercised without a touchscreen.
  // NOTE: sampleTerrainElevation does not exist in this codebase — the
  // verified ground-elevation helper is geoTerrainManager.getGroundElevation.

  // --- Takeoff intro (Sitka) ---
  // When starting at the default location (Sitka Airport, no ?lat/?lon override),
  // open with a takeoff roll: spawn low near the airport facing west over the
  // water, throttle up, rotate, and climb. Any stick/throttle input skips it.
  const SITKA_LAT = 57.0472, SITKA_LON = -135.3619;
  const isDefaultStart = Math.abs(CONFIG.lat - SITKA_LAT) < 1e-9 &&
                         Math.abs(CONFIG.lon - SITKA_LON) < 1e-9;
  let takeoffT = -1; // -1 = no intro; -2 = armed, waiting for tiles; >=0 = wall-clock start timestamp (ms)
  let _introLastThrottle = 0;
  if (isDefaultStart) {
    // Spawn at terrain center; after tiles load (boot dismissal), we'll nudge
    // to nearby land if we're over water.
    const gnd0 = geoTerrainManager.getGroundElevation(0, 0);
    flightController.position.set(0, gnd0 + 25, 0);
    flightController.setOrientation(Math.PI / 2, 0); // yaw 90° = west, over water
    flightController.throttle = 0;
    flightController.yawRate = 0;
    flightController.pitchRate = 0;
    flightController.touchMove.x = 0;
    flightController.touchMove.y = 0;
    _prevPos.copy(flightController.position);
    takeoffT = -2; // armed — starts when the boot overlay dismisses (Sitka ready)
    crashGraceT = 25; // no crash checks during load + 22s intro + small margin
    Logger.info('App', 'Takeoff intro armed: departing Sitka Airport');
  }
  const dbgParams = (() => {
    try { return new URLSearchParams(location.search); }
    catch { return new URLSearchParams(); }
  })();
  if (dbgParams.has('debug')) {
    window.__osf = {
      flightController,
      CONFIG,
      geoTerrainManager,
      groundAt: (x, z) => geoTerrainManager.getGroundElevation(x, z),
    };
    Logger.info('App', 'Debug mode: __osf handle exposed');
  }
  const _qRoll = new THREE.Quaternion();
  const _axisZ = new THREE.Vector3(0, 0, 1);
  const _autopilotEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _autopilotQuat = new THREE.Quaternion();
  const aircraftManager = new AircraftManager(scene);
  // Aircraft selection via splash screen hangar. The game world (terrain, etc.)
  // Aircraft: load from ?plane= URL param, default Rafale. (B-17: ?plane=b17)
  // Fleet plugin coming later as a proper in-game menu — not woven into boot.
  let selectedPlaneDef = null;
  let _planeType = 'rafale';
  try {
    const _pp = new URLSearchParams(location.search).get('plane');
    if (_pp && /^[a-z0-9]+$/.test(_pp)) _planeType = _pp;
  } catch { /* non-browser */ }
  try {
    selectedPlaneDef = await aircraftManager.loadPlane(_planeType);
    CONFIG.cameraSpeed = Math.round(2400 * (selectedPlaneDef.speed || 1));
    flightController.agility = selectedPlaneDef.agility || 1;
    Logger.info('App', `Flying ${selectedPlaneDef.name}`);
    // Show BOMB button for bomber aircraft (touch controls)
    const bombBtn = document.getElementById('tc-bomb');
    if (bombBtn) {
      bombBtn.style.display = selectedPlaneDef.bomber ? '' : 'none';
    }
  } catch (err) {
    Logger.warn('App', 'Failed to load plane: ' + err.message);
  }

  // --- Systems ---
  const benchmarkRunner = new BenchmarkRunner();
  const gpuTimer = new GPUTimer(renderer);
  const flightPlanRecorder = new FlightPlanRecorder();
  const adaptiveQuality = new AdaptiveQualityManager(renderer);

  // --- Ground elevation ---
  let groundElevation = 0;

  // --- Stats.js ---
  const stats = new Stats();
  const gpuPanel = new Stats.Panel('GPU', '#ff9933', '#331100');
  stats.addPanel(gpuPanel);
  stats.showPanel(0);
  stats.dom.style.position = 'fixed';
  stats.dom.style.top = '0px';
  stats.dom.style.left = '0px';
  stats.dom.style.zIndex = '30';
  stats.dom.style.display = 'none';
  document.body.appendChild(stats.dom);

  // --- UI ---
  const hud = new HUD(document.getElementById('hud'));
  const minimap = new Minimap(document.getElementById('minimap'), geoTerrainManager);
  minimap.setFlightPlanRecorder(flightPlanRecorder);
  const hudCanvas = document.getElementById('hud');

  // --- Control Panel ---
  function regenerate() {
    geoTerrainManager.reinit();
    flightController.position.set(0, REALWORLD_START_ALTITUDE, 0);
  }
  // Side-effect: binds DOM controls to CONFIG
  new ControlPanel(regenerate);

  // --- Live Traffic (real ADS-B aircraft) ---
  // ?traffic=mock for testing without the Worker proxy
  const _trafficMock = (() => {
    try { return new URLSearchParams(location.search).get('traffic') === 'mock'; }
    catch { return false; }
  })();
  const liveTraffic = new LiveTraffic(scene, geoTerrainManager, {
    useMock: _trafficMock,
    workerUrl: 'https://traffic.lucineer.com/api/traffic',
  });
  liveTraffic.setCamera(camera);
  liveTraffic.start();
  Logger.info('App', `Live traffic ${liveTraffic.enabled ? 'enabled' : 'disabled'}${_trafficMock ? ' (mock mode)' : ''}`);

  // Floating toggle button for live traffic (44px touch target)
  const _trafficBtn = document.createElement('button');
  _trafficBtn.id = 'traffic-toggle';
  _trafficBtn.textContent = '✈️ Traffic: ON';
  _trafficBtn.style.cssText = 'position:fixed;bottom:80px;right:12px;z-index:50;min-width:44px;min-height:44px;padding:10px 14px;border-radius:12px;border:1px solid rgba(125,249,255,0.4);background:rgba(0,20,40,0.75);color:#7df9ff;font-size:14px;font-weight:bold;cursor:pointer;backdrop-filter:blur(4px);';
  _trafficBtn.addEventListener('click', () => {
    const on = !liveTraffic.enabled;
    liveTraffic.setEnabled(on);
    _trafficBtn.textContent = on ? '✈️ Traffic: ON' : '✈️ Traffic: OFF';
    Logger.info('App', `Live traffic ${on ? 'enabled' : 'disabled'} by user`);
  });
  document.body.appendChild(_trafficBtn);

  // --- Logger panel ---
  Logger.bindPanel(document.getElementById('log-panel'));
  document.getElementById('log-panel-clear').addEventListener('click', () => Logger.clear());
  Logger.info('App', 'Application started');

  // --- Resize ---
  setupResizeHandler(camera, renderer, hud);

  // --- Config listeners ---
  onChange((key, value) => {
    if (key === 'showHud') hudCanvas.style.display = value ? 'block' : 'none';
  });

  // --- Input bindings ---
  const input = new InputManager();

  input.onKey('x', () => {
    const active = geoTerrainManager.toggleDebug();
    Logger.info('App', `Debug tiles ${active ? 'enabled' : 'disabled'}`);
  });

  input.onKey('h', () => {
    update('showHud', !CONFIG.showHud);
  });

  input.onKey('m', () => {
    update('showMinimap', !CONFIG.showMinimap);
  });

  const hiresBadge = document.getElementById('hires-badge');
  input.onKey('r', () => {
    const active = geoTerrainManager.toggleHiRes();
    hiresBadge.style.display = active ? 'block' : 'none';
    Logger.info('App', `Hi-res mode (zoom 18) ${active ? 'enabled' : 'disabled'}`);
  });

  input.onKey('t', () => {
    const modes = ['satellite', 'osm', 'sar', 'elevation'];
    const idx = modes.indexOf(CONFIG.textureMode);
    update('textureMode', modes[(idx + 1) % modes.length]);
    showNotification(`Texture: ${CONFIG.textureMode}`);
  });

  input.onKey('v', () => {
    const next = CONFIG.cameraMode === 'chase' ? 'cockpit' : 'chase';
    update('cameraMode', next);
    chaseCameraController.reset();
    Logger.info('App', `Camera mode: ${next}`);
  });

  input.onKey('i', () => {
    const active = hud.toggleStats();
    document.getElementById('help').style.display = active ? 'block' : 'none';
    stats.dom.style.display = active ? 'block' : 'none';
    Logger.info('App', `Info ${active ? 'enabled' : 'disabled'}`);
  });

  input.onKey('l', async () => {
    if (hud.isFlightPlanMenuOpen()) {
      hud.closeFlightPlanMenu();
    } else {
      try {
        const r = await fetch('/api/flightplans');
        const files = await r.json();
        hud.openFlightPlanMenu(files);
      } catch {
        Logger.warn('App', 'No flight plans available');
      }
    }
  });

  input.onPrefix('Digit', async (e) => {
    if (!hud.isFlightPlanMenuOpen()) return;
    const idx = parseInt(e.code.charAt(5)) - 1;
    const file = hud.selectFlightPlan(idx);
    if (file) {
      try {
        const r = await fetch(`/assets/flightplans/${file}`);
        const data = await r.json();
        flightPlanRecorder.loadFromJSON(data);
        hud.closeFlightPlanMenu();
      } catch {
        Logger.warn('App', `Failed to load ${file}`);
      }
    }
  });

  input.on('Escape', () => {
    if (hud.isFlightPlanMenuOpen()) hud.closeFlightPlanMenu();
  });

  input.onKey('n', (e) => {
    if (e.shiftKey) {
      flightPlanRecorder.clear();
    } else if (flightPlanRecorder.isRecording()) {
      flightPlanRecorder.stopRecording();
    } else {
      flightPlanRecorder.startRecording();
    }
  });

  input.onKey('p', () => {
    if (flightPlanRecorder.isRecording()) flightPlanRecorder.addWaypoint(flightController);
  });

  // --- Bombs (B-17) ---
  // Simple arcade bombs: press B to drop, they fall with gravity and explode on impact.
  // Only meaningful for the B-17, but works from any plane for fun.
  const bombs = [];
  const bombGeo = new THREE.SphereGeometry(0.4, 8, 6);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
  function dropBomb() {
    if (bombs.length >= 10) return; // max 10 active
    const bomb = new THREE.Mesh(bombGeo, bombMat);
    bomb.position.copy(flightController.position);
    bomb.position.y -= 2; // below the plane
    // Inherit plane velocity (forward motion)
    const vel = new THREE.Vector3(0, 0, -1).applyQuaternion(flightController.quaternion);
    vel.multiplyScalar(_horizSpeed || 100);
    vel.y = _vertSpeed || 0;
    scene.add(bomb);
    bombs.push({ mesh: bomb, vel });
    Logger.info('App', 'Bomb away!');
    showNotification('Bomb away!');
  }
  input.onKey('b', dropBomb);
  // Update bombs in the animate loop (added to existing animation section)
  const _bombUpdate = (dt) => {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.vel.y -= 9.8 * dt; // gravity
      b.mesh.position.addScaledVector(b.vel, dt);
      const gnd = geoTerrainManager.getGroundElevation(b.mesh.position.x, b.mesh.position.z);
      const surface = Math.max(gnd, WATER_LEVEL_M);
      if (b.mesh.position.y <= surface + 1) {
        // Impact! Small explosion
        crashFX.burst(b.mesh.position.x, surface + 2, b.mesh.position.z, 'fire', 20);
        crashFX.burst(b.mesh.position.x, surface + 2, b.mesh.position.z, 'smoke', 15);
        crashFX.burst(b.mesh.position.x, surface + 2, b.mesh.position.z, 'dust', 20);
        scene.remove(b.mesh);
        bombs.splice(i, 1);
      } else if (b.mesh.position.y < -100) {
        // Fell through (shouldn't happen) — clean up
        scene.remove(b.mesh);
        bombs.splice(i, 1);
      }
    }
  };

  input.onKey('g', () => {
    if (flightPlanRecorder.autopilotActive) {
      flightPlanRecorder.autopilotActive = false;
      flightController.enabled = true;
      const plan = flightPlanRecorder.getPlan();
      flightController.position.copy(plan.position);
      flightController.setOrientation(plan.yaw, plan.pitch);
      Logger.info('App', 'Autopilot disengaged');
    } else {
      if (!flightPlanRecorder.hasValidPlan()) {
        Logger.warn('App', 'Need at least 2 waypoints to engage autopilot');
        return;
      }
      const plan = flightPlanRecorder.buildPlan(flightController);
      if (plan) {
        flightPlanRecorder.autopilotActive = true;
        flightController.enabled = false;
        Logger.info('App', 'Autopilot engaged');
      }
    }
  });

  input.onKey('y', (e) => {
    if (e.shiftKey) {
      if (!benchmarkRunner._lastReport) {
        Logger.warn('App', 'No completed benchmark — run one first before storing baseline');
        return;
      }
      BenchmarkComparator.storeBaseline(benchmarkRunner._lastReport);
      return;
    }
    if (benchmarkRunner.isRunning()) {
      benchmarkRunner.stop(flightController, renderer);
    } else {
      const userPlan = flightPlanRecorder.hasValidPlan() ? flightPlanRecorder.buildPlan(flightController) : null;
      benchmarkRunner.start(flightController, camera, gpuTimer, userPlan);
    }
  });

  // --- Touch controls (iPad / mobile) ---
  // Virtual joystick + drag-to-look. Desktop keyboard/mouse path is untouched.
  // ?debug=1 also forces the touch UI on desktop for automated playtesting.
  let touchControls = null;
  if (TouchControls.isTouchDevice() || dbgParams.has('debug')) {
    touchControls = new TouchControls(flightController);
    Logger.info('App', 'Touch controls enabled');
  }

  // --- Render loop ---
  let prevTime = performance.now();
  let _bankRoll = 0;
  let _booted = false; // boot overlay dismissed once terrain tiles are ready
  let _bootWaitT = 0; // wall-clock timestamp (ms) when boot started waiting
  const BOOT_TILE_TIMEOUT_S = 30; // give up waiting after this long
  const BOOT_MIN_TILES = 8; // need at least this many visible tiles
  // Velocity-lookahead state: project the LOD focal point ahead of motion so
  // terrain tiles along the flight path subdivide/download before arrival.
  const _prevCamPos = new THREE.Vector3();
  let _prevCamPosInit = false;
  const _lookaheadPoint = new THREE.Vector3();
  const LOOKAHEAD_TIME = 8; // seconds of flight to project ahead
  const LOOKAHEAD_MIN_SPEED = 25; // m/s — below this, no lookahead

  function animate() {
    requestAnimationFrame(animate);
    stats.begin();

    const now = performance.now();
    const dt = Math.min((now - prevTime) / 1000, MAX_DELTA_TIME);
    const frameTimeMs = now - prevTime;
    prevTime = now;

    // --- Takeoff intro: scripted throttle/pitch, interruptible ---
    // Uses wall-clock time (not dt) so the 22s sequence runs in 22s even at low FPS.
    if (takeoffT >= 0) {
      const stickActive = Math.abs(flightController.touchMove.x) > 0.05 ||
                          Math.abs(flightController.touchMove.y) > 0.05;
      const throttleTouched = Math.abs(flightController.throttle - _introLastThrottle) > 0.02;
      if (stickActive || throttleTouched) {
        takeoffT = -1; // player took over
        Logger.info('App', 'Takeoff intro skipped by player input');
      } else {
        const elapsed = (performance.now() - takeoffT) / 1000; // seconds since intro start
        // Phase 1 (0-20s): throttle 0 -> 0.25 (gentle takeoff roll, lets terrain load and player orient)
        const thrPhase = Math.min(elapsed / 20, 1);
        flightController.throttle = 0.25 * thrPhase;
        _introLastThrottle = flightController.throttle;
        if (touchControls) touchControls.syncThrottleUI();
        // Phase 2 (12-28s): pitch 0 -> 0.12 rad (rotate and climb out)
        if (elapsed > 12) {
          const pitchPhase = Math.min((elapsed - 12) / 16, 1);
          flightController.setOrientation(flightController.yaw, 0.12 * pitchPhase);
        }
        // End after 30s — normal flight resumes
        if (elapsed > 30) {
          takeoffT = -1;
          Logger.info('App', 'Takeoff intro complete');
        }
      }
    }

    // --- Input phase ---
    flightController.update(dt);
    liveTraffic.tick(dt);
    benchmarkRunner.tickPath(dt, flightController, renderer);

    // --- Aircraft state ---
    let aircraftState = null;

    if (flightPlanRecorder.autopilotActive && flightPlanRecorder.getPlan()) {
      const plan = flightPlanRecorder.getPlan();
      const ok = plan.update(dt);
      if (!ok) {
        flightPlanRecorder.autopilotActive = false;
        flightController.enabled = true;
        flightController.position.copy(plan.position);
        flightController.setOrientation(plan.yaw, plan.pitch);
        Logger.info('App', 'Autopilot: flight plan completed');
      } else {
        _autopilotEuler.set(plan.pitch, plan.yaw, 0, 'YXZ');
        _autopilotQuat.setFromEuler(_autopilotEuler);
        aircraftState = {
          position: plan.position,
          yaw: plan.yaw,
          pitch: plan.pitch,
          yawRate: plan.yawRate,
          pitchRate: plan.pitchRate,
          quaternion: _autopilotQuat,
        };
      }
    } else if (benchmarkRunner.isRunning() && !benchmarkRunner.isWarmup() && benchmarkRunner.cameraPath) {
      const path = benchmarkRunner.cameraPath;
      _autopilotEuler.set(path.pitch, path.yaw, 0, 'YXZ');
      _autopilotQuat.setFromEuler(_autopilotEuler);
      aircraftState = {
        position: path.position,
        yaw: path.yaw,
        pitch: path.pitch,
        yawRate: path.yawRate,
        pitchRate: path.pitchRate,
        quaternion: _autopilotQuat,
      };
    } else if (!benchmarkRunner.isRunning()) {
      aircraftState = {
        position: flightController.position,
        yaw: flightController.yaw,
        pitch: flightController.pitch,
        yawRate: flightController.yawRate,
        pitchRate: flightController.pitchRate,
        quaternion: flightController.quaternion,
      };
    }

    // --- Bank roll (derived from yawRate, single source of truth) ---
    if (aircraftState) {
      const targetRoll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL,
        aircraftState.yawRate * ROLL_SENSITIVITY));
      _bankRoll += (targetRoll - _bankRoll) * ROLL_DAMP_SPEED * dt;
      aircraftState.roll = _bankRoll;
    }

    // --- Crash detection & animation (manual flight only) ---
    // The old 60m terrain floor is gone: sample the ground below and just
    // ahead of the nose, and if the aircraft touches dirt, trigger a crash
    // animation chosen from the impact parameters. Controls freeze while the
    // wreck tumbles; FLY AGAIN respawns 1200m above the crash site.
    const manualFlight = aircraftState && !flightPlanRecorder.autopilotActive && !benchmarkRunner.isRunning();
    if (dt > 0 && !crashing) {
      const dx = flightController.position.x - _prevPos.x;
      const dy = flightController.position.y - _prevPos.y;
      const dz = flightController.position.z - _prevPos.z;
      _horizSpeed = Math.hypot(dx, dz) / dt;
      _vertSpeed = dy / dt;
      _prevPos.copy(flightController.position);
    }
    if (crashGraceT > 0) crashGraceT -= dt;
    _bombUpdate(dt); // update falling bombs
    if (crashing) {
      crashFX.update(dt, flightController,
        (x, z) => geoTerrainManager.getGroundElevation(x, z));
    } else if (manualFlight && crashGraceT <= 0 && dt > 0) {
      _crashFwd.set(0, 0, -1).applyQuaternion(flightController.quaternion);
      const gndBelow = geoTerrainManager.getGroundElevation(
        flightController.position.x, flightController.position.z);
      const gndAhead = geoTerrainManager.getGroundElevation(
        flightController.position.x + _crashFwd.x * CRASH_LOOKAHEAD_M,
        flightController.position.z + _crashFwd.z * CRASH_LOOKAHEAD_M);
      // Over water the DEM returns seafloor depth (e.g. -4586m), not sea level.
      // Trigger the splash at the visual water surface (~0m), not the seafloor.
      // Use the visual surface: max(terrain, sea level) — if either sample is
      // land, use the higher terrain; if both are water, use sea level.
      const surfaceBelow = Math.max(gndBelow, WATER_LEVEL_M);
      const surfaceAhead = Math.max(gndAhead, WATER_LEVEL_M);
      const isWater = surfaceBelow <= WATER_LEVEL_M + 0.5 && surfaceAhead <= WATER_LEVEL_M + 0.5;
      const triggerAlt = Math.max(surfaceBelow, surfaceAhead) + CRASH_GROUND_PAD_M;
      if (flightController.position.y < triggerAlt) {
        crashing = true;
        _impactVel.set(
          _crashFwd.x * _horizSpeed,
          _vertSpeed,
          _crashFwd.z * _horizSpeed);
        flightController.enabled = false;
        flightController.yawRate = 0;
        flightController.pitchRate = 0;
        const type = classifyCrash(aircraftState.roll, gndBelow, gndAhead);
        crashFX.startCrash(type, flightController,
          (x, z) => geoTerrainManager.getGroundElevation(x, z), _impactVel);
      }
    }

    // --- Camera phase ---
    if (aircraftState) {
      aircraftManager.update(aircraftState, dt);
      if (CONFIG.cameraMode === 'cockpit') {
        aircraftManager.setVisible(false);
        camera.position.copy(aircraftState.position);
        camera.quaternion.copy(aircraftState.quaternion);
        _qRoll.setFromAxisAngle(_axisZ, aircraftState.roll);
        camera.quaternion.multiply(_qRoll);
        chaseCameraController.reset();
      } else {
        aircraftManager.setVisible(true);
        chaseCameraController.update(aircraftState, camera, dt);
      }
    }

    // Crash camera shake: decaying random offset while the wreck tumbles.
    // Safe here — both camera modes rebuild camera position/quaternion above.
    if (crashing) crashFX.applyShake(camera);

    // --- Environment phase ---
    cloudLayer.update(dt, camera.position, aircraftState ? aircraftState.pitch : 0);
    // Puff clouds drift + sky follows camera
    if (puffClouds && puffClouds.update) puffClouds.update(dt, camera.position);
    if (skyController && skyController.update) skyController.update(camera.position);

    const timer = benchmarkRunner.getSubsystemTimer();

    // --- Terrain phase ---
    if (timer) timer.begin('terrain');
    // Velocity lookahead: feed the tile LOD system a focal point ahead of the
    // aircraft so high-detail tiles stream in along the flight path early.
    if (dt > 0) {
      if (!_prevCamPosInit) {
        _prevCamPos.copy(camera.position);
        _prevCamPosInit = true;
      }
      const speed = _prevCamPos.distanceTo(camera.position) / dt;
      const tileMap = geoTerrainManager.tileMap;
      if (tileMap && speed > LOOKAHEAD_MIN_SPEED) {
        _lookaheadPoint
          .copy(camera.position)
          .sub(_prevCamPos)
          .multiplyScalar(LOOKAHEAD_TIME / dt)
          .add(camera.position);
        _lookaheadPoint.y = Math.max(_lookaheadPoint.y, 0);
        tileMap.userData.lookahead = {
          point: _lookaheadPoint,
          radius: Math.min(Math.max(speed * 6, 1500), 20000),
        };
      } else if (tileMap) {
        tileMap.userData.lookahead = null;
      }
      _prevCamPos.copy(camera.position);
    }
    geoTerrainManager.update(camera.position);
    if (timer) timer.end('terrain');

    const farNeeded = REALWORLD_FAR_PLANE;
    if (Math.abs(camera.far - farNeeded) > CLIP_PLANE_EPSILON) {
      camera.far = farNeeded;
      camera.near = DEFAULT_NEAR;
      camera.updateProjectionMatrix();
      Logger.debug('App', 'Realworld clip planes updated', { near: DEFAULT_NEAR, far: farNeeded });
    }
    groundElevation = geoTerrainManager.getGroundElevation(camera.position.x, camera.position.z);

    // --- Render phase ---
    if (timer) timer.begin('render');
    gpuTimer.beginFrame();
    renderer.info.reset();
    renderer.render(scene, camera);
    gpuTimer.endFrame();
    if (timer) timer.end('render');

    // Dismiss the boot overlay once Sitka's terrain is actually loaded —
    // not just the first frame. The player should see a beautiful home base,
    // not gray tiles popping in. Uses wall-clock so the 30s timeout is real.
    if (!_booted) {
      if (_bootWaitT === 0) _bootWaitT = performance.now();
      const bootElapsed = (performance.now() - _bootWaitT) / 1000;
      const tileCount = geoTerrainManager.countVisibleTiles();
      const statusEl = document.getElementById('boot-status');
      if (statusEl && tileCount < BOOT_MIN_TILES) {
        statusEl.textContent = `Loading Sitka… (${tileCount} terrain tiles)`;
      }
      if (tileCount >= BOOT_MIN_TILES || bootElapsed > BOOT_TILE_TIMEOUT_S) {
        _booted = true;
        document.getElementById('boot-overlay')?.classList.add('hidden');
        // Start the takeoff roll now that the player can see it (wall-clock timestamp)
        if (takeoffT === -2) {
          // Nudge spawn to land if we're over water: search east toward the island
          const gndHere = geoTerrainManager.getGroundElevation(
            flightController.position.x, flightController.position.z);
          if (gndHere <= 10) {
            for (let d = 500; d <= 5000; d += 500) {
              const g = geoTerrainManager.getGroundElevation(
                flightController.position.x + d, flightController.position.z);
              if (g > 10) {
                flightController.position.x += d;
                flightController.position.y = g + 25;
                _prevPos.copy(flightController.position);
                Logger.info('App', `Takeoff spawn nudged ${d}m east to land (gnd ${Math.round(g)}m)`);
                break;
              }
            }
          }
          takeoffT = performance.now();
          Logger.info('App', 'Takeoff intro starting — Sitka is ready');
        }
      }
    }

    // --- Overlay phase ---
    if (timer) timer.begin('hud');
    hud.update(camera, groundElevation, benchmarkRunner, dt, flightPlanRecorder, aircraftState);
    if (timer) timer.end('hud');

    if (timer) timer.begin('minimap');
    minimap.update(camera, aircraftState);
    if (timer) timer.end('minimap');

    // --- Post-render phase ---
    benchmarkRunner.recordMetrics(renderer);
    adaptiveQuality.update(frameTimeMs);
    gpuPanel.update(gpuTimer.getLastGPUTimeMs(), 30);

    stats.end();
  }

  animate();
}

initApp().catch((err) => {
  console.error('Failed to initialize application:', err);
  // Never leave the user staring at a black screen: surface the failure.
  const overlay = document.getElementById('boot-overlay');
  const status = document.getElementById('boot-status');
  const errBox = document.getElementById('boot-error');
  if (overlay && status && errBox) {
    overlay.classList.remove('hidden');
    status.textContent = 'Could not start the 3D engine on this device.';
    errBox.style.display = 'block';
    errBox.textContent =
      'Details: ' + String((err && err.message) || err) +
      '\n\nTry ?renderer=webgl for the WebGL fallback, or a browser with WebGPU support.';
  }
});
