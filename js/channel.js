/**
 * Channel — always-on flight cinematography.
 *
 * A page that plays flight cinematography forever. When you tune in, it's
 * showing good stuff. It never stops, and it keeps making more.
 *
 * Standalone: reuses the scene setup (renderer, terrain, sky, clouds,
 * aircraft) but drives playback entirely from SequenceGenerator. No HUD,
 * no input, no user interaction — just footage.
 *
 * Security: this page is fully self-contained, no user data, no tracking.
 * All footage is synthetic — generated from public terrain data and the
 * motion tile library. No camera, microphone, GPS, or personal data.
 * No analytics, no external scripts beyond the Three.js CDN (same as /fly/).
 */
import * as THREE from 'three';
import { CONFIG } from './utils/config.js';
import { createRenderer, createScene, createCamera } from './scene/SceneSetup.js';
import AtmosphericSky from './atmosphere/AtmosphericSky.js';
import CloudLayer from './atmosphere/CloudLayer.js';
import { createCloudLayer as createPuffClouds } from './scene/CloudLayer.js';
import GeoTerrainManager from './terrain/GeoTerrainManager.js';
import AircraftManager from './aircraft/AircraftManager.js';
import MotionTilePlayer from './cinematography/MotionTilePlayer.js';
import CameraTrackPlayer from './cinematography/CameraTrackPlayer.js';
import SequenceGenerator from './cinematography/SequenceGenerator.js';
import { detectTileMode } from './geo/TileUrls.js';
import Logger from './utils/Logger.js';

async function initChannel() {
  const nowPlaying = document.getElementById('now-playing');
  const seqCount = document.getElementById('seq-count');
  const bootStatus = document.getElementById('boot-status');

  // --- Core scene (same as /fly/) ---
  const renderer = await createRenderer();
  const { scene, dirLight, ambientLight } = createScene();
  const camera = createCamera();

  new AtmosphericSky(scene, dirLight, ambientLight);
  const cloudLayer = new CloudLayer(scene);
  scene.add(createPuffClouds());

  // --- Terrain ---
  await detectTileMode();
  const geoTerrainManager = new GeoTerrainManager(scene, renderer);
  geoTerrainManager.init(CONFIG.lat, CONFIG.lon);

  // --- Aircraft ---
  const aircraftManager = new AircraftManager(scene);
  let planeDef = null;
  try {
    planeDef = await aircraftManager.loadPlane('rafale');
    Logger.info('Channel', `Flying ${planeDef.name}`);
  } catch (err) {
    Logger.warn('Channel', 'Failed to load plane: ' + err.message);
  }

  // --- Cinematography ---
  const tilePlayer = new MotionTilePlayer();
  const cameraPlayer = new CameraTrackPlayer();
  const generator = new SequenceGenerator(tilePlayer);
  await tilePlayer.preloadCatalog();

  // Sequence queue: always keep 3 ready
  const queue = [];
  let currentSeq = null;
  let seedCounter = 1;

  async function fillQueue() {
    while (queue.length < 3) {
      const seq = await generator.generate(seedCounter++);
      if (seq) queue.push(seq);
      else break;
    }
  }

  async function playNext() {
    if (queue.length === 0) await fillQueue();
    const seq = queue.shift();
    if (!seq) return;
    currentSeq = seq;

    // Anchor at a fixed origin above Sitka terrain
    const origin = {
      position: new THREE.Vector3(0, 300, 0),
      yaw: -Math.PI / 2,
    };
    tilePlayer.play(seq.tiles, origin);
    cameraPlayer.setTrack(seq.cameraTrack);
    cameraPlayer.play();

    if (nowPlaying) nowPlaying.textContent = `Now playing: ${seq.name}`;
    if (seqCount) seqCount.textContent = `Generated ${generator.sequenceCount} sequences`;

    // Pre-generate the next batch in the background
    fillQueue();
  }

  // --- Boot ---
  if (bootStatus) bootStatus.textContent = 'Starting channel…';
  document.getElementById('boot-overlay')?.remove();

  // Start the endless loop
  await fillQueue();
  await playNext();

  // --- Animate loop ---
  const clock = new THREE.Clock();
  const aircraftState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // Plane: driven by the tile player
    const tileState = tilePlayer.tick();
    if (tileState) {
      aircraftState.position.copy(tileState.position);
      aircraftState.quaternion.copy(tileState.quaternion);
      aircraftManager.update(
        {
          position: aircraftState.position,
          quaternion: aircraftState.quaternion,
          roll: 0,
          pitch: 0,
        },
        dt,
      );
    } else if (currentSeq) {
      // Sequence ended — play the next one
      playNext();
    }

    // Camera: driven by the camera track player (overrides chase cam)
    cameraPlayer.tick(camera);

    // Environment
    cloudLayer.update(dt, camera.position, 0);
    geoTerrainManager.update?.(dt);

    renderer.render(scene, camera);
  }
  animate();
}

initChannel().catch((err) => {
  const bootError = document.getElementById('boot-error');
  if (bootError) {
    bootError.style.display = 'block';
    bootError.textContent = 'Channel failed to start: ' + err.message;
  }
  console.error('Channel init failed:', err);
});
