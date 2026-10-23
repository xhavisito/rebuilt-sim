import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lodReady, lodVariant, mergedPart, registerLod, simplifyIndices } from '../src/render/robotLod';

/** Malla soldada sin normales, como vienen los GLB de robots. */
function welded(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return mergeVertices(geo);
}

const withNormals = (g: THREE.BufferGeometry) => {
  const c = g.clone();
  c.computeVertexNormals();
  return c;
};

describe('detalle de los CAD (robotLod)', () => {
  it('simplifica a la fracción pedida y deja intactas las mallas chicas', async () => {
    await lodReady;
    const big = welded(new THREE.SphereGeometry(1, 64, 48));
    const n = big.getIndex()!.count;
    const I = simplifyIndices(big, 0.2)!;
    expect(I.length).toBeLessThan(n * 0.3);
    expect(I.length % 3).toBe(0);
    expect(simplifyIndices(welded(new THREE.BoxGeometry()), 0.2)).toBeNull();
  });

  it('cada variante se calcula una vez y se comparte', async () => {
    await lodReady;
    const w = welded(new THREE.TorusGeometry(1, 0.3, 32, 64));
    const full = withNormals(w);
    registerLod(w, full);
    const low = lodVariant(full, 0.15, withNormals);
    expect(low).not.toBe(full);
    expect(low.getIndex()!.count).toBeLessThan(full.getIndex()!.count * 0.3);
    expect(lodVariant(low, 0.15, withNormals)).toBe(low);
    expect(lodVariant(low, 1, withNormals)).toBe(full);
  });

  it('fusiona las piezas opacas de una parte con su color por vértice, sin entrar a otras partes', async () => {
    await lodReady;
    const part = new THREE.Group();
    part.name = 'main';
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.8 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff, roughness: 0.8 });
    const clear = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const a = new THREE.Mesh(withNormals(welded(new THREE.BoxGeometry())), red);
    const b = new THREE.Mesh(withNormals(welded(new THREE.BoxGeometry())), blue);
    b.position.x = 2;
    const c = new THREE.Mesh(withNormals(welded(new THREE.BoxGeometry())), clear);
    const comp = new THREE.Group();
    comp.name = 'c0';
    comp.add(new THREE.Mesh(withNormals(welded(new THREE.BoxGeometry())), red));
    part.add(a, b, c, comp);
    const merged = mergedPart('test|main', part, 0.4, withNormals);
    expect(merged).toHaveLength(1); // rojo y azul comparten material (no metal, mate)
    const g = merged[0].geometry;
    expect(g.getAttribute('color')).toBeTruthy();
    // los dos cubos opacos de `main` (ni el transparente ni el de c0)
    expect(g.getIndex()!.count).toBe(a.geometry.getIndex()!.count * 2);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(2.5);
  });
});
