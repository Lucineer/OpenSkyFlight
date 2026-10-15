/**
 * ProceduralAssetLoader — loads assets produced by tools/generators/
 * (the "osf-proc-asset" JSON format: positions/normals/colors/indices).
 *
 * Assets use vertex colors, so a single MeshStandardMaterial with
 * vertexColors:true renders them in one draw call.
 *
 * Usage:
 *   import { loadProceduralAsset } from './assets/ProceduralAssetLoader.js';
 *   const mesh = await loadProceduralAsset('/assets/proc/plane-bush-00007.json');
 *   scene.add(mesh);
 */

export async function loadProceduralAsset(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ProceduralAssetLoader: ${res.status} ${url}`);
  const d = await res.json();
  if (d.format !== 'osf-proc-asset') {
    throw new Error(`ProceduralAssetLoader: unknown format ${d.format}`);
  }
  return buildMeshFromData(d);
}

export function buildMeshFromData(d) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.Float32BufferAttribute(d.positions, 3));
  geo.setAttribute('normal',
    new THREE.Float32BufferAttribute(d.normals, 3));
  geo.setAttribute('color',
    new THREE.Float32BufferAttribute(d.colors, 3));
  geo.setIndex(d.indices);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.procMeta = d.meta || {};
  return mesh;
}
