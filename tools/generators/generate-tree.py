#!/usr/bin/env python3
"""
generate-tree.py — Procedural Pacific Northwest conifers.

Styles: spruce, hemlock, snag (dead)
Usage:
    python3 generate-tree.py --style spruce --seed 7 --out out/tree-spruce-07.json

Y-up, origin at ground.
"""
import argparse
import math
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from geobuilder import GeoBuilder, _rgb


STYLES = ["spruce", "hemlock", "snag"]


def _needle_color(rng, snow):
    base = [
        (0.10, 0.28, 0.12),  # deep spruce green
        (0.14, 0.35, 0.16),
        (0.08, 0.22, 0.10),
    ]
    c = rng.choice(base)
    if rng.random() < snow:
        # dust with snow: lighten toward white
        t = rng.uniform(0.3, 0.7)
        c = tuple(v + (0.9 - v) * t for v in c)
    jitter = rng.uniform(-0.02, 0.02)
    return tuple(max(0.0, min(1.0, v + jitter)) for v in c)


def build_tree(style, rng):
    g = GeoBuilder()
    bark = _rgb("#4a3626")
    snow_amt = rng.uniform(0.0, 0.6)

    if style == "snag":
        h = rng.uniform(6, 12)
        # bare trunk with a few broken branches
        g.cylinder(0.25, 0.45, h, 7, bark,
                   GeoBuilder.mat_translate(0, h / 2, 0))
        for _ in range(rng.randint(3, 6)):
            a = rng.uniform(0, 2 * math.pi)
            by = rng.uniform(h * 0.4, h * 0.95)
            bl = rng.uniform(1.0, 2.5)
            br = GeoBuilder()
            br.cylinder(0.03, 0.09, bl, 5, bark)
            m = GeoBuilder.mat_mul(
                GeoBuilder.mat_translate(math.cos(a) * bl * 0.4, by, math.sin(a) * bl * 0.4),
                GeoBuilder.mat_mul(
                    GeoBuilder.mat_rot_y(a),
                    GeoBuilder.mat_rot_z(1.1 + rng.uniform(-0.2, 0.2))))
            # rotate branch to point outward: build along +Y then tilt
            br2 = GeoBuilder()
            br2.cylinder(0.03, 0.09, bl, 5, bark,
                         GeoBuilder.mat_mul(
                             GeoBuilder.mat_translate(0, bl / 2, 0),
                             GeoBuilder.mat_rot_z(math.pi / 2 - 0.5)))
            g.add_mesh(br2, GeoBuilder.mat_mul(
                GeoBuilder.mat_translate(0, by, 0),
                GeoBuilder.mat_rot_y(a)))
        g.meta = {"type": "tree", "style": style, "height": h}
        return g

    # --- live conifer ---
    h = rng.uniform(14, 28) if style == "spruce" else rng.uniform(10, 22)
    trunk_r = 0.28 + h * 0.012
    # trunk
    g.cylinder(trunk_r * 0.6, trunk_r, h * 0.45, 7, bark,
               GeoBuilder.mat_translate(0, h * 0.225, 0))

    # foliage: stacked cones, wider at bottom
    layers = rng.randint(5, 8)
    for li in range(layers):
        t = li / (layers - 1)  # 0 bottom -> 1 top
        y = h * 0.25 + t * h * 0.72
        # radius shrinks toward top
        r = (h * 0.16) * (1 - t * 0.75) * rng.uniform(0.9, 1.1)
        ch = h * 0.22
        segs = 8
        color = _needle_color(rng, snow_amt * (1 - t * 0.5))
        # cone with slight droop: use two stacked cones for fuller look
        cone = GeoBuilder()
        cone.cone(r, ch, segs, color,
                  GeoBuilder.mat_translate(0, y + ch * 0.3, 0))
        g.add_mesh(cone)
        if style == "hemlock" and li == layers - 1:
            # hemlock leader droops: small offset top cone
            top = GeoBuilder()
            top.cone(r * 0.35, ch * 0.5, segs, _needle_color(rng, snow_amt))
            g.add_mesh(top, GeoBuilder.mat_translate(rng.uniform(-0.3, 0.3),
                                                     y + ch * 0.7,
                                                     rng.uniform(-0.3, 0.3)))

    # snow cap on top
    if snow_amt > 0.25:
        cap = GeoBuilder()
        cap.cone(h * 0.035, h * 0.06, 8, _rgb("#eef2f5"))
        g.add_mesh(cap, GeoBuilder.mat_translate(0, h * 0.99, 0))

    g.meta = {"type": "tree", "style": style, "height": round(h, 1),
              "snow": round(snow_amt, 2)}
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="random", choices=STYLES + ["random"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--snow", type=float, default=None,
                    help="override snow 0..1")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    style = rng.choice(STYLES) if args.style == "random" else args.style
    g = build_tree(style, rng)
    d = g.save(args.out, name=f"tree-{style}-{args.seed}")
    print(f"wrote {args.out}: style={style} tris={d['triangleCount']}")


if __name__ == "__main__":
    main()
