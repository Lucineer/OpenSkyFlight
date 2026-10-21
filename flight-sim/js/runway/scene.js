// Sitka Real Sim — PASI airport scene (Three.js).
//
// World frame: +X = east, -X = west, +Z = south, -Z = north, Y = up.
// Runway 11/29 lies along X. The 29 threshold (departure end for takeoff
// on 29) is at the EAST end (+X); the 11 threshold is at the WEST end.
// Water at both ends — the causeway is the only dry ground.

import * as THREE from 'three';
import { RUNWAY_M } from './physics.js?v=2';

export const RUNWAY_Y = 7.15; // top of the runway surface

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function runwayTexture() {
  return canvasTexture(2048, 96, (ctx, w, h) => {
    ctx.fillStyle = '#2e3438';
    ctx.fillRect(0, 0, w, h);
    // Edge lines.
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 4, w, 3);
    ctx.fillRect(0, h - 7, w, 3);
    // Centerline dashes.
    for (let x = 40; x < w - 40; x += 90) ctx.fillRect(x, h / 2 - 2, 45, 4);
    // Threshold piano keys at both ends.
    for (const x0 of [10, w - 10 - 8 * 14]) {
      for (let i = 0; i < 8; i++) ctx.fillRect(x0 + i * 14, 14, 7, h - 28);
    }
    // Runway numbers: "11" at the west end (canvas left), "29" at the
    // east end (canvas right). Digits' tops point in the direction of
    // flight for the approaching pilot.
    ctx.fillStyle = '#f2f2f2';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(150, h / 2);
    ctx.rotate(Math.PI / 2); // tops point east (+X): runway 11 approach
    ctx.fillText('11', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(w - 150, h / 2);
    ctx.rotate(-Math.PI / 2); // tops point west (-X): runway 29 approach
    ctx.fillText('29', 0, 0);
    ctx.restore();
  });
}

function skyTexture() {
  return canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1e4a7a');
    g.addColorStop(0.55, '#5d8fb8');
    g.addColorStop(0.8, '#cfe0ea');
    g.addColorStop(1, '#eef3f5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function buildPasi() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd7e6ef, 9000, 42000);

  // Sky dome.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(38000, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x2a3a2a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
  sun.position.set(6000, 9000, -4000);
  scene.add(sun);

  // Sitka Sound — water everywhere at sea level.
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(40000, 48),
    new THREE.MeshLambertMaterial({ color: 0x2e6f95 }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // Causeway: the airport island strip.
  const causeway = new THREE.Mesh(
    new THREE.BoxGeometry(RUNWAY_M + 600, 7, 150),
    new THREE.MeshLambertMaterial({ color: 0x6a7076 }),
  );
  causeway.position.set(0, 3.5, 0);
  scene.add(causeway);

  // Runway strip with markings.
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_M, 46),
    new THREE.MeshLambertMaterial({ map: runwayTexture() }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, RUNWAY_Y, 0);
  scene.add(runway);

  // Terminal + tower, south side near midfield.
  const term = new THREE.Mesh(
    new THREE.BoxGeometry(120, 12, 40),
    new THREE.MeshLambertMaterial({ color: 0xb9c0c7 }),
  );
  term.position.set(120, RUNWAY_Y + 6, 120);
  scene.add(term);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 6, 30, 10),
    new THREE.MeshLambertMaterial({ color: 0xd8dde2 }),
  );
  tower.position.set(200, RUNWAY_Y + 15, 120);
  scene.add(tower);
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(14, 8, 14),
    new THREE.MeshLambertMaterial({ color: 0x2a4a66 }),
  );
  cab.position.set(200, RUNWAY_Y + 33, 120);
  scene.add(cab);

  // Windsock: pole + cone; main.js aims it at the wind.
  const sockPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 9, 8),
    new THREE.MeshLambertMaterial({ color: 0xcccccc }),
  );
  sockPole.position.set(-200, RUNWAY_Y + 4.5, -45);
  scene.add(sockPole);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 5, 10),
    new THREE.MeshLambertMaterial({ color: 0xff5a1f }),
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(-200, RUNWAY_Y + 8.5, -45);
  scene.add(sock);

  // Kruzof Island + Mount Edgecumbe, west-southwest across the Sound.
  const kruzof = new THREE.Mesh(
    new THREE.CylinderGeometry(9000, 9500, 130, 24),
    new THREE.MeshLambertMaterial({ color: 0x2e4a34 }),
  );
  kruzof.position.set(-19500, 10, 6500);
  scene.add(kruzof);
  const edge = new THREE.Mesh(
    new THREE.ConeGeometry(4200, 975, 24),
    new THREE.MeshLambertMaterial({ color: 0x33513c }),
  );
  edge.position.set(-19500, 975 / 2, 6500);
  scene.add(edge);
  const snow = new THREE.Mesh(
    new THREE.ConeGeometry(1400, 300, 24),
    new THREE.MeshLambertMaterial({ color: 0xeef4f8 }),
  );
  snow.position.set(-19500, 975 - 140, 6500);
  scene.add(snow);

  // Sitka town: small boxes east of the field.
  const townCols = [0x9aa0a6, 0xb9b0a0, 0x8a929a, 0xc0c8ce];
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const w = 18 + rnd() * 30;
    const d = 14 + rnd() * 24;
    const hgt = 7 + rnd() * 18;
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(w, hgt, d),
      new THREE.MeshLambertMaterial({ color: townCols[i % townCols.length] }),
    );
    b.position.set(2800 + rnd() * 4200, hgt / 2, -2600 + rnd() * 5200);
    scene.add(b);
  }
  // Eastern mountains.
  for (const [x, z, r, hgt] of [
    [12000, -8000, 5000, 1100],
    [15000, 2000, 6500, 1400],
    [11000, 9000, 4500, 900],
  ]) {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(r, hgt, 12),
      new THREE.MeshLambertMaterial({ color: 0x2c4636 }),
    );
    m.position.set(x, hgt / 2, z);
    scene.add(m);
  }

  return { scene, sock };
}
