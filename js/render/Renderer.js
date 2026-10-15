/**
 * Renderer — unified renderer abstraction for OpenSkyFlight.
 *
 * WebGPU-first with automatic WebGL2 fallback, following the
 * pmmathias/birdybird dual-renderer pattern.
 *
 * Detection order:
 * 1. ?renderer=webgpu or ?renderer=webgl query param (explicit override)
 * 2. navigator.gpu availability (WebGPU supported?)
 * 3. Try WebGPU init, fall back to WebGL on failure
 *
 * Usage:
 *   import { createRenderer } from './render/Renderer.js';
 *   const renderer = await createRenderer();
 *   console.log(renderer.getType()); // 'webgpu' or 'webgl2'
 */

import * as THREE from 'three';
import Logger from '../utils/Logger.js';
import { CONFIG } from '../utils/config.js';
import { CLEAR_COLOR } from '../constants/rendering.js';
import { createWebGPURenderer, isWebGPUAvailable } from './WebGPURenderer.js';

export const RENDERER_WEBGPU = 'webgpu';
export const RENDERER_WEBGL2 = 'webgl2';

/**
 * Determine which renderer to use based on query params and capabilities.
 * @returns {'webgpu'|'webgl2'|'auto'} Requested renderer or 'auto'
 */
export function getRequestedRenderer() {
  try {
    const param = new URLSearchParams(location.search).get('renderer');
    if (param === 'webgpu') return RENDERER_WEBGPU;
    if (param === 'webgl' || param === 'webgl2') return RENDERER_WEBGL2;
  } catch {
    /* non-browser context */
  }
  return 'auto';
}

/**
 * Create the best available renderer.
 *
 * Tries WebGPU first (unless ?renderer=webgl forces fallback), falls back
 * to WebGL2 on any failure. The returned renderer has a getType() method
 * indicating which backend is active.
 *
 * @returns {Promise<THREE.WebGPURenderer>} Initialized renderer with getType()
 */
export async function createRenderer() {
  const requested = getRequestedRenderer();
  let renderer = null;
  let type = null;

  // Try WebGPU unless explicitly forced to WebGL
  if (requested !== RENDERER_WEBGL2) {
    try {
      renderer = await createWebGPURenderer();
      type = RENDERER_WEBGPU;
      Logger.info('Renderer', 'Using WebGPU');
    } catch (err) {
      Logger.warn('Renderer', `WebGPU init failed, falling back to WebGL2: ${err.message}`);
    }
  }

  // Fallback to WebGL2 (via WebGPURenderer with forceWebGL flag)
  if (!renderer) {
    renderer = new THREE.WebGPURenderer({ forceWebGL: true, antialias: true });
    await renderer.init();
    type = RENDERER_WEBGL2;

    // Apply iPad tuning for WebGL path too
    const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(CLEAR_COLOR);

    Logger.info('Renderer', 'Using WebGL2 fallback');
  }

  // Attach type accessor
  renderer.getType = () => type;

  return renderer;
}

/**
 * Check if WebGPU is available (does not initialize).
 * @returns {boolean}
 */
export function supportsWebGPU() {
  return isWebGPUAvailable();
}
