#!/usr/bin/env python3
"""
generate-building.py — Procedural Sitka-style buildings.

Styles: house, dock, warehouse, church, cannery
Usage:
    python3 generate-building.py --style house --seed 7 --out out/bldg-house-07.json

Y-up, origin at ground center of footprint.
"""
import argparse
import math
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from geobuilder import GeoBuilder, _rgb


STYLES = ["house", "dock", "warehouse", "church", "cannery"]

WALL_COLORS = ["#d8cfc0", "#b8452e", "#3e6b8a", "#e8e0d0", "#7a8b99", "#a63d2f"]
ROOF_COLORS = ["#4a4a4a", "#6b3a2a", "#2e4a5a", "#5a5a5a"]
TRIM = "#f5f0e6"
WOOD = "#6b4a2f"
WOOD_DARK = "#4a3220"


def _gable_roof(g, w, h, d, y_base, color, rng):
    """Gable roof: ridge along Z."""
    roof = GeoBuilder()
    over = 0.4
    x, z = w / 2 + over, d / 2 + over
    roof.tri((-x, 0, -z), (x, 0, -z), (0, h, -z), color)
    roof.tri((-x, 0, z), (0, h, z), (x, 0, z), color)
    roof.quad((-x, 0, -z), (-x, 0, z), (0, h, z), (0, h, -z), color)
    roof.quad((x, 0, -z), (0, h, -z), (0, h, z), (x, 0, z), color)
    g.add_mesh(roof, GeoBuilder.mat_translate(0, y_base, 0))


def _windows(g, w, h, d, y0, wall_c, rng):
    glass = _rgb("#9fd8ef")
    frame = _rgb(TRIM)
    # front/back windows
    n = max(1, int(w / 2.5))
    for i in range(n):
        x = -w / 2 + (i + 0.5) * (w / n)
        for zside, z in ((-1, -d / 2 - 0.02), (1, d / 2 + 0.02)):
            g.box(0.9, 1.1, 0.06, frame,
                  GeoBuilder.mat_translate(x, y0 + h * 0.55, z))
            g.box(0.7, 0.9, 0.08, glass,
                  GeoBuilder.mat_translate(x, y0 + h * 0.55, z))
    # door on front
    g.box(1.0, 2.1, 0.08, _rgb(WOOD_DARK),
          GeoBuilder.mat_translate(0, y0 + 1.05, d / 2 + 0.02))


