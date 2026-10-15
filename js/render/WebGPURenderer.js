/**
 * WebGPURenderer — WebGPU backend setup for OpenSkyFlight.
 *
 * Uses Three.js WebGPURenderer which maps to Metal on iPad (Safari 26+),
 * providing significant performance gains over WebGL2 for compute-heavy
 * workloads (terrain, ocean, particles).
 *
 * iPad-specific tuning:
 * - Pixel ratio capped at 2 (iOS Safari limit)
 * - High-performance power preference
 * - Antialiasing enabled (MSAA via WebGPU)
 */

import * as THREE from 'three';
import Logger from '../utils/Logger.js';
import { CONFIG } from '../utils/config.js';
import { CLEAR_COLOR } from '../constants/rendering.js';

/**
 * Create and initialize a WebGPU renderer.
 * @returns {Promise<THREE.WebGPURenderer>} Initialized renderer
 * @throws If WebGPU is not available or initialization fails
 */
export async function createWebGPURenderer() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU not available (navigator.gpu missing)');
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    trackTimestamp: true,
  });

  await renderer.init();

  // iPad tuning: cap pixel ratio at 2 (iOS Safari hard limit)
  const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(CLEAR_COLOR);

  Logger.info('WebGPURenderer', `Initialized (pixelRatio: ${pixelRatio})`);
  return renderer;
}

/**
 * Check if WebGPU is available in this browser.
 * @returns {boolean} True if navigator.gpu exists
 */
export function isWebGPUAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}
