#!/usr/bin/env python3
"""
Motion Tile 01 — "Akira Slide" (sideslip) track generator.

Generates FlightRecorder-format keyframe tracks ({version:1, keyframes:[{t,
pos:[x,y,z], quat:[x,y,z,w]}]}) where the ghost plane slides sideways: the nose
holds a fixed yaw offset (slipAngle) from the direction of travel for a fixed
distance, with smooth transitions in and out.

Engine conventions (must match js/camera/FlightController.js + app.js):
  - forward = -Z applied to the quaternion
  - Euler order 'YXZ', euler = (pitch=x, yaw=y, roll=z)
  - yaw(v) = atan2(-v.x, -v.z)   (same as FlightPlan._getYawAtT / update)
  - keyframes at 10 Hz (matches FlightRecorder SAMPLE_INTERVAL_MS=100)

Positive slipAngle = nose held LEFT of the track.
Roll (bank) is cosmetic, into the slip, for the drama.

Variants (per the honing plan in the design doc):
  A "subtle"   — 20 deg slip, 50 m hold
  B "classic"  — 34 deg slip, 50 m hold
  C "dramatic" — 45 deg slip, 80 m hold
"""

import json
import math
import os

# ---------------------------------------------------------------- math helpers

def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )

def quat_from_euler_yxz(pitch, yaw, roll):
    """Match THREE.Euler(pitch, yaw, roll, 'YXZ') -> Quaternion.setFromEuler."""
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    cx, sx = math.cos(pitch / 2), math.sin(pitch / 2)
    cz, sz = math.cos(roll / 2), math.sin(roll / 2)
    qy = (0.0, sy, 0.0, cy)
    qx = (sx, 0.0, 0.0, cx)
    qz = (0.0, 0.0, sz, cz)
    return quat_mul(quat_mul(qy, qx), qz)

def quat_rotate(q, v):
    """Rotate vector v by unit quaternion q (x,y,z,w)."""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    # v' = v + w*t + cross(q.xyz, t)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )

def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

def angle_between(a, b):
    dot = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    return math.acos(dot)

# ---------------------------------------------------------------- generation

PATH_YAW = math.atan2(-1.0, -0.0)  # yaw for travel along +X  (= -pi/2)
SPEED = 45.0          # m/s, constant (arc-length parameterization equivalent)
ALTITUDE = 300.0      # m, well above the 60 m safety floor
SAMPLE_DT = 0.1       # s, 10 Hz like FlightRecorder
APPROACH_S = 1.5
TRANSITION_S = 1.0
RECOVER_S = 1.5
BANK_VISUAL = 0.35    # rad, cosmetic roll into the slip

def generate(slip_angle_rad, hold_distance_m, name):
    hold_s = hold_distance_m / SPEED
    total_s = APPROACH_S + TRANSITION_S + hold_s + TRANSITION_S + RECOVER_S
    n = int(round(total_s / SAMPLE_DT)) + 1

    def slip_envelope(t):
        t1 = APPROACH_S
        t2 = t1 + TRANSITION_S
        t3 = t2 + hold_s
        t4 = t3 + TRANSITION_S
        if t < t1:
            return 0.0
        if t < t2:
            return slip_angle_rad * smoothstep((t - t1) / TRANSITION_S)
        if t < t3:
            return slip_angle_rad
        if t < t4:
            return slip_angle_rad * (1 - smoothstep((t - t3) / TRANSITION_S))
        return 0.0

    keyframes = []
    for i in range(n):
        t = round(i * SAMPLE_DT, 3)
        x = SPEED * t
        slip = slip_envelope(t)
        yaw = PATH_YAW + slip
        # cosmetic bank scales with the slip envelope
        roll = BANK_VISUAL * (slip / slip_angle_rad) if slip_angle_rad else 0.0
        q = quat_from_euler_yxz(0.0, yaw, roll)
        nq = math.sqrt(sum(c * c for c in q))
        q = tuple(c / nq for c in q)
        keyframes.append({
            "t": t,
            "pos": [round(x, 3), ALTITUDE, 0.0],
            "quat": [round(c, 6) for c in q],
        })

    return {
        "version": 1,
        "kind": "motion-tile",
        "name": name,
        "params": {
            "slipAngleRad": slip_angle_rad,
            "slipAngleDeg": round(math.degrees(slip_angle_rad), 1),
            "holdDistanceM": hold_distance_m,
            "speedMps": SPEED,
            "altitudeM": ALTITUDE,
            "bankVisualRad": BANK_VISUAL,
            "durationS": round(total_s, 2),
        },
        # composition contract: entry/exit conditions for chaining tiles
        "entry": {"speedMps": SPEED, "yawRad": round(PATH_YAW, 4), "altitudeM": ALTITUDE},
        "exit": {"speedMps": SPEED, "yawRad": round(PATH_YAW, 4), "altitudeM": ALTITUDE},
        "keyframes": keyframes,
    }

