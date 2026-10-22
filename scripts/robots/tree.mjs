// Árbol de nodos de un GLB con sus límites (marco del archivo, m), para escoger los `parts` de
// sources.mjs en assets de una sola pieza. Uso: node scripts/robots/tree.mjs <cad>/<equipo>/model.glb [profundidad=3]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const [f, depth = '3'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(f);
const scene = doc.getRoot().listScenes()[0];
const pr = (n, d) => {
  if (d > +depth) return;
  let b; try { b = getBounds(n); } catch { b = null; }
  const fmt = (v) => v.map((x) => x.toFixed(2)).join(',');
  console.log('  '.repeat(d) + n.getName() + (b ? ` [${fmt(b.min)}]→[${fmt(b.max)}]` : '') + ` (${n.listChildren().length})`);
  for (const c of n.listChildren()) pr(c, d + 1);
};
for (const n of scene.listChildren()) pr(n, 0);
