// Graphics quality control for game pages.
//
// WHY THIS EXISTS
//
// The free-flight sim has had a quality selector for a while. The games did
// not, and that is a real gap on a workstation: the capability probe picks a
// tier from adapter limits, the renderer string, DPR and pointer type, and
// occasionally it guesses wrong or is handed a bad answer by a driver. In the
// sim you could answer it. In a game there was no way to ask for `performance`
// short of hand-editing the URL.
//
// The budgets themselves are unchanged and remain exactly what the probe
// decided. This adds a way to OVERRIDE the probe, which is a different thing
// from replacing it, and it is the same distinction the sim's control draws.
//
// WHY A RELOAD
//
// `antialias` is fixed at renderer construction and terrain tile LOD is baked
// into the three-tile sources when they are built. A preset therefore cannot
// be applied live without rebuilding both. The sim reloads for the same
// reason; this does too, and says so in the label rather than applying half a
// change and pretending it took.
//
// THE CHOICE IS SHARED, NOT PER GAME
//
// Preference lives in localStorage under one key, and the sim's own selector
// reads it on next load. Set `performance` in one game and the next game, and
// the sim, all honour it — which is the behaviour someone with a real GPU and
// nine games would otherwise have to repeat nine times.

import { qualityToTier, tierToQuality, getBudget } from '../rendering/CapabilityProbe.js';

const KEY = 'osf.quality';

/** Auto | lowest | balanced | high */
const OPTIONS = [
  { value: 'auto', label: 'Auto', hint: 'Let the probe decide' },
  { value: 'low', label: 'Lowest', hint: 'Software rasteriser or very weak GPU' },
  { value: 'medium', label: 'Balanced', hint: 'Integrated or mobile GPU' },
  { value: 'high', label: 'High', hint: 'Discrete desktop GPU' },
];

function readStored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeStored(v) {
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* private mode */
  }
}

/**
 * A URL that requests a quality, preserving everything else the page already
 * had. `?tiles=proxy` and friends must survive, or a player who set up a tile
 * cache would silently lose it by touching a graphics setting.
 */
function withQuality(v) {
  const url = new URL(location.href);
  if (v === 'auto') url.searchParams.delete('quality');
  else url.searchParams.set('quality', v);
  return url.toString();
}

/**
 * Mount the control into an element (the shell's top-right cluster).
 * Safe to call once; a second call is a no-op.
 */
export function mountGraphicsControl(host, { onChange } = {}) {
  if (!host || document.getElementById('graphics-btn')) return null;

  const wrap = document.createElement('div');
  wrap.id = 'graphics-control';
  wrap.innerHTML = `
    <button id="graphics-btn" type="button" aria-label="Graphics quality" aria-haspopup="true" aria-expanded="false">⚙</button>
    <div id="graphics-menu" class="hidden" role="menu">
      <div class="gm-title">GRAPHICS</div>
      ${OPTIONS.map(
        (o) => `<button type="button" role="menuitemradio" data-q="${o.value}" title="${o.hint}">${o.label}</button>`,
      ).join('\n      ')}
      <div class="gm-hint" id="graphics-hint"></div>
      <div class="gm-note">Applies on reload — antialiasing and terrain LOD are set at startup.</div>
    </div>`;
  host.appendChild(wrap);

  const btn = wrap.querySelector('#graphics-btn');
  const menu = wrap.querySelector('#graphics-menu');
  const hint = wrap.querySelector('#graphics-hint');

  const current = () => {
    const url = new URL(location.href).searchParams.get('quality');
    if (url) return url;
    const stored = readStored();
    return stored ?? 'auto';
  };

  const describe = () => {
    const v = current();
    const detected = window.__osfCapabilityTier ?? 'detecting…';
    // On Auto, the budget to show is the one that was ACTUALLY applied, not
    // the fallback. qualityToTier('auto') is null, and getBudget(null) returns
    // balanced as a safety net — so reading it naively produced the menu
    // claiming "Detected potato" directly above balanced's numbers. On a
    // workstation that is exactly the wrong thing to get wrong.
    const tier = v === 'auto' ? detected : qualityToTier(v);
    const b = getBudget(tier);
    // The budget is the thing a workstation owner actually wants to see. An
    // invisible cap is how "DPR is stuck at 2 on a 4K panel" goes unnoticed.
    hint.innerHTML =
      v === 'auto'
        ? `Detected <b>${detected}</b> · DPR ≤${b.pixelRatio} · ${b.maxTotalTiles} tiles · LOD ${b.lodThreshold}`
        : `Forced <b>${tier}</b> · DPR ≤${b.pixelRatio} · ${b.maxTotalTiles} tiles · LOD ${b.lodThreshold}`;
  };

  const sync = () => {
    const v = current();
    for (const b of wrap.querySelectorAll('[data-q]')) {
      const on = b.dataset.q === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    describe();
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('hidden') === false;
    btn.setAttribute('aria-expanded', String(open));
    if (open) sync();
  });

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    e.stopPropagation();
    writeStored(b.dataset.q);
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    onChange?.(b.dataset.q);
    location.href = withQuality(b.dataset.q);
  });

  // Click-away, so the menu cannot be left open over the HUD.
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target)) {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  sync();
  return { refresh: sync, current };
}

/**
 * Called before the renderer is built, so a stored preference becomes an
 * explicit override the probe can see. Without this, a choice made in one game
 * would sit in localStorage and do nothing.
 */
export function applyStoredQualityOverride() {
  const stored = readStored();
  if (!stored) return null;
  try {
    const url = new URL(location.href);
    // The URL wins: it is the more specific instruction.
    if (!url.searchParams.get('quality') && !url.searchParams.get('tier')) {
      url.searchParams.set('quality', stored);
      history.replaceState(null, '', url.toString());
    }
  } catch {
    /* non-browser */
  }
  return stored;
}
