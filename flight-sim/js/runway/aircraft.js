// Sitka Real Sim — procedural aircraft models (Three.js, low-poly, iPad-safe).
//
// Local frame: nose toward -X, up +Y, span along Z. The group origin sits
// at the aircraft centre, y = 0 at ground contact (gear extended).
// Materials are MeshLambertMaterial — cheap, no shadows.

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

// Swept wing half: a box rotated about Y so the tip trails aft (+X).
function wingHalf(span, chord, thick, material, zSign, sweepRad) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(chord, thick, span / 2), material);
  m.rotation.y = zSign * sweepRad;
  m.position.set(1.2, 0, zSign * span / 4);
  return m;
}

function build737(ac, livery) {
  const g = new THREE.Group();
  const L = ac.lengthM;
  const white = mat(0xf2f4f6);
  const teal = mat(0x0e7c86);
  const dark = mat(0x1a2530);
  const grey = mat(0x8a929a);

  // Fuselage tube + nose + tail cone.
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, L * 0.72, 20), white);
  tube.rotation.z = Math.PI / 2;
  tube.position.y = 3.6;
  g.add(tube);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), white);
  nose.scale.set(2.2, 1, 1);
  nose.position.set(-L * 0.40, 3.6, 0);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.9, L * 0.22, 16), white);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(L * 0.44, 3.9, 0);
  g.add(tail);
  // Teal cheatline + belly stripe (generic Sitka teal, no airline marks).
  const stripe = box(L * 0.66, 0.5, 3.84, teal, 0, 3.0, 0);
  g.add(stripe);
  // Cockpit windows.
  g.add(box(1.6, 0.7, 3.2, dark, -L * 0.40, 4.6, 0));
  // Passenger windows: dark band along each side.
  g.add(box(L * 0.55, 0.45, 0.06, dark, -1, 4.3, 1.92));
  g.add(box(L * 0.55, 0.45, 0.06, dark, -1, 4.3, -1.92));

  // Low swept wing + winglets.
  const wingMat = white;
  g.add(wingHalf(ac.spanM, 5.6, 0.4, wingMat, 1, 0.42));
  g.add(wingHalf(ac.spanM, 5.6, 0.4, wingMat, -1, 0.42));
  const wlR = box(0.3, 2.4, 1.4, teal, 3.4, 1.4, ac.spanM / 2);
  const wlL = box(0.3, 2.4, 1.4, teal, 3.4, 1.4, -ac.spanM / 2);
  g.add(wlR, wlL);
  // Tailplane + fin (teal fin).
  g.add(wingHalf(12, 3.0, 0.3, wingMat, 1, 0.5));
  g.add(wingHalf(12, 3.0, 0.3, wingMat, -1, 0.5));
  const fin = box(4.5, 7.5, 0.35, teal, L * 0.44, 7.2, 0);
  fin.rotation.z = -0.5;
  g.add(fin);
  // Engines under the wings.
  for (const s of [1, -1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 5.2, 16), white);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(-1.2, 1.9, s * 6.2);
    g.add(eng);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 16), dark);
    intake.rotation.z = Math.PI / 2;
    intake.position.set(-3.85, 1.9, s * 6.2);
    g.add(intake);
  }
  // Gear (retractable group — main.js toggles visibility).
  const gear = new THREE.Group();
  const strut = (x, z) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.0, 8), grey);
    s.position.set(x, 1.0, z);
    gear.add(s);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.55, z);
    gear.add(w);
  };
  strut(-L * 0.36, 0);
  strut(1.5, 3.4);
  strut(1.5, -3.4);
  g.add(gear);
  g.userData.gear = gear;
  return g;
}

function buildC172(ac) {
  const g = new THREE.Group();
  const white = mat(0xf2f4f6);
  const red = mat(0xc23b2e);
  const dark = mat(0x1a2530);
  const grey = mat(0x8a929a);
  const L = ac.lengthM;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, L * 0.7, 12), white);
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.5;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), white);
  nose.scale.set(1.6, 1, 1);
  nose.position.set(-L * 0.38, 1.5, 0);
  g.add(nose);
  g.add(box(L * 0.5, 0.25, 1.52, red, 0, 1.35, 0));
  // High wing + struts.
  const wing = box(2.4, 0.18, ac.spanM, white, 0.3, 2.5, 0);
  g.add(wing);
  const prop = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), dark);
  prop.position.set(-L * 0.5, 1.5, 0);
  prop.rotation.y = -Math.PI / 2;
  g.add(prop);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 10), red);
  spinner.rotation.z = Math.PI / 2;
  spinner.position.set(-L * 0.52, 1.5, 0);
  g.add(spinner);
  // Fixed tricycle gear.
  const leg = (x, z) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), grey);
    s.position.set(x, 0.55, z);
    g.add(s);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10), dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.32, z);
    g.add(w);
  };
  leg(-L * 0.36, 0);
  leg(1.2, 0.9);
  leg(1.2, -0.9);
  // Tail.
  const stab = box(1.6, 0.14, 3.4, white, L * 0.42, 1.9, 0);
  g.add(stab);
  const fin = box(1.4, 1.6, 0.14, red, L * 0.42, 2.4, 0);
  fin.rotation.z = -0.35;
  g.add(fin);
  g.userData.gear = null; // fixed gear — never hides
  g.userData.prop = prop;
  return g;
}

export function buildAircraft(ac) {
  if (ac.kind === 'jet') return build737(ac);
  return buildC172(ac);
}
