// LiveTraffic.js — Real ADS-B air traffic in the 3D world.
//
// Polls the traffic proxy Worker every 15s for aircraft near the player,
// spawns procedural 3D planes with airline liveries, and smoothly
// interpolates between position updates (dead reckoning).
//
// v1: mock data mode for testing, Worker proxy for live data.
// Attribution: "Live traffic data by adsb.fi" (required).

import * as THREE from 'three';
import { buildPlane } from '../aircraft/planes/PlaneFactory.js';

// --- Livery color schemes (MiniMax-designed) ---
const LIVERIES = {
  alaska: {
    name: 'Alaska Airlines',
    fuselage: 0x00395b,   // deep navy
    belly: 0xf4f2ec,      // cream
    tail: 0xefe3d2,       // eskimo-face cream
    cheatline: 0x009a8e,  // teal wave
    wing: 0xa8b0b5,
    engine: 0xe2e2dc,
  },
  delta: {
    name: 'Delta',
    fuselage: 0xffffff,   // white
    belly: 0xd8dce0,      // light gray
    tail: 0x003366,       // delta dark blue
    cheatline: 0xe01933,  // widget red
    wing: 0xa8b0b5,
    engine: 0xe8e8e8,
  },
  generic: {
    name: 'Generic',
    fuselage: 0xf0f0f0,   // white
    belly: 0xd0d0d0,
    tail: 0x666677,       // gray
    cheatline: 0x3366aa,  // blue stripe
    wing: 0xb0b5ba,
    engine: 0xe0e0e0,
  },
};

// Map ADS-B callsign prefixes to liveries
function pickLivery(callsign = '') {
  const cs = callsign.toUpperCase().trim();
  if (cs.startsWith('ASA') || cs.startsWith('ASQ') || cs.startsWith('QXE')) return 'alaska';
  if (cs.startsWith('DAL')) return 'delta';
  return 'generic';
}

// Map ADS-B aircraft type to model + scale
function pickModel(type = '') {
  const t = type.toUpperCase();
  if (/B73|A32|A33|B78|B76|A34|B77|E19/.test(t)) return { model: 'twinotter', scale: 4.0 };
  if (/DH8|AT7|SF3|C208|BE2|PC1/.test(t)) return { model: 'cub', scale: 2.0 };
  if (/C17|C13|P8/.test(t)) return { model: 'b17', scale: 3.5 };
  return { model: 'twinotter', scale: 3.0 }; // default airliner-ish
}

// Apply livery colors to a plane group by recoloring materials
function applyLivery(group, liveryKey) {
  const L = LIVERIES[liveryKey] || LIVERIES.generic;
  let i = 0;
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = obj.material;
    if (!mat || !mat.color) return;
    // Clone material so we don't affect shared materials
    obj.material = mat.clone();
    // Heuristic: recolor based on mesh position in the group
    // Tail fin (high Y, rear Z) → tail color
    // Lower fuselage → belly color
    // Wings (wide X) → wing color
    const pos = obj.position;
    if (pos.y > 1.5 && pos.z > 2) {
      obj.material.color.setHex(L.tail);
    } else if (pos.y < -0.5) {
      obj.material.color.setHex(L.belly);
    } else if (Math.abs(pos.x) > 3) {
      obj.material.color.setHex(L.wing);
    } else if (i % 5 === 0) {
      obj.material.color.setHex(L.cheatline);
    } else {
      obj.material.color.setHex(L.fuselage);
    }
    i++;
  });
  return L;
}

const POLL_INTERVAL = 15000;   // ms between API polls
const QUERY_RADIUS_NM = 100;   // query radius for the API
const SPAWN_RADIUS_NM = 50;    // only render within this distance
const MAX_PLANES = 12;         // iPad performance budget
const FT_TO_M = 0.3048;        // feet to meters
const KT_TO_MS = 0.514444;     // knots to m/s

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Mock traffic for testing without the Worker
function mockTraffic(centerLat, centerLon) {
  const now = Date.now() / 1000;
  return [
    { hex: 'mock1', flight: 'ASA61', lat: centerLat + 0.3, lon: centerLon - 0.4, alt_baro: 12000, gs: 320, track: 90, t: 'B739', seen_pos: 2 },
    { hex: 'mock2', flight: 'DAL853', lat: centerLat - 0.2, lon: centerLon + 0.5, alt_baro: 35000, gs: 450, track: 270, t: 'A223', seen_pos: 5 },
    { hex: 'mock3', flight: 'QXE2034', lat: centerLat + 0.1, lon: centerLon + 0.1, alt_baro: 8000, gs: 220, track: 180, t: 'DH8D', seen_pos: 1 },
  ];
}

