#!/usr/bin/env python3
"""
generate-boat.py — Procedural boats for Sitka harbor.

Styles: fishing, sailboat, skiff
Usage:
    python3 generate-boat.py --style fishing --seed 7 --out out/boat-fishing-07.json

Y-up, origin at waterline center. Bow toward -Z.
"""
import argparse
import math
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from geobuilder import GeoBuilder, _rgb


STYLES = ["fishing", "sailboat", "skiff"]

HULL_COLORS = ["#ffffff", "#2a5a8a", "#b8452e", "#1a1a1a", "#3e6b4a"]
TRIM_COLORS = ["#d4af37", "#ffffff", "#c8102e"]


def _hull(g, length, beam, depth, color, rng):
    """Carvel hull from lofted sections. Bow at -Z."""
    sections = 8
    half = GeoBuilder()
    for i in range(sections):
        t0, t1 = i / sections, (i + 1) / sections
        z0 = -length / 2 + t0 * length
        z1 = -length / 2 + t1 * length
        # beam profile: narrow at bow/stern, wide amidships
        w0 = beam / 2 * math.sin(math.pi * (0.08 + 0.84 * t0)) ** 0.6
        w1 = beam / 2 * math.sin(math.pi * (0.08 + 0.84 * t1)) ** 0.6
        w0, w1 = max(w0, 0.05), max(w1, 0.05)
        # sheer rises at bow
        sheer0 = depth * 0.35 * (t0 ** 3) * 4
        sheer1 = depth * 0.35 * (t1 ** 3) * 4
        y_top0, y_top1 = depth / 2 + sheer0, depth / 2 + sheer1
        y_bot = -depth / 2
        # cross-section: chine (w,y_bot) -> sheer (w*0.92, y_top)
        for side in (-1, 1):
            # side plank (outward winding)
            if side < 0:
                half.quad((side * w0, y_bot, z0), (side * w1, y_bot, z1),
                          (side * w1 * 0.92, y_top1, z1), (side * w0 * 0.92, y_top0, z0),
                          color)
            else:
                half.quad((side * w1, y_bot, z1), (side * w0, y_bot, z0),
                          (side * w0 * 0.92, y_top0, z0), (side * w1 * 0.92, y_top1, z1),
                          color)
        # bottom plank
        half.quad((-w0, y_bot, z0), (w0, y_bot, z0),
                  (w1, y_bot, z1), (-w1, y_bot, z1), color)
    # transom (stern cap)
    zt = length / 2
    wt = beam / 2 * math.sin(math.pi * 0.92) ** 0.6
    half.quad((-wt, -depth / 2, zt), (wt, -depth / 2, zt),
              (wt * 0.92, depth / 2, zt), (-wt * 0.92, depth / 2, zt), color)
    # deck
    deck = GeoBuilder()
    deck.box(beam * 0.8, 0.08, length * 0.86, _rgb("#8a6a4a"),
             GeoBuilder.mat_translate(0, depth / 2 - 0.05, 0))
    # gunwale trim
    trim_c = _rgb(rng.choice(TRIM_COLORS))
    for side in (-1, 1):
        rail = GeoBuilder()
        rail.box(0.12, 0.12, length * 0.9, trim_c)
        g.add_mesh(rail, GeoBuilder.mat_translate(side * beam * 0.42, depth / 2 + 0.1, 0))
    g.add_mesh(half)
    g.add_mesh(deck)


