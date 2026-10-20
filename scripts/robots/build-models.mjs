// Convierte los modelos 3D publicados por los equipos (assets de AdvantageScope en sus
// repos de código) en un GLB ligero para la web:
//   1. junta el modelo principal y sus componentes (intake, turret, hood…) en su posición de CAD,
//   2. aplica las rotaciones de config.json y pasa del marco WPILib (X adelante, Y izquierda,
//      Z arriba) al del simulador (X adelante, Y arriba, Z derecha),
//   3. quita tornillería y piezas diminutas, simplifica, une por material y comprime (meshopt).
// Uso: node scripts/robots/build-models.mjs <carpeta-con-descargas> [equipo...]
// Las descargas: <carpeta>/<equipo>/{model.glb, model_N.glb, config.json} (ver SOURCES).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, join, meshopt, mergeDocuments, prune, quantize, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { SOURCES } from './sources.mjs';

const [srcDir, ...only] = process.argv.slice(2);
if (!srcDir) throw new Error('Uso: node scripts/robots/build-models.mjs <carpeta> [equipo...]');
const OUT = 'public/robots';
/** Fracción de triángulos que conserva gltfpack (−si). */
const RATIO = Number(process.env.RATIO ?? 0.3);
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Cuaternión [x,y,z,w] de un eje y ángulo. */
const axisQuat = (axis, deg) => {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h)];
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const meta = {};
for (const src of SOURCES) {
  if (only.length && !only.includes(String(src.team))) continue;
  const dir = `${srcDir}/${src.team}`;
  const cfg = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
  const doc = await io.read(`${dir}/model.glb`);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // Componentes (model_0.glb…): exportados en el mismo marco del CAD que el modelo principal
  const comps = readdirSync(dir).filter((f) => /^model_\d+\.glb$/.test(f)).sort();
  for (const f of comps) {
    const cdoc = await io.read(`${dir}/${f}`);
    const map = mergeDocuments(doc, cdoc);
    for (const s of cdoc.getRoot().listScenes()) {
      const ms = map.get(s);
      for (const n of ms.listChildren()) scene.addChild(n);
      ms.dispose();
    }
  }
  // Raíz con la orientación: rotaciones de AdvantageScope (en orden, premultiplicadas) y
  // después WPILib → simulador (−90° en X).
  let q = [0, 0, 0, 1];
  for (const r of cfg.rotations ?? []) q = qmul(axisQuat(r.axis, r.degrees), q);
  q = qmul(axisQuat('x', -90), q);
  const p = cfg.position ?? [0, 0, 0];
  const rootNode = doc.createNode('robot').setRotation(q).setTranslation([p[0], p[2], -p[1]]);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    rootNode.addChild(n);
  }
  scene.addChild(rootNode);
  // Quita tornillería/piezas diminutas y lo que pida la fuente (p. ej. BUMPERS propios)
  let removed = 0;
  const drop = src.drop ? new RegExp(src.drop, 'i') : null;
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const b = getBounds(n);
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    if (diag < (src.minPart ?? 0.03) || (drop && (drop.test(n.getName()) || drop.test(mesh.getName())))) {
      n.setMesh(null);
      removed++;
    }
  }
  // Chasis (para las medidas del robot en la física): piezas que quedan cerca del piso
  const frame = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const n of root.listNodes()) {
    if (!n.getMesh()) continue;
    const nb = getBounds(n);
    if (nb.max[1] > 0.14 || nb.min[1] > 0.06) continue;
    for (let k = 0; k < 3; k++) {
      frame.min[k] = Math.min(frame.min[k], nb.min[k]);
      frame.max[k] = Math.max(frame.max[k], nb.max[k]);
    }
  }
  // Materiales: colores del CAD agrupados (menos draw calls) y PBR según el color
  for (const m of root.listMaterials()) {
    const c = m.getBaseColorFactor();
    const rgb = c.slice(0, 3).map((v) => Math.round(v * 12) / 12);
    const mx = Math.max(...rgb);
    const mn = Math.min(...rgb);
    const gray = mx - mn < 0.08;
    m.setBaseColorFactor([...rgb, c[3] < 0.95 ? Math.round(c[3] * 4) / 4 : 1]);
    if (c[3] < 0.95) m.setAlphaMode('BLEND');
    m.setMetallicFactor(gray && mx > 0.45 ? 0.65 : 0.15).setRoughnessFactor(gray && mx > 0.45 ? 0.38 : 0.55).setDoubleSided(true);
    m.setName(`c${rgb.map((v) => Math.round(v * 12)).join('')}_${m.getAlphaMode()}`);
  }
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.MATERIAL] }),
    prune(),
    flatten(),
    join({ keepNamed: false }),
    weld({}),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: src.error ?? 0.002 }),
    prune(),
    dedup(),
  );
  const b = getBounds(scene);
  let tris = 0;
  // gltfpack: simplificación agresiva (ignora las costuras de normales del CAD, que impiden
  // simplificar) + cuantización + compresión meshopt.
  await doc.transform(unpartition());
  const tmp = `${OUT}/.${src.team}.raw.glb`;
  await io.write(tmp, doc);
  const out = `${OUT}/${src.team}.glb`;
  execFileSync(process.execPath, ['node_modules/gltfpack/cli.js', '-i', tmp, '-o', out, '-si', String(src.ratio ?? RATIO), '-sa', '-cc', '-kn'], { stdio: 'ignore' });
  rmSync(tmp);
  {
    const packed = await io.read(out);
    tris = 0;
    for (const m of packed.getRoot().listMeshes()) for (const pr of m.listPrimitives()) tris += (pr.getIndices()?.getCount() ?? 0) / 3;
  }
  const size = statSync(out).size;
  meta[src.team] = {
    bboxMin: b.min.map((v) => +v.toFixed(3)),
    bboxMax: b.max.map((v) => +v.toFixed(3)),
    frameMin: frame.min.map((v) => +v.toFixed(3)),
    frameMax: frame.max.map((v) => +v.toFixed(3)),
    triangles: Math.round(tris),
    kb: Math.round(size / 1024),
    removedParts: removed,
    materials: root.listMaterials().length,
  };
  console.log(src.team, JSON.stringify(meta[src.team]));
}
const metaFile = 'scripts/robots/models-meta.json';
const prev = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
writeFileSync(metaFile, JSON.stringify({ ...prev, ...meta }, null, 2) + '\n');
