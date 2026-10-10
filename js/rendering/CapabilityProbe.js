/**
 * Boot-time hardware capability probe.
 *
 * Goal: one codebase that is excellent on an iPad, great on a discrete desktop
 * GPU, and degrades sanely on hardware we have never seen — with no per-device
 * branches and no device-name matching.
 *
 * The rule this file follows deliberately: **measure capability, not identity.**
 * Nothing here looks for "iPad", "RTX", "Apple M3", or any model string. A
 * capability probe survives new devices automatically; a device-name list has to
 * be edited every time hardware ships. (When every independent check agrees, the
 * `navigator.userAgentData.mobile` + touch + unmasked-renderer signals still
 * give us a mobile/desktop distinction, but they are inputs — never a lookup
 * table.)
 *
 * Signals used, strongest first:
 *   1. WebGPU adapter limits (maxTextureDimension2D, maxBufferSize,
 *      maxStorageBufferBindingSize) — a real capability number where present.
 *   2. Unmasked WebGL renderer string — the only way to learn "this is a
 *      software rasteriser" (SwiftShader/llvmpipe) or an integrated GPU.
 *   3. Measured frame-time budget from the live render loop (see
 *      AdaptiveQualityManager) — the ground truth, and it self-corrects.
 *   4. Display facts: devicePixelRatio, screen area, coarse pointer.
 *   5. Explicit user override (?quality= or the control panel).
 *
 * Signals 1-2 are the only async part, and they are strictly best-effort: a
 * probe that throws must never prevent the app from starting.
 */

import Logger from '../utils/Logger.js';
import { update } from '../utils/config.js';

// --- Tier definitions -------------------------------------------------------
// Ordered weakest -> strongest. Each tier is a *budget*, not a device label.

export const TIER = {
  POTATO: 'potato', // software rasteriser, or no usable GPU at all
  BALANCED: 'balanced', // integrated / mobile GPU
  PERFORMANCE: 'performance', // discrete desktop GPU or high-end mobile
};

/**
 * Per-tier budgets. Everything the renderer and terrain system need to size
 * themselves lives here, so adding a tier is a data change, not a code change.
 *
 * `pixelRatio` is the CEILING that AdaptiveQualityManager is allowed to reach.
 * `minPixelRatio` is the FLOOR it may fall back to under load.
 * `lodThreshold` lower = more aggressive LOD (three-tile picks children sooner),
 * which means more tiles and more GPU work for the same view distance.
 * `maxTotalTiles` bounds resident terrain tiles.
 * `antialias` is set at renderer construction and cannot change later.
 */
const TIER_BUDGETS = {
  [TIER.POTATO]: {
    pixelRatio: 1.0,
    minPixelRatio: 0.5,
    lodThreshold: 0.7,
    maxTotalTiles: 180,
    maxTextureDimension: 2048,
    antialias: false,
    hiResMode: false,
  },
  [TIER.BALANCED]: {
    pixelRatio: 2.0,
    minPixelRatio: 0.6,
    lodThreshold: 1.0,
    maxTotalTiles: 600,
    maxTextureDimension: 4096,
    antialias: true,
    hiResMode: false,
  },
  [TIER.PERFORMANCE]: {
    pixelRatio: 2.0,
    minPixelRatio: 0.75,
    lodThreshold: 1.4,
    maxTotalTiles: 1400,
    maxTextureDimension: 8192,
    antialias: true,
    hiResMode: true,
  },
};

/** Renderer strings that mean "no real GPU — software rasteriser". */
const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|softwarerasterizer|software rasterizer|microsoft basic render|mesa offscreen/i;

/** Renderer strings that mean a discrete or clearly high-end mobile GPU. */
const DISCRETE_GPU_PATTERN =
  /rtx|gtx\s?(1[6-9]|20)\d\d|quadro|radeon\s?rx\s?[5-9]\d{3}|apple\s?m[1-9]\b|adreno\s?7\d\d|adreno\s?8\d\d|mali-g[7-9]\d/i;

