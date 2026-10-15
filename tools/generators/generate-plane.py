#!/usr/bin/env python3
"""
generate-plane.py — Procedural airplane models.

Styles: bush, airliner, fighter, seaplane
Usage:
    python3 generate-plane.py --style bush --seed 7 --out out/plane-bush-07.json
    python3 generate-plane.py --style random --seed 3 --out out/plane.json

All dimensions in meters. Y-up, nose toward -Z.
"""
import argparse
import math
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from geobuilder import GeoBuilder, _rgb


STYLES = ["bush", "airliner", "fighter", "seaplane"]

# Paint schemes: (body, accent, wing)
SCHEMES = [
    ("#c8102e", "#ffffff", "#e8e8e8"),  # red/white
    ("#0a3d62", "#f5c518", "#dfe6ee"),  # navy/yellow
    ("#1a5c2a", "#ffffff", "#cfd8c8"),  # forest/white
    ("#e07b00", "#222222", "#f0e6d2"),  # orange/black
    ("#5b7fa6", "#ffffff", "#d7e3f0"),  # alaska blue
    ("#8b0000", "#d4af37", "#e8dcc0"),  # crimson/gold
]


def build_plane(style, rng):
    g = GeoBuilder()
    body_c = _rgb(rng.choice(SCHEMES)[0])
    accent_c = _rgb(rng.choice(SCHEMES)[1])
    wing_c = _rgb(rng.choice(SCHEMES)[2])
    dark = _rgb("#1a1a1a")
    glass = _rgb("#9fd8ef")

    if style == "bush":
        length, fus_r, wingspan = 8.5, 0.85, 11.0
        wing_chord, tail_size = 1.6, 1.0
    elif style == "airliner":
        length, fus_r, wingspan = 38.0, 2.0, 36.0
        wing_chord, tail_size = 5.5, 3.2
    elif style == "fighter":
        length, fus_r, wingspan = 15.0, 1.0, 10.5
        wing_chord, tail_size = 3.2, 1.6
    else:  # seaplane
        length, fus_r, wingspan = 10.5, 1.0, 14.0
        wing_chord, tail_size = 1.8, 1.2

    M = GeoBuilder.mat_translate
    # --- fuselage: tapered cylinder along Z (nose at -Z) ---
    segs = 10
    fus = GeoBuilder()
    for i in range(segs):
        t0, t1 = i / segs, (i + 1) / segs
        z0 = -length / 2 + t0 * length
        z1 = -length / 2 + t1 * length
        # radius profile: pointed nose, fat middle, tapered tail
        r0 = fus_r * math.sin(math.pi * (0.12 + 0.76 * t0)) ** 0.7
        r1 = fus_r * math.sin(math.pi * (0.12 + 0.76 * t1)) ** 0.7
        r0 = max(r0, 0.05)
        r1 = max(r1, 0.05)
        for s in range(8):
            a0 = 2 * math.pi * s / 8
            a1 = 2 * math.pi * (s + 1) / 8
            p00 = (math.cos(a0) * r0, math.sin(a0) * r0, z0)
            p01 = (math.cos(a1) * r0, math.sin(a1) * r0, z0)
            p10 = (math.cos(a0) * r1, math.sin(a0) * r1, z1)
            p11 = (math.cos(a1) * r1, math.sin(a1) * r1, z1)
            # outward winding (viewed from outside, CCW)
            fus.quad(p01, p00, p10, p11, body_c)
    # nose cap
    fus.tri((0, 0, -length / 2), (fus_r * 0.35, 0, -length / 2 + 0.4),
            (0, fus_r * 0.35, -length / 2 + 0.4), dark)
    g.add_mesh(fus)

    # --- cockpit glass ---
    cz = -length * 0.28
    g.box(fus_r * 1.1, fus_r * 0.7, length * 0.12, glass,
          M(0, fus_r * 0.75, cz))

    # --- main wing ---
    wz = length * 0.05 if style != "fighter" else -length * 0.05
    wy = fus_r * 0.35
    wing = GeoBuilder()
    # tapered wing: root chord -> tip chord
    root_c, tip_c = wing_chord, wing_chord * (0.45 if style == "fighter" else 0.7)
    hw = wingspan / 2
    for side in (-1, 1):
        x0, x1 = 0.0, side * hw
        wing.quad((x0, 0, wz - root_c / 2), (x0, 0, wz + root_c / 2),
                  (x1, 0.12 * side * side, wz + tip_c / 2 - 0.3 * abs(side)),
                  (x1, 0.12 * side * side, wz - tip_c / 2 - 0.3 * abs(side)), wing_c)
        # wingtip accent
        wing.box(0.5, 0.08, tip_c * 0.8, accent_c,
                 M(side * (hw - 0.25), 0.12, wz - 0.15))
    g.add_mesh(wing, M(0, wy, 0))

    # --- horizontal stabilizer ---
    tw = wingspan * 0.32
    tz = length / 2 - tail_size * 0.4
    ty = fus_r * (0.9 if style != "fighter" else 0.4)
    stab = GeoBuilder()
    stab.quad((-tw / 2, 0, tz - tail_size * 0.35), (-tw / 2, 0, tz + tail_size * 0.35),
              (tw / 2, 0, tz + tail_size * 0.35), (tw / 2, 0, tz - tail_size * 0.35), wing_c)
    g.add_mesh(stab, M(0, ty, 0))

    # --- vertical stabilizer ---
    fin = GeoBuilder()
    fh = tail_size * (1.6 if style == "fighter" else 1.1)
    fin.quad((0, 0, tz - tail_size * 0.5), (0, 0, tz + tail_size * 0.3),
             (0, fh, tz + tail_size * 0.05), (0, fh * 0.9, tz - tail_size * 0.35), accent_c)
    # give it thickness
    fin2 = GeoBuilder()
    fin2.add_mesh(fin, GeoBuilder.mat_translate(0.06, 0, 0))
    fin2.add_mesh(fin, GeoBuilder.mat_translate(-0.06, 0, 0))
    g.add_mesh(fin, M(0, ty, 0))
    g.add_mesh(fin2, M(0, ty, 0))

    # --- engines ---
    if style == "airliner":
        for side in (-1, 1):
            ex = side * wingspan * 0.28
            eng = GeoBuilder()
            eng.cylinder(fus_r * 0.55, fus_r * 0.5, 3.2, 10, dark,
                         GeoBuilder.mat_rot_x(math.pi / 2))
            eng.tri((0, 0, -1.7), (0.5, 0, -1.2), (0, 0.5, -1.2), _rgb("#333333"))
            g.add_mesh(eng, M(ex, wy - 0.8, wz))
    elif style == "fighter":
        # twin tail booms + afterburner
        g.cylinder(fus_r * 0.45, fus_r * 0.35, 2.0, 8, dark,
                   GeoBuilder.mat_mul(M(0, 0, length / 2 + 0.5),
                                       GeoBuilder.mat_rot_x(math.pi / 2)))
    else:
        # propeller
        prop = GeoBuilder()
        prop.box(0.12, fus_r * 2.6, 0.18, dark, M(0, 0, -length / 2 - 0.35))
        prop.box(fus_r * 2.6, 0.12, 0.18, dark, M(0, 0, -length / 2 - 0.35))
        g.add_mesh(prop)
        g.box(0.3, 0.3, 0.5, accent_c, M(0, 0, -length / 2 - 0.1))

    # --- landing gear / floats ---
    if style == "seaplane":
        for side in (-1, 1):
            fl = GeoBuilder()
            fl.tapered_box(0.5, 0.35, 1.0, 4.5, 3.8, accent_c)
            g.add_mesh(fl, M(side * 1.4, -fus_r - 1.1, 0))
            g.box(0.12, 1.0, 0.12, dark, M(side * 1.4, -fus_r - 0.3, 0.8))
            g.box(0.12, 1.0, 0.12, dark, M(side * 1.4, -fus_r - 0.3, -0.8))
    elif style == "bush":
        for side in (-1, 1):
            g.cylinder(0.42, 0.42, 0.3, 10, dark,
                       GeoBuilder.mat_mul(M(side * 1.3, -fus_r - 0.5, 0.5),
                                           GeoBuilder.mat_rot_z(math.pi / 2)))
            g.box(0.1, 1.0, 0.1, dark, M(side * 1.3, -fus_r, 0.5))
        # tail wheel
        g.sphere(0.22, 8, 6, dark, M(0, -fus_r - 0.1, length / 2 - 1.2))

    # --- accent stripe ---
    stripe = GeoBuilder()
    stripe.box(fus_r * 2.02, 0.28, length * 0.7, accent_c, M(0, 0.1, 0))
    g.add_mesh(stripe)

    g.meta = {
        "type": "plane",
        "style": style,
        "length": length,
        "wingspan": wingspan,
    }
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="random",
                    choices=STYLES + ["random"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    style = rng.choice(STYLES) if args.style == "random" else args.style
    g = build_plane(style, rng)
    d = g.save(args.out, name=f"plane-{style}-{args.seed}")
    print(f"wrote {args.out}: style={style} tris={d['triangleCount']}")


if __name__ == "__main__":
    main()
