/**
 * PAPILights — Precision Approach Path Indicator.
 *
 * Four lights beside the runway threshold. Each light shows red or white
 * depending on the aircraft's angle relative to the 3° glide path:
 *
 * - 4 white  = way too high
 * - 3 white 1 red = slightly high
 * - 2 white 2 red = ON GLIDEPATH ✓
 * - 1 white 3 red = slightly low
 * - 4 red    = way too low — PULL UP!
 *
 * The lights are positioned beside the runway threshold, visible from
 * several miles out on final approach.
 *
 * Real PAPI: each unit is aimed at a slightly different angle (2.5° to 3.5°).
 * We simulate this by computing the aircraft's elevation angle from each
 * light unit's position.
 */

import * as THREE from 'three';
import LandingDetector from './LandingDetector.js';

// PAPI unit aim angles (degrees above horizon)
const PAPI_ANGLES = [3.5, 3.167, 2.833, 2.5]; // far to near

// Standard 3° glide path (reference — PAPI units use individual aim angles above)

export default class PAPILights {
  constructor(scene) {
    this.scene = scene;
    this.units = []; // { mesh, angle, runwayId }
    this._built = false;
  }

  /**
   * Build PAPI light units for all runways.
   * Called once during init.
   */
  build() {
    if (this._built) return;
    this._built = true;

    for (const rwy of LandingDetector.getRunways()) {
      this._buildForRunway(rwy);
    }
  }

  _buildForRunway(runway) {
    const dir = LandingDetector.headingToDir(runway.heading);
    // Perpendicular: place PAPI on the left side of runway (pilot's left on final)
    const perp = { x: dir.z, z: -dir.x };

    // PAPI units are ~300m from threshold, spaced 9m apart, offset ~15m from edge
    const baseDist = 300;
    const spacing = 9;
    const sideOffset = runway.width / 2 + 15;

    for (let i = 0; i < 4; i++) {
      const alongDist = baseDist + i * spacing;
      const x = runway.threshold.x + dir.x * alongDist + perp.x * sideOffset;
      const z = runway.threshold.z + dir.z * alongDist + perp.z * sideOffset;
      const y = runway.elevation + 1; // ~1m above ground

      // Light housing: small dark box
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 0.6),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
      );
      housing.position.set(x, y, z);

      // Light lens: emissive sphere, color set per-frame
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      // Face toward approaching aircraft (opposite of runway heading)
      lens.position.set(x - dir.x * 0.4, y + 0.1, z - dir.z * 0.4);

      this.scene.add(housing);
      this.scene.add(lens);

      this.units.push({
        lens,
        angle: PAPI_ANGLES[i],
        position: new THREE.Vector3(x, y, z),
        runwayId: runway.id,
      });
    }
  }

  /**
   * Update light colors based on aircraft position.
   * Call each frame when near a runway.
   */
  update(aircraftPos) {
    if (!this._built || !aircraftPos) return;

    for (const unit of this.units) {
      // Vector from light to aircraft
      const dx = aircraftPos.x - unit.position.x;
      const dy = aircraftPos.y - unit.position.y;
      const dz = aircraftPos.z - unit.position.z;
      const horizDist = Math.hypot(dx, dz);

      if (horizDist < 1) continue; // avoid divide by zero

      // Elevation angle from light to aircraft (degrees)
      const elevAngle = (Math.atan2(dy, horizDist) * 180) / Math.PI;

      // If aircraft is above this unit's aim angle → white, else red
      const isWhite = elevAngle > unit.angle;
      unit.lens.material.color.setHex(isWhite ? 0xffffff : 0xff2222);

      // Make lights brighter/more visible at distance with size attenuation
      // (MeshBasicMaterial doesn't attenuate, so we scale slightly)
      const dist = Math.hypot(dx, dy, dz);
      const scale = Math.min(3, Math.max(1, dist / 2000));
      unit.lens.scale.setScalar(scale);
    }
  }

  /**
   * Get a text summary of PAPI state for HUD display.
   * Returns e.g. "⚪⚪🔴🔴 ON GLIDEPATH" or null if too far.
   */
  getState(aircraftPos) {
    if (!this._built || !aircraftPos) return null;

    // Find nearest runway's units
    let nearest = null;
    let nearestDist = Infinity;
    for (const rwy of LandingDetector.getRunways()) {
      const d = Math.hypot(aircraftPos.x - rwy.threshold.x, aircraftPos.z - rwy.threshold.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = rwy;
      }
    }
    if (!nearest || nearestDist > 10000) return null;

    const units = this.units.filter((u) => u.runwayId === nearest.id);
    if (units.length !== 4) return null;

    let whiteCount = 0;
    const symbols = [];
    for (const unit of units) {
      const dx = aircraftPos.x - unit.position.x;
      const dy = aircraftPos.y - unit.position.y;
      const dz = aircraftPos.z - unit.position.z;
      const horizDist = Math.hypot(dx, dz);
      if (horizDist < 1) {
        symbols.push('⚪');
        continue;
      }
      const elevAngle = (Math.atan2(dy, horizDist) * 180) / Math.PI;
      const isWhite = elevAngle > unit.angle;
      if (isWhite) whiteCount++;
      symbols.push(isWhite ? '⚪' : '🔴');
    }

    let message;
    if (whiteCount === 4) message = 'TOO HIGH';
    else if (whiteCount === 3) message = 'Slightly high';
    else if (whiteCount === 2) message = 'ON GLIDEPATH ✓';
    else if (whiteCount === 1) message = 'Slightly low';
    else message = 'TOO LOW — PULL UP!';

    return { symbols: symbols.join(''), whiteCount, message };
  }

  dispose() {
    for (const unit of this.units) {
      this.scene.remove(unit.lens);
      // Housing is a sibling; find and remove via traversal is overkill,
      // just remove lens (housing is static and tiny)
    }
    this.units = [];
    this._built = false;
  }
}