def build_building(style, rng):
    g = GeoBuilder()
    wall_c = _rgb(rng.choice(WALL_COLORS))
    roof_c = _rgb(rng.choice(ROOF_COLORS))
    wood_c = _rgb(WOOD)

    if style == "house":
        w = rng.uniform(6, 9)
        d = rng.uniform(7, 11)
        h = rng.uniform(3.2, 4.5)
        # foundation
        g.box(w + 0.4, 0.6, d + 0.4, _rgb("#8a8a8a"),
              GeoBuilder.mat_translate(0, 0.3, 0))
        g.box(w, h, d, wall_c, GeoBuilder.mat_translate(0, 0.6 + h / 2, 0))
        _gable_roof(g, w, rng.uniform(1.8, 2.8), d, 0.6 + h, roof_c, rng)
        _windows(g, w, h, d, 0.6, wall_c, rng)
        # chimney
        g.box(0.7, 1.8, 0.7, _rgb("#7a4a3a"),
              GeoBuilder.mat_translate(w * 0.25, 0.6 + h + 1.6, -d * 0.2))

    elif style == "dock":
        w = rng.uniform(4, 6)
        length = rng.uniform(18, 30)
        deck_y = rng.uniform(1.2, 1.8)
        # pilings
        n_pile = int(length / 3)
        for i in range(n_pile + 1):
            z = -length / 2 + i * (length / n_pile)
            for x in (-w / 2 + 0.3, w / 2 - 0.3):
                g.cylinder(0.18, 0.18, deck_y + 1.0, 6, _rgb(WOOD_DARK),
                           GeoBuilder.mat_translate(x, (deck_y - 1.0) / 2, z))
        # deck planks
        g.box(w, 0.15, length, wood_c,
              GeoBuilder.mat_translate(0, deck_y, 0))
        # railings
        for x in (-w / 2 + 0.1, w / 2 - 0.1):
            g.box(0.08, 1.0, length, wood_c,
                  GeoBuilder.mat_translate(x, deck_y + 0.5, 0))
            g.box(0.08, 0.08, length, wood_c,
                  GeoBuilder.mat_translate(x, deck_y + 1.0, 0))
        # small shed at end
        sw = 2.5
        g.box(sw, 2.2, 3.0, wall_c,
              GeoBuilder.mat_translate(0, deck_y + 1.1, -length / 2 + 2.5))
        _gable_roof(g, sw, 1.0, 3.0, deck_y + 2.2, roof_c, rng)

    elif style == "warehouse":
        w = rng.uniform(12, 20)
        d = rng.uniform(10, 16)
        h = rng.uniform(5, 8)
        g.box(w, h, d, wall_c, GeoBuilder.mat_translate(0, h / 2, 0))
        # gambrel-ish roof: two slopes
        roof = GeoBuilder()
        x, z = w / 2 + 0.5, d / 2 + 0.5
        rh = rng.uniform(2.5, 4)
        roof.tri((-x, 0, -z), (x, 0, -z), (0, rh, -z), roof_c)
        roof.tri((-x, 0, z), (0, rh, z), (x, 0, z), roof_c)
        roof.quad((-x, 0, -z), (-x, 0, z), (0, rh, z), (0, rh, -z), roof_c)
        roof.quad((x, 0, -z), (0, rh, -z), (0, rh, z), (x, 0, z), roof_c)
        g.add_mesh(roof, GeoBuilder.mat_translate(0, h, 0))
        # big sliding door
        g.box(3.5, 4.0, 0.1, _rgb(WOOD_DARK),
              GeoBuilder.mat_translate(0, 2.0, d / 2 + 0.03))
        # small high windows
        for i in range(max(2, int(w / 4))):
            x = -w / 2 + (i + 0.5) * (w / max(2, int(w / 4)))
            g.box(1.0, 0.8, 0.08, _rgb("#9fd8ef"),
                  GeoBuilder.mat_translate(x, h - 1.2, d / 2 + 0.02))

    elif style == "church":
        w = rng.uniform(7, 9)
        d = rng.uniform(12, 16)
        h = rng.uniform(4, 5.5)
        g.box(w, h, d, _rgb("#f0ead8"),
              GeoBuilder.mat_translate(0, h / 2, 0))
        _gable_roof(g, w, 2.5, d, h, _rgb("#4a4a4a"), rng)
        # steeple
        sw = 2.2
        sh = rng.uniform(6, 9)
        sz = -d / 2 + 1.5
        g.box(sw, sh, sw, _rgb("#f0ead8"),
              GeoBuilder.mat_translate(0, h + sh / 2, sz))
        g.cone(sw * 0.75, 2.5, 4, _rgb("#4a4a4a"),
               GeoBuilder.mat_translate(0, h + sh + 1.25, sz))
        # cross
        g.box(0.12, 1.2, 0.12, _rgb("#d4af37"),
              GeoBuilder.mat_translate(0, h + sh + 3.0, sz))
        g.box(0.7, 0.12, 0.12, _rgb("#d4af37"),
              GeoBuilder.mat_translate(0, h + sh + 3.1, sz))
        # arched windows
        for i in range(3):
            z = -d / 2 + 3 + i * 4
            for x in (-w / 2 - 0.02, w / 2 + 0.02):
                g.box(0.06, 2.0, 1.2, _rgb("#9fd8ef"),
                      GeoBuilder.mat_translate(x, 2.5, z))

    else:  # cannery
        w = rng.uniform(14, 22)
        d = rng.uniform(10, 14)
        h = rng.uniform(4, 6)
        g.box(w, h, d, _rgb("#a63d2f"),
              GeoBuilder.mat_translate(0, h / 2, 0))
        # sawtooth roof
        teeth = max(2, int(w / 5))
        for i in range(teeth):
            x0 = -w / 2 + i * (w / teeth)
            x1 = x0 + w / teeth
            roof = GeoBuilder()
            roof.quad((x0, 0, -d / 2), (x0, 0, d / 2),
                      (x1, 1.8, d / 2), (x1, 1.8, -d / 2), roof_c)
            roof.tri((x0, 0, -d / 2), (x1, 1.8, -d / 2), (x0, 0, -d / 2), roof_c)
            g.add_mesh(roof, GeoBuilder.mat_translate(0, h, 0))
        # smokestack
        g.cylinder(0.8, 1.0, 12, 10, _rgb("#3a3a3a"),
                   GeoBuilder.mat_translate(w * 0.3, h + 6, 0))
        # loading dock door
        g.box(4, 3.5, 0.1, _rgb(WOOD_DARK),
              GeoBuilder.mat_translate(-w / 4, 1.75, d / 2 + 0.03))

    g.meta = {"type": "building", "style": style}
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="random", choices=STYLES + ["random"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    style = rng.choice(STYLES) if args.style == "random" else args.style
    g = build_building(style, rng)
    d = g.save(args.out, name=f"building-{style}-{args.seed}")
    print(f"wrote {args.out}: style={style} tris={d['triangleCount']}")


if __name__ == "__main__":
    main()
