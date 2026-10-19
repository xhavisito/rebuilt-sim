/**
 * Fusiona las mallas hijas DIRECTAS (estáticas) de un grupo que comparten material,
 * para reducir draw calls. Las partes móviles deben vivir en subgrupos propios.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeStaticChildren(group: THREE.Group, skip: Set<THREE.Object3D> = new Set()): void {
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of group.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || skip.has(m) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
    if (Array.isArray(m.material) || m.children.length) continue;
    let list = byMat.get(m.material);
    if (!list) byMat.set(m.material, (list = []));
    list.push(m);
  }
  for (const [mat, meshes] of byMat) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = true;
    mesh.renderOrder = meshes[0].renderOrder;
    for (const m of meshes) {
      group.remove(m);
      m.geometry.dispose();
    }
    group.add(mesh);
  }
}
