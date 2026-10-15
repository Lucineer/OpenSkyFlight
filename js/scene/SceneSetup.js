import * as THREE from 'three';
import Logger from '../utils/Logger.js';
import { AMBIENT_INTENSITY, DIR_LIGHT_INTENSITY, DIR_LIGHT_POSITION } from '../constants/rendering.js';
import { DEFAULT_FOV, DEFAULT_NEAR, DEFAULT_FAR, REALWORLD_START_ALTITUDE } from '../constants/camera.js';
import { createRenderer as createRendererFromModule } from '../render/Renderer.js';

export async function createRenderer() {
  // Delegate to the js/render/Renderer.js abstraction (WebGPU-first with
  // WebGL2 fallback). Then attach canvas and context-loss handlers.
  const renderer = await createRendererFromModule();

  // --- Context-loss guard -------------------------------------------------
  // Handle GPU context loss by surfacing a recoverable state instead of
  // hanging forever on the boot overlay with a dead canvas. This happens on
  // iPad when the device reclaims GPU memory (e.g. tab backgrounded).
  attachContextLossHandlers(renderer);

  document.getElementById('canvas-container').appendChild(renderer.domElement);
  return renderer;
}

/**
 * Show a full-screen recoverable state when the GPU context is lost.
 * `webglcontextlost` fires for the WebGL backend; WebGPURenderer exposes
 * `renderer.backend.device.lost` (a promise) for the WebGPU backend. Both are
 * wired up. Recovery is a reload because rebuilding the whole scene graph
 * (terrain LOD, flight state) in place is not safe mid-flight.
 */
function showContextLostUI(reason) {
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  const status = document.getElementById('boot-status');
  const errBox = document.getElementById('boot-error');
  overlay.classList.remove('hidden');
  if (status) status.textContent = 'The graphics engine stopped.';
  if (errBox) {
    errBox.style.display = 'block';
    errBox.textContent =
      `The GPU context was lost${reason ? ` (${reason})` : ''}.\n\n` +
      'This usually means the device reclaimed GPU memory, or the tab was ' +
      'backgrounded for a long time. Reload to fly again.\n\n' +
      'If it keeps happening, try ?renderer=webgl to use the WebGL fallback.';
    // Make recovery a single action.
    const btn = document.createElement('button');
    btn.textContent = 'RELOAD';
    btn.style.cssText =
      'display:block;margin-top:14px;padding:10px 22px;font:inherit;font-size:13px;' +
      'letter-spacing:2px;cursor:pointer;color:#0a0a1a;background:#00ff88;' +
      'border:none;border-radius:3px;';
    btn.addEventListener('click', () => location.reload());
    errBox.appendChild(btn);
  }
}

function attachContextLossHandlers(renderer) {
  const canvas = renderer.domElement;
  if (!canvas) return;
  let signalled = false;

  const signal = (reason) => {
    if (signalled) return;
    signalled = true;
    Logger.error('Renderer', `GPU context lost: ${reason}`);
    showContextLostUI(reason);
  };

  // WebGL backend
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault(); // allow a later restore
      signal('webglcontextlost');
    },
    false,
  );

  // WebGPU backend — device loss is a promise, not an event.
  const device = renderer?.backend?.device;
  if (device && typeof device.lost?.then === 'function') {
    device.lost
      .then((info) => signal(info?.reason || info?.message || 'device lost'))
      .catch(() => signal('device lost'));
  }
}

export function createScene() {
  const scene = new THREE.Scene();
  const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, DIR_LIGHT_INTENSITY);
  dirLight.position.set(...DIR_LIGHT_POSITION);
  scene.add(dirLight);
  return { scene, ambientLight, dirLight };
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    DEFAULT_FOV,
    window.innerWidth / window.innerHeight,
    DEFAULT_NEAR,
    DEFAULT_FAR,
  );
  camera.position.set(0, REALWORLD_START_ALTITUDE, 0);
  return camera;
}

export function setupResizeHandler(camera, renderer, hud) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    hud.resize(window.innerWidth, window.innerHeight);
  });
}
