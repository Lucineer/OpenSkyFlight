/**
 * LandingDetector — detects touchdown and measures landing quality.
 *
 * Watches the aircraft state each frame. When the plane transitions from
 * airborne to ground contact near a runway, it captures the touchdown
 * parameters: vertical speed, bank angle, heading alignment, and position
 * relative to the runway.
 *
 * Runways are defined in local meters (origin at spawn, +X east, +Z south
 * in Three.js convention where -Z is north... see note below).
 *
 * Coordinate note: Three.js uses right-handed Y-up. In OpenSkyFlight,
 * -Z points north (forward = -Z), +X points east. Headings are compass
 * degrees (0 = north, 90 = east).
 */

import Logger from '../utils/Logger.js';

// Sitka Rocky Gutierrez Airport (PASI) — real runway 11/29
// Runway 11/29: 6,500 ft (1,981 m), headings 110°/290°
// Placed in local coords: threshold of runway 11 at origin-ish, extending
// toward 290° (west-northwest) for runway 29 departures.
const RUNWAYS = [
  {
    id: 'PASI-11',
    name: 'Sitka 11',
    // Threshold position (local meters)
    threshold: { x: 0, z: 0 },
    // Runway heading in degrees (direction of landing)
    heading: 110,
    // Runway dimensions in meters
    length: 1981,
    width: 46,
    // Elevation at threshold (meters above sea level)
    elevation: 8,
  },
  {
    id: 'PASI-29',
    name: 'Sitka 29',
    threshold: { x: 1700, z: -700 }, // opposite end
    heading: 290,
    length: 1981,
    width: 46,
    elevation: 8,
  },
];

// Challenge activation: within this distance (m) and below this altitude (m AGL)
const CHALLENGE_RADIUS_M = 9260; // 5 nm
const CHALLENGE_ALT_M = 610; // ~2000 ft

// Touchdown detection: consider "on ground" when within this height above runway
const GROUND_TOLERANCE_M = 3;

export default class LandingDetector {
  constructor(getGroundElevation) {
    this.getGroundElevation = getGroundElevation;
    this.wasAirborne = true;
    this.challengeActive = false;
    this.nearestRunway = null;
    this.onTouchdown = null; // callback(touchdownData)
    this._lastAlt = null;
  }

  /**
   * Convert compass heading (deg) to a unit direction vector in XZ plane.
   * 0° = north (-Z), 90° = east (+X).
   */
  static headingToDir(headingDeg) {
    const rad = ((headingDeg % 360) * Math.PI) / 180;
    return {
      x: Math.sin(rad),
      z: -Math.cos(rad),
    };
  }

  /**
   * Find the nearest runway to a position, or null if none within challenge radius.
   */
  findNearestRunway(pos) {
    let best = null;
    let bestDist = Infinity;
    for (const rwy of RUNWAYS) {
      const dx = pos.x - rwy.threshold.x;
      const dz = pos.z - rwy.threshold.z;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = rwy;
      }
    }
    return bestDist <= CHALLENGE_RADIUS_M ? { runway: best, distance: bestDist } : null;
  }

  /**
   * Project a position onto runway coordinates.
   * Returns { alongTrack: m from threshold, crossTrack: m from centerline (+ = right) }.
   */
  static projectOntoRunway(pos, runway) {
    const dir = LandingDetector.headingToDir(runway.heading);
    // Perpendicular (right of direction of travel)
    const perp = { x: -dir.z, z: dir.x };
    const dx = pos.x - runway.threshold.x;
    const dz = pos.z - runway.threshold.z;
    return {
      alongTrack: dx * dir.x + dz * dir.z,
      crossTrack: dx * perp.x + dz * perp.z,
    };
  }

  /**
   * Call each frame with the current aircraft state.
   * aircraftState: { position: Vector3, yaw, pitch, roll, ... }
   * vertSpeedMs: vertical speed in m/s (negative = descending)
   */
  tick(aircraftState, vertSpeedMs, _dt) {
    if (!aircraftState) return;

    const pos = aircraftState.position;

    // Update challenge state
    const near = this.findNearestRunway(pos);
    if (near) {
      const gnd = this.getGroundElevation(pos.x, pos.z);
      const agl = pos.y - Math.max(gnd, 0);
      this.challengeActive = agl < CHALLENGE_ALT_M;
      this.nearestRunway = near.runway;
    } else {
      this.challengeActive = false;
      this.nearestRunway = null;
    }

    // Touchdown detection (only when challenge is relevant)
    if (this.nearestRunway) {
      const rwy = this.nearestRunway;
      const gnd = this.getGroundElevation(pos.x, pos.z);
      const surfaceY = Math.max(gnd, 0) + rwy.elevation * 0; // runway at terrain level
      const heightAbove = pos.y - surfaceY;
      const isOnGround = heightAbove <= GROUND_TOLERANCE_M;

      if (this.wasAirborne && isOnGround && vertSpeedMs < -0.5) {
        // TOUCHDOWN!
        this._handleTouchdown(aircraftState, vertSpeedMs, rwy);
      }
      this.wasAirborne = !isOnGround;
    } else {
      // Reset when far from runway
      this.wasAirborne = true;
    }
  }

  _handleTouchdown(aircraftState, vertSpeedMs, runway) {
    const pos = aircraftState.position;
    const proj = LandingDetector.projectOntoRunway(pos, runway);

    // Heading alignment: difference between aircraft yaw and runway heading
    // yaw is in radians, convert to degrees. Three.js yaw: 0 = -Z (north).
    let yawDeg = ((-aircraftState.yaw * 180) / Math.PI) % 360;
    if (yawDeg < 0) yawDeg += 360;
    let headingDiff = Math.abs(yawDeg - runway.heading);
    if (headingDiff > 180) headingDiff = 360 - headingDiff;

    const touchdownData = {
      runway,
      // Vertical speed in feet per minute (positive = descent rate)
      vspeedFpm: Math.abs(vertSpeedMs) * 196.85,
      // Bank angle in degrees
      bankDeg: Math.abs(((aircraftState.roll || 0) * 180) / Math.PI),
      // Heading difference in degrees
      headingDiffDeg: headingDiff,
      // Position relative to runway
      alongTrackM: proj.alongTrack,
      crossTrackM: proj.crossTrack,
      // Derived
      inTouchdownZone: proj.alongTrack >= 0 && proj.alongTrack <= runway.length / 3,
      onRunway:
        proj.alongTrack >= -50 &&
        proj.alongTrack <= runway.length + 200 &&
        Math.abs(proj.crossTrack) <= runway.width / 2 + 30,
    };

    Logger.info(
      'Landing',
      `Touchdown: ${Math.round(touchdownData.vspeedFpm)} fpm, ` +
        `bank ${touchdownData.bankDeg.toFixed(1)}°, ` +
        `offset ${touchdownData.crossTrackM.toFixed(0)}m`,
    );

    if (this.onTouchdown) {
      this.onTouchdown(touchdownData);
    }
  }

  /**
   * Reset detector state (e.g., on respawn).
   */
  reset() {
    this.wasAirborne = true;
    this.challengeActive = false;
    this.nearestRunway = null;
  }

  static getRunways() {
    return RUNWAYS;
  }
}
