// Procedural aircraft models — stylized low-poly planes built from Three.js primitives.
// Each builder returns a THREE.Group centered at origin, nose pointing -Z.

import * as THREE from 'three';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...opts });
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  return m;
}

// Fuselage: tapered cylinder rotated to point along Z
function fuselage(len, r, color) {
  const g = new THREE.CylinderGeometry(r * 0.6, r, len, 12);
  const m = new THREE.Mesh(g, mat(color));
  m.rotation.x = Math.PI / 2; // axis along Z
  return m;
}

function cockpit(color = 0x1a2b3c) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat(color, { roughness: 0.2, metalness: 0.8 }));
  m.scale.set(0.8, 0.6, 1.4);
  return m;
}

function prop(color = 0x222222) {
  const g = new THREE.Group();
  const b1 = box(0.12, 2.2, 0.08, color);
  const b2 = box(2.2, 0.12, 0.08, color);
  g.add(b1, b2);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat(0x888888));
  g.add(hub);
  return g;
}

export const PLANES = {
  rafale: {
    name: 'Rafale',
    desc: 'Interceptor jet — fast and agile',
    speed: 1.0, // multiplier on cameraSpeed
    agility: 1.0, // roll/pitch responsiveness
    build() {
      const g = new THREE.Group();
      // Delta wing fighter
      g.add(fuselage(6, 0.7, 0x5a6b7d));
      const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.15, 2.5), mat(0x4a5b6d));
      wing.position.set(0, -0.1, 0.5);
      g.add(wing);
      // Canards
      const canard = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.8), mat(0x4a5b6d));
      canard.position.set(0, 0.1, -2);
      g.add(canard);
      // Twin tail
      g.add(box(0.12, 1.2, 1.0, 0x4a5b6d, -0.5, 0.8, 2.2));
      g.add(box(0.12, 1.2, 1.0, 0x4a5b6d, 0.5, 0.8, 2.2));
      // Cockpit
      const cp = cockpit();
      cp.position.set(0, 0.5, -1.2);
      g.add(cp);
      return g;
    },
  },

  cub: {
    name: 'Bush Cub',
    desc: 'Backcountry legend — slow, lands anywhere',
    speed: 0.35,
    agility: 0.8,
    build() {
      const g = new THREE.Group();
      g.add(fuselage(5, 0.6, 0xf2c230)); // classic cub yellow
      // High wing
      g.add(box(7.5, 0.18, 1.6, 0xf2c230, 0, 0.75, -0.3));
      // Struts
      g.add(box(0.08, 1.0, 0.08, 0x333333, -1.2, 0.25, -0.3));
      g.add(box(0.08, 1.0, 0.08, 0x333333, 1.2, 0.25, -0.3));
      // Tail
      g.add(box(2.4, 0.12, 0.9, 0xf2c230, 0, 0.15, 2.3));
      g.add(box(0.12, 1.0, 0.8, 0xf2c230, 0, 0.6, 2.4));
      const cp = cockpit();
      cp.position.set(0, 0.45, -0.8);
      g.add(cp);
      // Prop
      const p = prop();
      p.position.set(0, 0, -2.6);
      p.rotation.x = 0;
      g.add(p);
      // Tundra tires
      const wg = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10);
      const wm = mat(0x222222);
      [-1, 1].forEach((x) => {
        const w = new THREE.Mesh(wg, wm);
        w.rotation.z = Math.PI / 2;
        w.position.set(x * 1.1, -0.7, -0.2);
        g.add(w);
      });
      return g;
    },
  },

  otter: {
    name: 'Twin Otter',
    desc: 'Arctic workhorse — stable and roomy',
    speed: 0.5,
    agility: 0.6,
    build() {
      const g = new THREE.Group();
      g.add(fuselage(7, 0.9, 0xc0392b)); // red
      // High wing
      g.add(box(10, 0.22, 2.0, 0xecf0f1, 0, 0.95, -0.5)); // white wing
      // Twin engines
      [-2.2, 2.2].forEach((x) => {
        const eng = cyl(0.45, 0.45, 2.2, 0x7f8c8d, x, 0.7, -1.2);
        eng.rotation.x = Math.PI / 2;
        g.add(eng);
        const p = prop();
        p.position.set(x, 0.7, -2.4);
        g.add(p);
      });
      // T-tail
      g.add(box(3.2, 0.15, 1.1, 0xc0392b, 0, 0.2, 3.2));
      g.add(box(0.15, 1.6, 1.0, 0xc0392b, 0, 0.9, 3.3));
      g.add(box(3.0, 0.12, 0.9, 0xc0392b, 0, 1.65, 3.3));
      const cp = cockpit();
      cp.position.set(0, 0.6, -2.2);
      g.add(cp);
      return g;
    },
  },

  atr: {
    name: 'ATR 72',
    desc: 'Twin turboprop airliner — the Alaska commuter',
    speed: 0.55,
    agility: 0.55,
    build() {
      const g = new THREE.Group();
      // Long slender fuselage, white with blue cheatline
      g.add(fuselage(9, 0.95, 0xf4f6f7));
      g.add(box(1.92, 0.3, 8.2, 0x2980b9, 0, -0.15, 0)); // blue stripe
      // High straight wing
      g.add(box(13, 0.25, 2.4, 0xd5dbdb, 0, 1.05, -0.8));
      // Twin PW127 turboprops in nacelles
      [-3.1, 3.1].forEach((x) => {
        const nac = cyl(0.55, 0.5, 3.0, 0x2c3e50, x, 0.85, -1.6);
        nac.rotation.x = Math.PI / 2;
        g.add(nac);
        const p = prop(0x1a1a1a);
        p.scale.setScalar(1.4);
        p.position.set(x, 0.85, -3.2);
        g.add(p);
        // Exhaust stub
        g.add(box(0.15, 0.15, 0.6, 0x555555, x + 0.5, 0.7, -1.0));
      });
      // T-tail: tall fin with stabilizer on top
      g.add(box(0.18, 2.4, 1.2, 0x2980b9, 0, 1.2, 4.3));
      g.add(box(4.2, 0.16, 1.1, 0xd5dbdb, 0, 2.35, 4.3));
      // Ventral fin
      g.add(box(0.12, 0.8, 0.9, 0x2980b9, 0, -0.9, 4.2));
      const cp = cockpit();
      cp.position.set(0, 0.55, -3.6);
      cp.scale.set(1.1, 0.75, 1.3);
      g.add(cp);
      // Main gear (fixed, ATR-style)
      [-1.3, 1.3].forEach((x) => {
        g.add(box(0.12, 0.9, 0.12, 0x555555, x, -0.9, 0.2));
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10), mat(0x222222));
        w.rotation.z = Math.PI / 2;
        w.position.set(x, -1.35, 0.2);
        g.add(w);
      });
      return g;
    },
  },

  biplane: {
    name: 'Barnstormer',
    desc: 'Vintage biplane — pure joy',
    speed: 0.4,
    agility: 1.2,
    build() {
      const g = new THREE.Group();
      g.add(fuselage(5.5, 0.55, 0xa93226)); // deep red
      // Two wings
      g.add(box(7, 0.14, 1.4, 0xf5d547, 0, 0.7, -0.5)); // top, yellow
      g.add(box(6, 0.14, 1.4, 0xf5d547, 0, -0.25, -0.5)); // bottom
      // Struts between wings
      [-2.2, 2.2].forEach((x) => {
        g.add(box(0.1, 1.0, 0.1, 0x5d4037, x, 0.22, -0.5));
      });
      // Tail
      g.add(box(2.2, 0.1, 0.8, 0xa93226, 0, 0.1, 2.5));
      g.add(box(0.1, 0.9, 0.7, 0xa93226, 0, 0.5, 2.6));
      const cp = cockpit();
      cp.position.set(0, 0.35, -0.3);
      g.add(cp);
      const p = prop();
      p.position.set(0, 0, -2.9);
      g.add(p);
      return g;
    },
  },

  beaver: {
    name: 'Floatplane',
    desc: 'De Havilland Beaver — lands on water',
    speed: 0.45,
    agility: 0.7,
    build() {
      const g = new THREE.Group();
      g.add(fuselage(6, 0.7, 0x2e86c1)); // blue
      g.add(box(8.5, 0.2, 1.8, 0x2e86c1, 0, 0.8, -0.4));
      g.add(box(2.6, 0.14, 1.0, 0x2e86c1, 0, 0.15, 2.7));
      g.add(box(0.14, 1.1, 0.9, 0x2e86c1, 0, 0.65, 2.8));
      const cp = cockpit();
      cp.position.set(0, 0.55, -1.0);
      g.add(cp);
      const p = prop();
      p.position.set(0, 0, -3.1);
      g.add(p);
      // Floats
      [-1.1, 1.1].forEach((x) => {
        const fl = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 4, 6, 10), mat(0xecf0f1));
        fl.rotation.x = Math.PI / 2;
        fl.position.set(x, -1.1, 0);
        g.add(fl);
        // Struts
        g.add(box(0.08, 0.8, 0.08, 0x555555, x, -0.5, -1.0));
        g.add(box(0.08, 0.8, 0.08, 0x555555, x, -0.5, 1.0));
      });
      return g;
    },
  },

  extra: {
    name: 'Aerobat',
    desc: 'Competition stunt plane — turns on a dime',
    speed: 0.65,
    agility: 1.6,
    build() {
      const g = new THREE.Group();
      g.add(fuselage(5.5, 0.55, 0xffffff));
      // Low wing, checkered tips
      g.add(box(7, 0.16, 1.5, 0xe74c3c, 0, -0.2, -0.3));
      g.add(box(1.2, 0.17, 1.5, 0xffffff, -2.9, -0.2, -0.3));
      g.add(box(1.2, 0.17, 1.5, 0xffffff, 2.9, -0.2, -0.3));
      g.add(box(2.4, 0.12, 0.9, 0xe74c3c, 0, 0.1, 2.5));
      g.add(box(0.12, 1.0, 0.8, 0xe74c3c, 0, 0.55, 2.6));
      const cp = cockpit(0x0a0a0a);
      cp.position.set(0, 0.4, -0.6);
      g.add(cp);
      const p = prop(0x111111);
      p.position.set(0, 0, -2.9);
      g.add(p);
      return g;
    },
  },

  jayhawk: {
    name: 'Jayhawk',
    desc: 'Coast Guard helicopter — hover and rescue',
    speed: 0.4,
    agility: 0.9,
    helicopter: true,
    build() {
      const g = new THREE.Group();
      // Body
      const body = fuselage(5.5, 0.9, 0xe67e22); // Coast Guard orange
      g.add(body);
      // Cockpit
      const cp = cockpit();
      cp.position.set(0, 0.4, -1.8);
      cp.scale.set(1, 0.7, 1.2);
      g.add(cp);
      // Tail boom
      const boom = cyl(0.35, 0.2, 4, 0xe67e22, 0, 0.3, 4.5);
      boom.rotation.x = Math.PI / 2;
      g.add(boom);
      // Tail fin + rotor
      g.add(box(0.12, 1.2, 0.7, 0xe67e22, 0, 0.9, 6.3));
      const tr = prop(0x333333);
      tr.scale.setScalar(0.6);
      tr.rotation.y = Math.PI / 2;
      tr.position.set(0.15, 0.9, 6.3);
      g.add(tr);
      // Main rotor (will spin via userData)
      const rotor = new THREE.Group();
      const b1 = box(9, 0.08, 0.35, 0x2c3e50);
      const b2 = box(0.35, 0.08, 9, 0x2c3e50);
      rotor.add(b1, b2);
      rotor.position.set(0, 1.35, -0.5);
      g.add(rotor);
      g.userData.rotor = rotor;
      // Mast
      g.add(cyl(0.12, 0.12, 0.8, 0x555555, 0, 0.95, -0.5));
      // Skids
      [-1, 1].forEach((x) => {
        g.add(box(0.1, 0.1, 3.5, 0x333333, x * 1.0, -1.1, 0));
        g.add(box(0.08, 0.7, 0.08, 0x333333, x * 1.0, -0.75, -1.0));
        g.add(box(0.08, 0.7, 0.08, 0x333333, x * 1.0, -0.75, 1.0));
      });
      // Coast Guard stripe
      g.add(box(1.85, 0.25, 5.0, 0xffffff, 0, 0.1, 0));
      return g;
    },
  },

  b17: {
    name: 'B-17 Flying Fortress',
    desc: 'WWII heavy bomber — slow, stable, drops bombs (B key)',
    speed: 0.45,
    agility: 0.35, // heavy and sluggish, as it should be
    bomber: true,
    build() {
      const g = new THREE.Group();
      // Long fuselage — olive drab
      g.add(fuselage(11, 1.1, 0x4a4a2e));
      // Big high wing
      g.add(box(16, 0.3, 3.0, 0x4a4a2e, 0, 1.0, -1.0));
      // Four engines with props
      [-5.5, -2.0, 2.0, 5.5].forEach((x) => {
        const nac = cyl(0.6, 0.55, 3.5, 0x3a3a24, x, 0.8, -1.8);
        nac.rotation.x = Math.PI / 2;
        g.add(nac);
        const p = prop(0x1a1a1a);
        p.scale.setScalar(1.6);
        p.position.set(x, 0.8, -3.7);
        g.add(p);
      });
      // Tail: big vertical fin + horizontal stabilizers
      g.add(box(0.2, 3.0, 1.5, 0x4a4a2e, 0, 1.5, 5.2)); // fin
      g.add(box(6.0, 0.2, 1.4, 0x4a4a2e, 0, 0.3, 5.0)); // stabilizers
      // Nose: glass bombardier position
      const nose = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 12, 8),
        mat(0x87ceeb, { roughness: 0.1, metalness: 0.2 }),
      );
      nose.position.set(0, -0.2, -5.8);
      nose.scale.set(1, 0.8, 1.2);
      g.add(nose);
      // Top turret
      g.add(cyl(0.4, 0.5, 0.6, 0x3a3a24, 0, 1.3, -0.5));
      // Belly ball turret
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat(0x87ceeb, { roughness: 0.1 }));
      belly.position.set(0, -1.2, 0.5);
      g.add(belly);
      // US star insignia (simplified white star on blue)
      [-8.1, 8.1].forEach((x) => {
        g.add(box(0.05, 1.2, 1.2, 0xffffff, x, 1.0, -1.0));
      });
      const cp = cockpit();
      cp.position.set(0, 0.8, -3.5);
      g.add(cp);
      return g;
    },
  },
};

export function buildPlane(type) {
  const def = PLANES[type] || PLANES.rafale;
  const group = def.build();
  // Scale to roughly match the Rafale's visual size
  const box3 = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box3.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const target = 8; // ~8m wingspan/length
  if (maxDim > 0) group.scale.setScalar(target / maxDim);
  return { group, def };
}