export default class LiveTraffic {
  constructor(scene, terrain, options = {}) {
    this.scene = scene;
    this.terrain = terrain;       // GeoTerrainManager (has .tileMap)
    this.planes = new Map();      // hex -> entry
    this.enabled = options.enabled !== false;
    this.useMock = options.useMock || false;
    this.workerUrl = options.workerUrl || 'https://traffic.lucineer.com/api/traffic';
    this._timer = null;
    this._labels = new Map();
  }

  start() {
    if (this._timer) return;
    this.poll();
    this._timer = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.clear();
  }

  clear() {
    for (const [, entry] of this.planes) {
      this.scene.remove(entry.group);
      if (entry.label) this.scene.remove(entry.label);
    }
    this.planes.clear();
    this._labels.clear();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.clear();
    else this.poll();
  }

  async poll() {
    if (!this.enabled) return;
    try {
      const cam = this._getCamera();
      if (!cam) return;
      const geo = this.terrain.tileMap.world2geo(cam.position.clone());
      const lat = geo.y, lon = geo.x;

      let aircraft;
      if (this.useMock) {
        aircraft = mockTraffic(lat, lon);
      } else {
        const url = `${this.workerUrl}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=${QUERY_RADIUS_NM}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        aircraft = data.ac || [];
      }
      this.update(aircraft, lat, lon);
    } catch (e) {
      // Silent fail — traffic is enhancement, not core gameplay
      if (this.useMock) console.warn('[LiveTraffic] mock poll failed:', e.message);
    }
  }

  _getCamera() {
    // Prefer window.__osf in debug mode, fall back to scene camera
    if (window.__osf && window.__osf.flightController) {
      return window.__osf.flightController.camera || null;
    }
    return this._camera || null;
  }

  setCamera(cam) { this._camera = cam; }

  update(aircraft, playerLat, playerLon) {
    const seen = new Set();

    const sorted = aircraft
      .filter(a => a.lat != null && a.lon != null && (a.seen_pos || 0) < 30)
      .map(a => ({ ...a, distNm: haversineNm(playerLat, playerLon, a.lat, a.lon) }))
      .filter(a => a.distNm < SPAWN_RADIUS_NM)
      .sort((a, b) => a.distNm - b.distNm)
      .slice(0, MAX_PLANES);

    for (const ac of sorted) {
      seen.add(ac.hex);
      const worldPos = this.terrain.tileMap.geo2world(
        new THREE.Vector3(ac.lon, ac.lat, 0)
      );
      // Altitude: baro feet → meters. 'ground' = on ground.
      const altFt = ac.alt_baro === 'ground' ? 0 : (parseFloat(ac.alt_baro) || 0);
      worldPos.y = Math.max(0, altFt * FT_TO_M);

      let entry = this.planes.get(ac.hex);
      if (!entry) {
        // Spawn new plane
        const { model, scale } = pickModel(ac.t);
        const { group } = buildPlane(model);
        group.scale.setScalar(scale);
        const liveryKey = pickLivery(ac.flight);
        applyLivery(group, liveryKey);
        group.position.copy(worldPos);
        this.scene.add(group);

        // Callsign label (sprite)
        const label = this._makeLabel(ac.flight || ac.hex, altFt);
        label.position.copy(worldPos).y += 15 * scale;
        this.scene.add(label);

        entry = {
          group, label,
          target: worldPos.clone(),
          livery: LIVERIES[liveryKey].name,
          callsign: (ac.flight || '').trim(),
        };
        this.planes.set(ac.hex, entry);
      } else {
        entry.target.copy(worldPos);
        entry.label.position.copy(worldPos).y += 15 * entry.group.scale.x;
      }

      // Heading: ADS-B track is degrees from true north
      const trackDeg = parseFloat(ac.track) || 0;
      entry.group.rotation.y = THREE.MathUtils.degToRad(-trackDeg + 180);
    }

    // Remove planes that left the area
    for (const [hex, entry] of this.planes) {
      if (!seen.has(hex)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.label);
        this.planes.delete(hex);
      }
    }
  }

  _makeLabel(callsign, altFt) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#7df9ff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(callsign || '???', 128, 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px monospace';
    ctx.fillText(`FL${Math.round(altFt / 100)}`, 128, 52);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(60, 15, 1);
    return sprite;
  }

  tick(dt) {
    if (!this.enabled) return;
    // Smooth interpolation toward latest ADS-B position
    const k = Math.min(1, dt * 1.5);
    for (const [, entry] of this.planes) {
      entry.group.position.lerp(entry.target, k);
      entry.label.position.lerp(
        new THREE.Vector3(entry.target.x, entry.target.y + 15 * entry.group.scale.x, entry.target.z),
        k
      );
      // Face the sprite toward camera (sprites auto-face, but keep label above plane)
    }
  }

  get count() { return this.planes.size; }
}

export { LIVERIES, pickLivery };
