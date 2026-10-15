#!/usr/bin/env python3
"""
run-batch.py — Generate a batch of randomized assets + manifest.

Usage:
    python3 run-batch.py --out /home/ubuntu/asset-factory/output --count 8
    python3 run-batch.py --out ./out --count 8 --seed 42

Each run appends to manifest.json (never overwrites existing entries).
"""
import argparse
import json
import os
import random
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

GENERATORS = [
    ("plane", "generate-plane.py"),
    ("building", "generate-building.py"),
    ("tree", "generate-tree.py"),
    ("boat", "generate-boat.py"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--count", type=int, default=8)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    manifest_path = os.path.join(args.out, "manifest.json")
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    else:
        manifest = {"batches": [], "assets": []}

    seed = args.seed if args.seed is not None else random.randint(1, 10 ** 9)
    rng = random.Random(seed)
    batch_id = f"batch-{int(time.time())}-{seed % 10000}"
    batch_assets = []

    for i in range(args.count):
        atype, script = rng.choice(GENERATORS)
        aseed = rng.randint(1, 10 ** 9)
        fname = f"{atype}-{aseed % 100000:05d}.json"
        fpath = os.path.join(args.out, fname)
        # skip if already exists (idempotent reruns)
        if os.path.exists(fpath):
            continue
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, script),
             "--style", "random", "--seed", str(aseed), "--out", fpath],
            capture_output=True, text=True)
        if r.returncode != 0:
            print(f"FAILED {script}: {r.stderr[:200]}", file=sys.stderr)
            continue
        print(r.stdout.strip())
        # read meta + tri count
        with open(fpath) as f:
            d = json.load(f)
        entry = {
            "file": fname,
            "type": d["meta"].get("type", atype),
            "style": d["meta"].get("style", "?"),
            "triangles": d["triangleCount"],
            "batch": batch_id,
            "seed": aseed,
        }
        batch_assets.append(entry)
        manifest["assets"].append(entry)

    manifest["batches"].append({
        "id": batch_id,
        "seed": seed,
        "count": len(batch_assets),
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=1)

    total_tris = sum(a["triangles"] for a in batch_assets)
    print(f"batch {batch_id}: {len(batch_assets)} assets, "
          f"{total_tris} tris total, manifest={manifest_path}")
    # warn on over-budget assets
    for a in batch_assets:
        if a["triangles"] > 5000:
            print(f"  WARNING: {a['file']} has {a['triangles']} tris (>5000 budget)")


if __name__ == "__main__":
    main()