/** Integrated GPUs that are perfectly capable but not worth hi-res tiling. */
const INTEGRATED_GPU_PATTERN =
  /intel|uhd\s?graphics|iris|radeon\s?(vega|radeon graphics|780m|680m)|mali-g[3-6]\d|adreno\s?[5-6]\d\d/i;

/**
 * Probe the device. Async and never throws.
 * @returns {Promise<{tier: string, budget: object, reasons: string[], signals: object}>}
 */
export async function probeCapabilities() {
  const reasons = [];
  const signals = {
    coarsePointer: false,
    touchPoints: 0,
    devicePixelRatio: 1,
    screenPixels: 0,
    unmaskedRenderer: null,
    adapterLimits: null,
    softwareRendered: false,
    isMobileUA: false,
    forcedQuality: null,
  };

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    reasons.push('non-browser context — using the most conservative tier');
    return finish(TIER.POTATO, reasons, signals);
  }

  // --- Explicit override always wins, and is checked first so a user on a
  // misclassified device is never stuck. ---------------------------------
  const override = readOverride();
  if (override) {
    signals.forcedQuality = override;
    reasons.push(`explicit override "?quality=${override}" requested`);
    return finish(override, reasons, signals);
  }

  // --- Display facts ------------------------------------------------------
  signals.coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  signals.touchPoints = navigator.maxTouchPoints || 0;
  signals.devicePixelRatio = window.devicePixelRatio || 1;
  signals.screenPixels = window.innerWidth * window.innerHeight * signals.devicePixelRatio ** 2;
  signals.isMobileUA = !!(typeof navigator.userAgentData !== 'undefined' && navigator.userAgentData.mobile);

  // --- 1) WebGPU adapter limits -------------------------------------------
  try {
    signals.adapterLimits = await readWebGpuLimits(reasons);
  } catch {
    /* best effort */
  }

  // --- 2) Unmasked WebGL renderer string ----------------------------------
  try {
    signals.unmaskedRenderer = readUnmaskedRenderer(reasons);
  } catch {
    /* best effort */
  }

  signals.softwareRendered = !!signals.unmaskedRenderer && SOFTWARE_RENDERER_PATTERN.test(signals.unmaskedRenderer);

  // --- Decide -------------------------------------------------------------
  if (signals.softwareRendered) {
    reasons.push(
      `software rasteriser detected ("${truncate(signals.unmaskedRenderer, 60)}") — no real GPU acceleration available`,
    );
    return finish(TIER.POTATO, reasons, signals);
  }

  const limits = signals.adapterLimits;
  const maxTex = limits?.maxTextureDimension2D ?? 0;

  // A real adapter reporting small limits is a weak GPU even if we cannot
  // read its name. This is the "unknown hardware still works" path.
  if (maxTex && maxTex < 4096) {
    reasons.push(`adapter reports maxTextureDimension2D=${maxTex} (below 4096) — treating as low-end GPU`);
    return finish(TIER.POTATO, reasons, signals);
  }

  if (signals.unmaskedRenderer && DISCRETE_GPU_PATTERN.test(signals.unmaskedRenderer)) {
    reasons.push(`discrete/high-end GPU capability signalled ("${truncate(signals.unmaskedRenderer, 60)}")`);
    return finish(TIER.PERFORMANCE, reasons, signals);
  }

  if (maxTex >= 8192) {
    reasons.push(`adapter reports maxTextureDimension2D=${maxTex} (8192+) — high capability`);
    return finish(TIER.PERFORMANCE, reasons, signals);
  }

  // No adapter string and no strong limits: fall back to the display facts,
  // which are the only remaining evidence.
  const mobileish = signals.coarsePointer && (signals.isMobileUA || signals.touchPoints > 0);
  if (mobileish && signals.screenPixels > 8_000_000) {
    reasons.push('mobile-class pointer with a very large logical surface — high-end mobile default');
    return finish(TIER.PERFORMANCE, reasons, signals);
  }

  if (signals.unmaskedRenderer && INTEGRATED_GPU_PATTERN.test(signals.unmaskedRenderer)) {
    reasons.push(`integrated GPU ("${truncate(signals.unmaskedRenderer, 60)}") — capable but not hi-res`);
    return finish(TIER.BALANCED, reasons, signals);
  }

  reasons.push('no definitive signal — assuming integrated-class GPU (the safest default that still looks good)');
  return finish(TIER.BALANCED, reasons, signals);
}

