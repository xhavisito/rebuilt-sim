/**
 * Aligera un CAD propio al importarlo (los exportados de Onshape / SolidWorks pesan cientos de MB):
 * quita piezas diminutas (tornillería), suelda vértices, simplifica hasta un presupuesto de
 * triángulos y comprime con meshopt (GLTFLoader ya trae el decodificador). Conserva la jerarquía y
 * los nombres de los nodos (turret / intake). Corre en un worker (cadOptimize.worker.ts).
 */
import { WebIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

export type OptimizeStep = 'read' | 'clean' | 'simplify' | 'compress';

export interface OptimizeResult {
  glb: Uint8Array;
  trianglesIn: number;
  trianglesOut: number;
  removedParts: number;
}

export interface OptimizeOptions {
  /** Triángulos que se buscan en total (el robot se ve bien con ~200k). */
  targetTriangles: number;
  /** Piezas con diagonal menor a esta fracción de la del robot se quitan (tornillos, tuercas). */
  tinyPart: number;
}

export const OPTIMIZE_DEFAULTS: OptimizeOptions = { targetTriangles: 200_000, tinyPart: 0.012 };

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue; // TRIANGLES
      n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  return Math.round(n);
}

const diag = (b: { min: number[]; max: number[] }) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);

export async function optimizeCadBuffer(buf: Uint8Array, opts: Partial<OptimizeOptions> = {}, onStep: (s: OptimizeStep) => void = () => {}): Promise<OptimizeResult> {
  const o = { ...OPTIMIZE_DEFAULTS, ...opts };
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  onStep('read');
  const glb = new TextDecoder().decode(buf.subarray(0, 4)) === 'glTF';
  let doc: Document;
  try {
    doc = glb ? await io.readBinary(buf) : await io.readJSON({ json: JSON.parse(new TextDecoder().decode(buf)), resources: {} });
  } catch (e) {
    if (/draco/i.test(String((e as Error)?.message ?? e))) throw new Error('draco');
    throw e;
  }
  const trianglesIn = countTriangles(doc);

  // Piezas diminutas respecto al robot entero
  onStep('clean');
  let removedParts = 0;
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (scene) {
    const whole = diag(getBounds(scene));
    if (whole > 0) {
      const nodes: Node[] = [];
      scene.traverse((n) => void (n.getMesh() && nodes.push(n)));
      for (const n of nodes)
        if (diag(getBounds(n)) < whole * o.tinyPart) {
          n.setMesh(null);
          removedParts++;
        }
    }
  }
  await doc.transform(prune(), dedup(), weld());

  // Simplificación progresiva: el error (fracción del radio de cada pieza) sube hasta el presupuesto
  onStep('simplify');
  for (const error of [0.001, 0.003, 0.008, 0.02, 0.05]) {
    const tris = countTriangles(doc);
    if (tris <= o.targetTriangles) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, o.targetTriangles / tris), error }));
  }
  const trianglesOut = countTriangles(doc);

  onStep('compress');
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return { glb: await io.writeBinary(doc), trianglesIn, trianglesOut, removedParts };
}
