"""
geobuilder.py — Minimal procedural geometry toolkit.

Builds indexed triangle meshes with vertex colors, designed for:
  - Zero external dependencies (stdlib only)
  - ARM Linux / headless operation
  - Output loadable by Three.js via ProceduralAssetLoader.js

Conventions:
  - Units are meters. Y is up.
  - Colors are per-vertex RGB floats 0..1.
  - All primitives append into a single indexed mesh (one draw call).
"""

import math
import json


def _rgb(hex_str):
    """'#rrggbb' -> (r, g, b) floats."""
    h = hex_str.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


class GeoBuilder:
    def __init__(self):
        self.positions = []   # flat xyz
        self.normals = []     # flat xyz (computed at finalize)
        self.colors = []      # flat rgb
        self.indices = []
        self._face_data = []  # (v0, v1, v2, color) for normal computation
        self.meta = {}

    # ---------- low level ----------

    def _vert(self, p, color):
        self.positions.extend(p)
        self.colors.extend(color)
        return len(self.positions) // 3 - 1

    def tri(self, a, b, c, color):
        """Add a triangle from 3 xyz tuples."""
        i0 = self._vert(a, color)
        i1 = self._vert(b, color)
        i2 = self._vert(c, color)
        self.indices.extend((i0, i1, i2))
        self._face_data.append((a, b, c))

    def quad(self, a, b, c, d, color):
        """Quad a-b-c-d (counter-clockwise when viewed from outside)."""
        self.tri(a, b, c, color)
        self.tri(a, c, d, color)

    # ---------- transforms ----------

    @staticmethod
    def _xform(p, m):
        x, y, z = p
        return (
            m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11],
        )

    @staticmethod
    def mat_translate(tx, ty, tz):
        return (1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz)

    @staticmethod
    def mat_scale(sx, sy, sz):
        return (sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0)

    @staticmethod
    def mat_rot_x(a):
        c, s = math.cos(a), math.sin(a)
        return (1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0)

    @staticmethod
    def mat_rot_y(a):
        c, s = math.cos(a), math.sin(a)
        return (c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0)

    @staticmethod
    def mat_rot_z(a):
        c, s = math.cos(a), math.sin(a)
        return (c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0)

    @staticmethod
    def mat_mul(a, b):
        """Return a*b (apply b first, then a). 3x4 row-major affine."""
        out = [0.0] * 12
        for r in range(3):
            for c in range(4):
                v = 0.0
                for k in range(3):
                    v += a[r * 4 + k] * b[k * 4 + c]
                if c == 3:
                    v += a[r * 4 + 3]
                out[r * 4 + c] = v
        return tuple(out)

    def add_mesh(self, other, matrix=None):
        """Merge another GeoBuilder's faces, optionally transformed."""
        base = len(self.positions) // 3
        if matrix is None:
            self.positions.extend(other.positions)
            self.colors.extend(other.colors)
        else:
            for i in range(0, len(other.positions), 3):
                p = self._xform(other.positions[i:i + 3], matrix)
                self.positions.extend(p)
            self.colors.extend(other.colors)
        for i in other.indices:
            self.indices.append(base + i)
        if matrix is None:
            self._face_data.extend(other._face_data)
        else:
            for (a, b, c) in other._face_data:
                self._face_data.append((
                    self._xform(a, matrix),
                    self._xform(b, matrix),
                    self._xform(c, matrix),
                ))

    # ---------- primitives ----------

    def box(self, w, h, d, color, matrix=None):
        """Axis-aligned box centered at origin."""
        x, y, z = w / 2, h / 2, d / 2
        v = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
             (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
        faces = [(0, 1, 2, 3), (4, 6, 5), (4, 7, 6),  # -z, +z... (winding fixed below)
                 (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        # Correct outward winding:
        quads = [
            (v[0], v[3], v[2], v[1]),  # -z
            (v[4], v[5], v[6], v[7]),  # +z
            (v[0], v[1], v[5], v[4]),  # -y
            (v[3], v[7], v[6], v[2]),  # +y
            (v[1], v[2], v[6], v[5]),  # +x
            (v[0], v[4], v[7], v[3]),  # -x
        ]
        g = GeoBuilder()
        for q in quads:
            g.quad(*q, color)
        self.add_mesh(g, matrix)

    def cylinder(self, r_top, r_bot, h, segs, color, matrix=None, cap_top=True, cap_bot=True):
        g = GeoBuilder()
        for i in range(segs):
            a0 = 2 * math.pi * i / segs
            a1 = 2 * math.pi * (i + 1) / segs
            x0, z0 = math.cos(a0), math.sin(a0)
            x1, z1 = math.cos(a1), math.sin(a1)
            # side (outward winding)
            g.quad((x0 * r_bot, -h / 2, z0 * r_bot),
                   (x1 * r_bot, -h / 2, z1 * r_bot),
                   (x1 * r_top, h / 2, z1 * r_top),
                   (x0 * r_top, h / 2, z0 * r_top), color)
            if cap_top:
                g.tri((0, h / 2, 0),
                      (x0 * r_top, h / 2, z0 * r_top),
                      (x1 * r_top, h / 2, z1 * r_top), color)
            if cap_bot:
                g.tri((0, -h / 2, 0),
                      (x1 * r_bot, -h / 2, z1 * r_bot),
                      (x0 * r_bot, -h / 2, z0 * r_bot), color)
        self.add_mesh(g, matrix)

    def cone(self, r, h, segs, color, matrix=None):
        self.cylinder(0.0, r, h, segs, color, matrix, cap_top=False, cap_bot=True)

    def prism(self, w, h, d, color, matrix=None):
        """Triangular prism: triangle in XZ? No — triangle cross-section in XY,
        extruded along Z. Ridge along Z at top."""
        g = GeoBuilder()
        x, y, z = w / 2, h, d / 2
        # cross-section triangle: (-x,0), (x,0), (0,y)
        # front/back caps (at z=-z and z=+z)
        g.tri((-x, 0, -z), (x, 0, -z), (0, y, -z), color)
        g.tri((-x, 0, z), (0, y, z), (x, 0, z), color)
        # bottom
        g.quad((-x, 0, -z), (-x, 0, z), (x, 0, z), (x, 0, -z), color)
        # left slope
        g.quad((-x, 0, z), (-x, 0, -z), (0, y, -z), (0, y, z), color)
        # right slope
        g.quad((x, 0, -z), (x, 0, z), (0, y, z), (0, y, -z), color)
        self.add_mesh(g, matrix)

    def sphere(self, r, segs, rings, color, matrix=None):
        """Low-poly UV sphere."""
        g = GeoBuilder()
        for ri in range(rings):
            t0 = math.pi * ri / rings
            t1 = math.pi * (ri + 1) / rings
            y0, r0 = math.cos(t0) * r, math.sin(t0) * r
            y1, r1 = math.cos(t1) * r, math.sin(t1) * r
            for si in range(segs):
                a0 = 2 * math.pi * si / segs
                a1 = 2 * math.pi * (si + 1) / segs
                p00 = (math.cos(a0) * r0, y0, math.sin(a0) * r0)
                p01 = (math.cos(a1) * r0, y0, math.sin(a1) * r0)
                p10 = (math.cos(a0) * r1, y1, math.sin(a0) * r1)
                p11 = (math.cos(a1) * r1, y1, math.sin(a1) * r1)
                if ri == 0:
                    g.tri(p10, p11, p01, color)
                elif ri == rings - 1:
                    g.tri(p00, p01, p10, color)
                else:
                    g.quad(p00, p01, p11, p10, color)
        self.add_mesh(g, matrix)

    def tapered_box(self, w0, w1, h, d0, d1, color, matrix=None):
        """Box tapering from (w0,d0) at bottom to (w1,d1) at top."""
        x0, x1 = w0 / 2, w1 / 2
        z0, z1 = d0 / 2, d1 / 2
        y0, y1 = -h / 2, h / 2
        g = GeoBuilder()
        g.quad((-x0, y0, -z0), (x0, y0, -z0), (x1, y1, -z1), (-x1, y1, -z1), color)
        g.quad((-x0, y0, z0), (-x1, y1, z1), (x1, y1, z1), (x0, y0, z0), color)
        g.quad((-x0, y0, -z0), (-x0, y0, z0), (-x1, y1, z1), (-x1, y1, -z1), color)
        g.quad((x0, y0, -z0), (x1, y1, -z1), (x1, y1, z1), (x0, y0, z0), color)
        g.quad((-x1, y1, -z1), (x1, y1, -z1), (x1, y1, z1), (-x1, y1, z1), color)
        g.quad((-x0, y0, -z0), (-x0, y0, z0), (x0, y0, z0), (x0, y0, -z0), color)
        self.add_mesh(g, matrix)

    # ---------- finalize ----------

    def finalize(self):
        """Compute smooth-ish normals (face normals, flat shading)."""
        n = len(self.positions) // 3
        normals = [0.0] * (n * 3)
        # accumulate face normals per vertex (non-indexed faces stored in _face_data)
        # _face_data order matches triangle emission order; rebuild per-tri vertex map
        vi = 0
        for (a, b, c) in self._face_data:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx = uy * vz - uz * vy
            ny = uz * vx - ux * vz
            nz = ux * vy - uy * vx
            L = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            nx, ny, nz = nx / L, ny / L, nz / L
            for k in range(3):
                idx = (vi + k) * 3
                normals[idx] += nx
                normals[idx + 1] += ny
                normals[idx + 2] += nz
            vi += 3
        # normalize
        for i in range(n):
            x, y, z = normals[3 * i:3 * i + 3]
            L = math.sqrt(x * x + y * y + z * z) or 1.0
            normals[3 * i:3 * i + 3] = [x / L, y / L, z / L]
        self.normals = normals

    def triangle_count(self):
        return len(self.indices) // 3

    def to_dict(self, name="asset"):
        self.finalize()
        return {
            "format": "osf-proc-asset",
            "version": 1,
            "name": name,
            "positions": [round(v, 4) for v in self.positions],
            "normals": [round(v, 4) for v in self.normals],
            "colors": [round(v, 4) for v in self.colors],
            "indices": self.indices,
            "triangleCount": self.triangle_count(),
            "meta": self.meta,
        }

    def save(self, path, name="asset"):
        d = self.to_dict(name)
        with open(path, "w") as f:
            json.dump(d, f, separators=(",", ":"))
        return d
