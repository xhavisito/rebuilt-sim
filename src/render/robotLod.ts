/**
 * Nivel de detalle de los CAD de robots (calidad baja/media): cada malla de un GLB tiene su versión
 * completa y, al pedirse, una simplificada con meshoptimizer (MeshoptSimplifier) a una fracción de
 * los triángulos. Se simplifica la malla soldada original (sin normales) y luego se le calculan las
 * normales con pliegue como a la completa. Los clones de cada robot comparten las geometrías, así
 * que cada versión se calcula una sola vez por modelo y cambiar de calidad solo cambia referencias.
 */
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Lod {
  /** Malla soldada original (posiciones + índices), base para simplificar. */
  welded: THREE.BufferGeometry;
  full: THREE.BufferGeometry;
  /** Versiones simplificadas por fracción de triángulos (en centésimas). */
  reduced: Map<number, THREE.BufferGeometry>;
}

/** Cualquier versión de la geometría → su registro. */
const lodOf = new WeakMap<THREE.BufferGeometry, Lod>();

/** Mallas con menos triángulos que esto se dejan completas (no vale la pena). */
const MIN_TRIANGLES = 400;

/** Fracción de triángulos con la que se dibujan los CAD ahora (1 = completos). */
export const robotLod = { ratio: 1 };

export function registerLod(welded: THREE.BufferGeometry, full: THREE.BufferGeometry): void {
  const l: Lod = { welded, full, reduced: new Map() };
  lodOf.set(full, l);
}

/** Índices simplificados de una malla soldada (o null si no se pudo reducir). */
export function simplifyIndices(geo: THREE.BufferGeometry, ratio: number): Uint32Array | null {
  const pa = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pa || !idx || !MeshoptSimplifier.supported) return null;
  const n = idx.count;
  if (n / 3 < MIN_TRIANGLES) return null;
  const P = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    P[i * 3] = pa.getX(i);
    P[i * 3 + 1] = pa.getY(i);
    P[i * 3 + 2] = pa.getZ(i);
  }
  const I = Uint32Array.from(idx.array as ArrayLike<number>);
  const target = Math.max(3, Math.floor((n * ratio) / 3) * 3);
  // error relativo al tamaño de la malla; 'Prune' quita piezas sueltas diminutas (tornillería)
  const [out] = MeshoptSimplifier.simplify(I, P, 3, target, ratio < 0.3 ? 0.03 : 0.012, ['Prune']);
  if (out.length < 3 || out.length >= n * 0.95) return null;
  return out;
}

/**
 * Versión de `geo` (cualquiera de sus variantes) a la fracción pedida; si aún no existe se calcula
 * con `crease` (las normales con pliegue de RobotView). Sin registro, la misma geometría.
 */
export function lodVariant(geo: THREE.BufferGeometry, ratio: number, crease: (g: THREE.BufferGeometry) => THREE.BufferGeometry): THREE.BufferGeometry {
  const l = lodOf.get(geo);
  if (!l) return geo;
  if (ratio >= 0.999) return l.full;
  const key = Math.round(ratio * 100);
  let g = l.reduced.get(key);
  if (!g) {
    const I = simplifyIndices(l.welded, ratio);
    if (I) {
      const w = new THREE.BufferGeometry();
      w.setAttribute('position', l.welded.getAttribute('position'));
      w.setIndex(new THREE.BufferAttribute(I, 1));
      g = crease(w);
    } else g = l.full;
    l.reduced.set(key, g);
    lodOf.set(g, l);
  }
  return g;
}

/** Espera a que el simplificador (WASM) esté listo. */
export const lodReady: Promise<void> = MeshoptSimplifier.ready;

/** Pieza que entra en la malla fusionada: opaca, de un solo material sin texturas. */
export function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return false;
  const mat = m.material as THREE.MeshStandardMaterial;
  return !mat.transparent && !mat.map && !!mat.color && !!m.geometry.getAttribute('normal');
}

/** Mallas de una parte del CAD sin entrar a otras partes (`main`, `cN`) colgadas de ella. */
export function partMeshes(node: THREE.Object3D, pick: (o: THREE.Object3D) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== node && /^(main|c\d+)$/.test(o.name)) return;
    if (pick(o)) out.push(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  visit(node);
  return out;
}

const mergedCache = new Map<string, Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>>();
const mergedMats = new Map<string, THREE.MeshStandardMaterial>();

/** Material compartido de las mallas fusionadas (metal / no metal, pulido / mate). */
function mergedMaterial(metal: boolean, rough: number): THREE.MeshStandardMaterial {
  const k = `${metal}|${rough}`;
  let m = mergedMats.get(k);
  if (!m) mergedMats.set(k, (m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: metal ? 0.5 : 0.1, roughness: rough })));
  return m;
}

/**
 * Mallas fusionadas (en el marco de `node`) de una parte del CAD a la fracción `ratio`; `key`
 * identifica la parte del modelo (archivo + nombre) para calcularlas una vez y compartirlas.
 */
export function mergedPart(key: string, node: THREE.Object3D, ratio: number, crease: (g: THREE.BufferGeometry) => THREE.BufferGeometry): THREE.Mesh[] {
  const k = `${key}|${Math.round(ratio * 100)}`;
  let parts = mergedCache.get(k);
  if (!parts) {
    node.updateMatrixWorld(true);
    const inv = node.matrixWorld.clone().invert();
    const buckets = new Map<string, { geos: THREE.BufferGeometry[]; metal: boolean; rough: number }>();
    const m4 = new THREE.Matrix4();
    for (const mesh of partMeshes(node, mergeable)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const src = lodVariant(mesh.geometry, ratio, crease);
      const pa = src.getAttribute('position');
      const na = src.getAttribute('normal');
      const g = new THREE.BufferGeometry();
      const P = new Float32Array(pa.count * 3);
      const N = new Float32Array(pa.count * 3);
      const C = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) {
        const o = i * 3;
        P[o] = pa.getX(i);
        P[o + 1] = pa.getY(i);
        P[o + 2] = pa.getZ(i);
        N[o] = na.getX(i);
        N[o + 1] = na.getY(i);
        N[o + 2] = na.getZ(i);
        C[o] = mat.color.r;
        C[o + 1] = mat.color.g;
        C[o + 2] = mat.color.b;
      }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      const idx = src.getIndex();
      g.setIndex(new THREE.BufferAttribute(idx ? Uint32Array.from(idx.array as ArrayLike<number>) : Uint32Array.from({ length: pa.count }, (_, i) => i), 1));
      g.applyMatrix4(m4.multiplyMatrices(inv, mesh.matrixWorld));
      const metal = (mat.metalness ?? 0) > 0.5;
      // dos rugosidades (pulido / mate): pocas mallas por parte, el color es lo que más se nota
      const rough = (mat.roughness ?? 0.5) < 0.45 ? 0.35 : 0.7;
      const bk = `${metal}|${rough}`;
      let b = buckets.get(bk);
      if (!b) buckets.set(bk, (b = { geos: [], metal, rough }));
      b.geos.push(g);
    }
    parts = [];
    for (const b of buckets.values()) {
      const geometry = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (geometry) parts.push({ geometry, material: mergedMaterial(b.metal, b.rough) });
    }
    mergedCache.set(k, parts);
  }
  return parts.map((p) => {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.name = 'lod-merged';
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  });
}