def build_boat(style, rng):
    g = GeoBuilder()
    hull_c = _rgb(rng.choice(HULL_COLORS))
    cabin_c = _rgb("#e8e4d8")
    dark = _rgb("#222222")

    if style == "fishing":
        length, beam, depth = 12.0, 3.8, 1.8
        _hull(g, length, beam, depth, hull_c, rng)
        # wheelhouse
        ww, wh, wd = 2.6, 2.2, 2.8
        wz = length * 0.12
        g.box(ww, wh, wd, cabin_c,
              GeoBuilder.mat_translate(0, depth / 2 + wh / 2, wz))
        # wheelhouse roof
        g.box(ww + 0.4, 0.15, wd + 0.4, _rgb("#4a4a4a"),
              GeoBuilder.mat_translate(0, depth / 2 + wh + 0.1, wz))
        # windows
        glass = _rgb("#9fd8ef")
        g.box(ww * 0.8, 0.6, 0.06, glass,
              GeoBuilder.mat_translate(0, depth / 2 + wh * 0.7, wz - wd / 2 - 0.02))
        # mast + boom
        g.cylinder(0.09, 0.12, 6.5, 8, _rgb("#6b4a2f"),
                   GeoBuilder.mat_translate(0, depth / 2 + 3.2, -length * 0.28))
        g.cylinder(0.06, 0.06, 4.5, 6, _rgb("#6b4a2f"),
                   GeoBuilder.mat_mul(
                       GeoBuilder.mat_translate(0, depth / 2 + 5.2, -length * 0.28 + 2.0),
                       GeoBuilder.mat_rot_x(math.pi / 2 - 0.15)))
        # stern working deck: crates + coiled rope
        for i in range(rng.randint(2, 4)):
            cx = rng.uniform(-1, 1)
            cz = rng.uniform(length * 0.2, length * 0.38)
            g.box(0.8, 0.6, 0.8, _rgb("#8a6a3a"),
                  GeoBuilder.mat_translate(cx, depth / 2 + 0.3, cz))
        # exhaust stack
        g.cylinder(0.18, 0.18, 1.6, 8, dark,
                   GeoBuilder.mat_translate(0.8, depth / 2 + wh + 0.8, wz + 0.8))

    elif style == "sailboat":
        length, beam, depth = 9.5, 3.0, 1.5
        _hull(g, length, beam, depth, hull_c, rng)
        # cabin trunk
        g.box(beam * 0.6, 0.9, length * 0.35, cabin_c,
              GeoBuilder.mat_translate(0, depth / 2 + 0.45, length * 0.05))
        # mast
        mast_h = 12.0
        g.cylinder(0.08, 0.12, mast_h, 8, _rgb("#8a6a4a"),
                   GeoBuilder.mat_translate(0, depth / 2 + mast_h / 2, -0.5))
        # boom
        g.cylinder(0.05, 0.05, 4.2, 6, _rgb("#8a6a4a"),
                   GeoBuilder.mat_mul(
                       GeoBuilder.mat_translate(0, depth / 2 + 2.2, 1.6),
                       GeoBuilder.mat_rot_x(math.pi / 2)))
        # furled sail on boom
        sail = GeoBuilder()
        sail.tapered_box(0.35, 0.25, 0.5, 4.0, 3.6, _rgb("#e8e4d8"))
        g.add_mesh(sail, GeoBuilder.mat_translate(0, depth / 2 + 2.0, 1.6))
        # bow rail
        g.box(0.06, 0.7, 2.0, dark,
              GeoBuilder.mat_translate(0, depth / 2 + 0.35, -length / 2 + 1.2))

    else:  # skiff
        length, beam, depth = 5.5, 2.0, 0.9
        _hull(g, length, beam, depth, hull_c, rng)
        # center console
        g.box(0.7, 1.0, 0.6, cabin_c,
              GeoBuilder.mat_translate(0, depth / 2 + 0.5, 0.3))
        # outboard motor
        g.box(0.35, 0.9, 0.3, dark,
              GeoBuilder.mat_translate(0, depth / 2 + 0.2, length / 2 - 0.2))
        # benches
        for z in (-1.2, 1.0):
            g.box(beam * 0.7, 0.08, 0.4, _rgb("#8a6a4a"),
                  GeoBuilder.mat_translate(0, depth / 2 + 0.1, z))

    g.meta = {"type": "boat", "style": style, "length": length}
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="random", choices=STYLES + ["random"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    style = rng.choice(STYLES) if args.style == "random" else args.style
    g = build_boat(style, rng)
    d = g.save(args.out, name=f"boat-{style}-{args.seed}")
    print(f"wrote {args.out}: style={style} tris={d['triangleCount']}")


if __name__ == "__main__":
    main()