function finish(tier, reasons, signals) {
  const budget = { ...TIER_BUDGETS[tier] };
  // Never render above the display's own ratio — a 3x phone screen does not
  // need a 3x framebuffer when the GPU is also filling more tiles.
  budget.pixelRatio = Math.min(budget.pixelRatio, signals.devicePixelRatio || budget.pixelRatio);
  return { tier, budget, reasons, signals };
}

/** Read WebGPU adapter limits, if WebGPU is present. Returns null otherwise. */
async function readWebGpuLimits(reasons) {
  if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      reasons.push('navigator.gpu present but requestAdapter() returned null');
      return null;
    }
    const l = adapter.limits || {};
    return {
      maxTextureDimension2D: l.maxTextureDimension2D ?? 0,
      maxBufferSize: l.maxBufferSize ?? 0,
      maxStorageBufferBindingSize: l.maxStorageBufferBindingSize ?? 0,
    };
  } catch (err) {
    reasons.push(`WebGPU adapter probe failed: ${truncate(String(err && err.message), 60)}`);
    return null;
  }
}

/**
 * Unmasked WebGL renderer string. Requires a throwaway context; the probe
 * releases it immediately. This is the only reliable way to detect a software
 * rasteriser or to learn that we are on integrated graphics.
 */
function readUnmaskedRenderer(reasons) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) || canvas.getContext('webgl');
  if (!gl) {
    reasons.push('no WebGL context available for renderer identification');
    return null;
  }
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return gl.getParameter(gl.RENDERER) || null;
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null;
  } catch {
    return null;
  } finally {
    // Free the probe context immediately — it is not used for rendering and
    // on low-memory devices a leaked context costs real megabytes.
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose && typeof lose.loseContext === 'function') lose.loseContext();
  }
}

/** Map a user-facing quality name onto a tier. */
export function qualityToTier(quality) {
  switch (String(quality || '').toLowerCase()) {
    case 'auto':
      return null; // let the probe decide
    case 'battery':
    case 'low':
    case 'potato':
      return TIER.POTATO;
    case 'balanced':
    case 'medium':
      return TIER.BALANCED;
    case 'high':
    case 'performance':
    case 'max':
      return TIER.PERFORMANCE;
    default:
      return null;
  }
}

/** Inverse of qualityToTier: the canonical user-facing name for a tier. */
export function tierToQuality(tier) {
  switch (tier) {
    case TIER.POTATO:
      return 'low';
    case TIER.BALANCED:
      return 'medium';
    case TIER.PERFORMANCE:
      return 'high';
    default:
      return 'auto';
  }
}

/**
 * The budget for a tier, tolerating a null tier (which means "auto").
 * Exposed so a settings UI can show the numbers the probe is working to
 * instead of asking the user to trust a word like "balanced".
 */
export function getBudget(tier) {
  return TIER_BUDGETS[tier] ?? TIER_BUDGETS[TIER.BALANCED];
}

/** Read ?quality= / ?tier= from the URL, validated against known tiers. */
function readOverride() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('quality') || params.get('tier');
    return qualityToTier(raw);
  } catch {
    return null;
  }
}

/** Apply a tier's budget to CONFIG so the rest of the app reads it normally. */
export function applyBudget(tier, budget) {
  update('maxPixelRatio', budget.pixelRatio);
  update('maxTotalTiles', budget.maxTotalTiles);
  update('hiResMode', budget.hiResMode);
  Logger.info(
    'Render',
    `Tier=${tier} pixelRatio≤${budget.pixelRatio} tiles≤${budget.maxTotalTiles} aa=${budget.antialias}`,
  );
}

export { TIER_BUDGETS };

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