# ---------------------------------------------------------------- verification

def verify(track):
    """Numerically verify the slip geometry. Raises AssertionError on failure."""
    kf = track["keyframes"]
    params = track["params"]
    slip_target = params["slipAngleRad"]
    hold_s = params["holdDistanceM"] / params["speedMps"]
    t_hold0 = APPROACH_S + TRANSITION_S
    t_hold1 = t_hold0 + hold_s

    assert len(kf) >= 2, "need >= 2 keyframes"
    # times strictly increasing, start at 0
    assert kf[0]["t"] == 0.0
    for a, b in zip(kf, kf[1:]):
        assert b["t"] > a["t"], "times must increase"

    # all quats normalized, positions finite, altitude constant
    for k in kf:
        nq = math.sqrt(sum(c * c for c in k["quat"]))
        assert abs(nq - 1.0) < 1e-4, f"quat not normalized: {nq}"
        assert all(math.isfinite(v) for v in k["pos"]), "non-finite position"
        assert k["pos"][1] == ALTITUDE, "altitude must be constant"
        assert k["pos"][1] >= 60.0, "below safety floor"

    # nose-vs-track angle: ~0 outside the slide, ~slipAngle during the hold
    worst_hold_err = 0.0
    for i in range(1, len(kf) - 1):
        t = kf[i]["t"]
        # velocity via central difference
        v = (
            kf[i + 1]["pos"][0] - kf[i - 1]["pos"][0],
            kf[i + 1]["pos"][1] - kf[i - 1]["pos"][1],
            kf[i + 1]["pos"][2] - kf[i - 1]["pos"][2],
        )
        nv = math.sqrt(sum(c * c for c in v))
        v = tuple(c / nv for c in v)
        nose = quat_rotate(tuple(kf[i]["quat"]), (0.0, 0.0, -1.0))
        ang = angle_between(nose, v)
        if t_hold0 + 0.3 <= t <= t_hold1 - 0.3:  # settled hold region
            worst_hold_err = max(worst_hold_err, abs(ang - slip_target))
        elif t < APPROACH_S - 0.2 or t > t_hold1 + TRANSITION_S + 0.3:
            assert ang < 0.05, f"nose off track outside slide: t={t} ang={math.degrees(ang):.1f}deg"

    assert worst_hold_err < math.radians(2.0), (
        f"hold slip off target by {math.degrees(worst_hold_err):.2f} deg"
    )

    # constant speed check (arc-length equivalent on a straight path)
    for a, b in zip(kf, kf[1:]):
        dx = b["pos"][0] - a["pos"][0]
        dt = b["t"] - a["t"]
        assert abs(dx / dt - SPEED) < 1e-6, "speed not constant"

    return {
        "keyframes": len(kf),
        "durationS": kf[-1]["t"],
        "worstHoldErrDeg": round(math.degrees(worst_hold_err), 3),
    }

# ---------------------------------------------------------------- main

VARIANTS = [
    ("A", "subtle", math.radians(20), 50),
    ("B", "classic", math.radians(34), 50),
    ("C", "dramatic", math.radians(45), 80),
]

if __name__ == "__main__":
    outdir = os.environ.get("TILE_OUTDIR", "/tmp/tilegen/out")
    os.makedirs(outdir, exist_ok=True)
    for tag, label, slip, hold in VARIANTS:
        name = f"tile-01-akira-sideslip-{tag}-{label}"
        track = generate(slip, hold, name)
        report = verify(track)
        path = os.path.join(outdir, f"{name}.json")
        with open(path, "w") as f:
            json.dump(track, f)
        print(f"OK {name}: {report['keyframes']} keyframes, "
              f"{report['durationS']:.1f}s, hold slip error {report['worstHoldErrDeg']} deg -> {path}")
