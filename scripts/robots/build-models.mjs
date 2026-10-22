// Convierte los modelos 3D publicados por los equipos (assets de AdvantageScope en sus repos de
// código) en un GLB ligero para la web, CONSERVANDO LAS PARTES MÓVILES por separado:
//   - nodo `main`: el robot, con las rotaciones de config.json (marco WPILib: X adelante,
//     Y izquierda, Z arriba; el simulador lo gira a Y arriba al cargarlo);
//   - nodos `c0`, `c1`…: cada componente articulado (intake, hopper, turret, hood…) con su
//     transformación "zeroed" de config.json. En el simulador cada uno cuelga de un nodo que
//     recibe la pose del componente, igual que en AdvantageScope (ver src/render/cadRigs.ts).
// Pasos: quita tornillería, piezas diminutas y los BUMPERS propios; une por material dentro de
// cada parte; simplifica con un error absoluto que se ajusta al presupuesto de triángulos;
// asigna materiales PBR según el color del CAD; comprime con meshopt. Las mallas van soldadas y
// SIN normales (pesan un tercio): el simulador las calcula al cargar con ángulo de pliegue
// (superficies curvas suaves, aristas vivas), ver `creaseNormals` en src/render/RobotView.ts.
// Un CAD que no viene de AdvantageScope (SolidWorks/Onshape exportado a .glb) puede separar sus
// partes móviles por nombre de subensamble con `parts` (sources.mjs).
// Uso: node scripts/robots/build-models.mjs <carpeta-con-descargas> [equipo...]
// Las descargas: <carpeta>/<equipo>/{config.json, model.glb, model_N.glb} (fetch-sources.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, mergeDocuments, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SOURCES } from './sources.mjs';

const [srcDir, ...only] = process.argv.slice(2);
if (!srcDir) throw new Error('Uso: node scripts/robots/build-models.mjs <carpeta> [equipo...]');
const OUT = 'public/robots';
/** Triángulos por robot (todo el modelo) si la fuente no dice otra cosa. */
const BUDGET = Number(process.env.BUDGET ?? 140000);
/** Tornillería y piezas chicas que no se ven a escala de campo. */
const HARDWARE = /screw|bolt|\bnut\b|nut\b|washer|rivet|shcs|bhcs|fhcs|socket head|button head|nylock|lock ?nut|standoff|spacer|bearing|collar|zip ?tie|cable|wire|insert|\bpin\b|e-?clip|retaining|thread|tnut|t-nut|grommet|ferrule|terminal|connector|wago/i;
mkdirSync(OUT, { recursive: true });
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

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
/** Secuencia de rotaciones de AdvantageScope (en orden, cada una premultiplicada). */
const seqQuat = (rots) => {
  let q = [0, 0, 0, 1];
  // Algunos config.json traen `{}` en vez de `[]` (8214): sin rotaciones
  for (const r of Array.isArray(rots) ? rots : []) q = qmul(axisQuat(r.axis, r.degrees), q);
  return q;
};

/** PBR según el color del CAD (Onshape exporta todo metálico y casi espejo). */
function pbr(m) {
  const c = m.getBaseColorFactor();
  // Colores agrupados en pasos de 1/24 (menos materiales y draw calls)
  const rgb = c.slice(0, 3).map((v) => Math.round(v * 24) / 24);
  const mx = Math.max(...rgb);
  const mn = Math.min(...rgb);
  const gray = mx - mn < 0.06;
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; // lineal
  let metal = 0.12;
  let rough = 0.55;
  if (gray && lum > 0.35) [metal, rough] = [0.6, 0.42]; // aluminio
  else if (gray && lum > 0.08) [metal, rough] = [0.45, 0.5]; // acero / aluminio anodizado gris
  else if (gray) [metal, rough] = [0.15, 0.62]; // negro (anodizado, plástico, banda)
  else [metal, rough] = [0.18, 0.5]; // color: pintura en polvo o impresión 3D
  const alpha = c[3] < 0.95 ? Math.max(0.25, Math.round(c[3] * 4) / 4) : 1;
  m.setBaseColorFactor([...rgb, alpha]).setMetallicFactor(metal).setRoughnessFactor(rough).setDoubleSided(true);
  m.setAlphaMode(alpha < 1 ? 'BLEND' : 'OPAQUE');
  if (alpha < 1) m.setMetallicFactor(0).setRoughnessFactor(0.12);
  m.setName(`c${rgb.map((v) => Math.round(v * 24).toString(36)).join('')}${alpha < 1 ? 't' : ''}`);
}

/** Nombres del nodo y de sus ensambles padres (hasta `stop`). */
function nameChain(n, stop) {
  const out = [n.getName(), n.getMesh()?.getName() ?? ''];
  let p = n;
  for (let k = 0; k < 12; k++) {
    const parent = p.listParents().find((x) => x.propertyType === PropertyType.NODE);
    if (!parent || parent === stop) break;
    out.push(parent.getName());
    p = parent;
  }
  return out;
}

const mat4 = (m) => new THREE.Matrix4().fromArray(m);

/** ¿`n` cuelga de `a`? */
function isDescendant(n, a) {
  for (let p = n; p; p = p.listParents().find((x) => x.propertyType === PropertyType.NODE)) if (p === a) return true;
  return false;
}

/** Simplifica una malla soldada con error absoluto `e` (m). Devuelve índices. */
function simplifyChunk(ch, e) {
  if (e <= 0) return ch.index;
  const [idx] = MeshoptSimplifier.simplify(ch.index, ch.pos, 3, 0, e, ['ErrorAbsolute']);
  return idx;
}

const meta = existsSync('scripts/robots/models-meta.json') ? JSON.parse(readFileSync('scripts/robots/models-meta.json', 'utf8')) : {};
for (const src of SOURCES) {
  if (only.length && !only.includes(String(src.team))) continue;
  const dir = `${srcDir}/${src.team}`;
  const cfg = JSON.parse(readFileSync(`${dir}/config.json`, 'utf8'));
  const doc = await io.read(`${dir}/model.glb`);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // ---- Partes: `main` + componentes con su transformación zeroed
  const main = doc.createNode('main').setRotation(seqQuat(cfg.rotations)).setTranslation(cfg.position ?? [0, 0, 0]);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    main.addChild(n);
  }
  scene.addChild(main);
  const groups = [main];
  for (let i = 0; i < (cfg.components ?? []).length; i++) {
    const f = `${dir}/model_${i}.glb`;
    if (!existsSync(f)) continue;
    const c = cfg.components[i];
    const cdoc = await io.read(f);
    const map = mergeDocuments(doc, cdoc);
    const g = doc.createNode(`c${i}`).setRotation(seqQuat(c.zeroedRotations)).setTranslation(c.zeroedPosition ?? [0, 0, 0]);
    for (const s of cdoc.getRoot().listScenes()) {
      const ms = map.get(s);
      for (const n of ms.listChildren()) {
        ms.removeChild(n);
        g.addChild(n);
      }
      ms.dispose();
    }
    scene.addChild(g);
    groups.push(g);
  }
  // ---- CAD sin assets de AdvantageScope (`parts`): los subensambles que se mueven, por nombre,
  // pasan a ser los componentes c0, c1… con zeroed nulo (malla en el marco WPILib del robot).
  // Si el asset ya trae componentes, los de `parts` siguen después de ellos.
  const mainM = mat4(main.getWorldMatrix());
  const mainInv = mainM.clone().invert();
  for (const re of (src.parts ?? []).map((r) => new RegExp(r, 'i'))) {
    const i = groups.length - 1;
    const g = doc.createNode(`c${i}`);
    const frame = doc.createNode(`c${i}_frame`).setMatrix(mainM.toArray());
    g.addChild(frame);
    const hits = [];
    main.traverse((n) => {
      if (n !== main && re.test(n.getName()) && !hits.some((h) => isDescendant(n, h))) hits.push(n);
    });
    if (!hits.length) throw new Error(`${src.team}: ninguna pieza coincide con ${re}`);
    for (const n of hits) {
      const m = mainInv.clone().multiply(mat4(n.getWorldMatrix()));
      for (const p of n.listParents()) if (p.propertyType === PropertyType.NODE) p.removeChild(n);
      n.setMatrix(m.toArray());
      frame.addChild(n);
    }
    scene.addChild(g);
    groups.push(g);
  }
  // ---- Quita tornillería, piezas diminutas y BUMPERS
  const drop = src.drop ? new RegExp(src.drop, 'i') : null;
  const hl = src.frameIn ? (src.frameIn[0] * 0.0254) / 2 : 1;
  const hw = src.frameIn ? (src.frameIn[1] * 0.0254) / 2 : 1;
  let removed = 0;
  for (const g of groups)
    g.traverse((n) => {
      if (!n.getMesh()) return;
      const b = getBounds(n);
      const size = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
      const diag = Math.hypot(...size);
      const names = nameChain(n, g);
      let bumper = false;
      if (g === main && src.bumperGeom) {
        // En `main` las coordenadas ya son WPILib (Z arriba)
        const cx = (b.min[0] + b.max[0]) / 2;
        const cy = (b.min[1] + b.max[1]) / 2;
        const outside = Math.abs(cx) > hl + 0.005 || Math.abs(cy) > hw + 0.005;
        const exceeds = b.max[0] > hl + 0.03 || b.min[0] < -hl - 0.03 || b.max[1] > hw + 0.03 || b.min[1] < -hw - 0.03;
        bumper = b.max[2] < 0.2 && (outside || exceeds);
      }
      // Cubos de referencia de la exportación ("Origin/Reference Cube", o con alfa 0: invisibles en AdvantageScope)
      const invisible = n.getMesh().listPrimitives().every((pr) => (pr.getMaterial()?.getBaseColorFactor()[3] ?? 1) < 0.02) || /origin cube|reference cube/i.test(names[0]);
      if (invisible || diag < (src.minPart ?? 0.025) || (diag < 0.08 && names.some((s) => HARDWARE.test(s))) || (drop && names.some((s) => drop.test(s))) || bumper) {
        n.setMesh(null);
        removed++;
      }
    });
  // ---- Materiales. La transmisión de SolidWorks (lexan, vidrio) pasa a transparencia simple:
  // la de three.js es un render extra de la escena por cuadro.
  for (const m of root.listMaterials()) {
    const tr = m.getExtension('KHR_materials_transmission');
    if (tr && tr.getTransmissionFactor() > 0) {
      const c = m.getBaseColorFactor();
      m.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.4)]);
    }
  }
  for (const e of root.listExtensionsUsed()) if (/^KHR_materials_(transmission|volume|ior)$/.test(e.extensionName)) e.dispose();
  for (const m of root.listMaterials()) pbr(m);
  await doc.transform(dedup({ propertyTypes: [PropertyType.MATERIAL] }));
  // ---- Geometría de cada parte, en el marco de la parte, agrupada por material y soldada
  const parts = [];
  for (const g of groups) {
    const inv = mat4(g.getWorldMatrix()).invert();
    const byMat = new Map();
    g.traverse((n) => {
      const mesh = n.getMesh();
      if (!mesh || n === g) return;
      const m = inv.clone().multiply(mat4(n.getWorldMatrix()));
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue;
        const pa = prim.getAttribute('POSITION');
        if (!pa) continue;
        const mat = prim.getMaterial();
        let ch = byMat.get(mat);
        if (!ch) byMat.set(mat, (ch = { pos: [], idx: [] }));
        const base = ch.pos.length / 3;
        const v = new THREE.Vector3();
        const el = [0, 0, 0];
        for (let k = 0; k < pa.getCount(); k++) {
          pa.getElement(k, el);
          v.fromArray(el).applyMatrix4(m);
          ch.pos.push(v.x, v.y, v.z);
        }
        const ia = prim.getIndices();
        if (ia) for (let k = 0; k < ia.getCount(); k++) ch.idx.push(base + ia.getScalar(k));
        else for (let k = 0; k < pa.getCount(); k++) ch.idx.push(base + k);
      }
    });
    for (const c of g.listChildren()) {
      g.removeChild(c);
      // Los subensambles movidos por `parts` no siempre los quita prune(): se desechan aquí
      if (g !== main) {
        const sub = [];
        c.traverse((n) => sub.push(n));
        for (const n of sub.reverse()) n.dispose();
      }
    }
    const chunks = [];
    for (const [mat, ch] of byMat) {
      if (!ch.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
      geo.setIndex(ch.idx);
      const w = mergeVertices(geo, 1e-5);
      chunks.push({ mat, pos: new Float32Array(w.getAttribute('position').array), index: new Uint32Array(w.getIndex().array) });
    }
    parts.push({ g, chunks });
  }
  // ---- Error de simplificación que cabe en el presupuesto (búsqueda binaria, escala log)
  const budget = src.budget ?? BUDGET;
  const count = (e) => parts.reduce((a, p) => a + p.chunks.reduce((b, ch) => b + simplifyChunk(ch, e).length / 3, 0), 0);
  const raw = count(0);
  let lo = 1e-4;
  let hi = 6e-3;
  let err = lo;
  if (count(lo) > budget) {
    for (let it = 0; it < 8; it++) {
      const mid = Math.sqrt(lo * hi);
      if (count(mid) > budget) lo = mid;
      else hi = mid;
    }
    err = hi;
  }
  // ---- Mallas finales
  let tris = 0;
  const partMeta = {};
  for (const { g, chunks } of parts) {
    const mesh = doc.createMesh(g.getName());
    const box = new THREE.Box3();
    let ptris = 0;
    for (const ch of chunks) {
      const idx = simplifyChunk(ch, err);
      if (idx.length < 3) continue;
      const flat = new Float32Array(idx.length * 3);
      for (let k = 0; k < idx.length; k++) flat.set(ch.pos.subarray(idx[k] * 3, idx[k] * 3 + 3), k * 3);
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(flat, 3));
      geo = mergeVertices(geo, 1e-6);
      geo.computeBoundingBox();
      box.union(geo.boundingBox);
      const P = geo.getAttribute('position');
      const I = geo.getIndex();
      const buf = root.listBuffers()[0] ?? doc.createBuffer();
      const prim = doc
        .createPrimitive()
        .setMaterial(ch.mat)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P.array)).setBuffer(buf))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(P.count > 65535 ? new Uint32Array(I.array) : new Uint16Array(I.array)).setBuffer(buf));
      mesh.addPrimitive(prim);
      ptris += I.count / 3;
    }
    tris += ptris;
    // La malla va en un hijo: la cuantización ajusta la transformación del nodo de la malla
    // y la del nodo de la parte (zeroed) queda intacta para el simulador.
    g.addChild(doc.createNode(`${g.getName()}_mesh`).setMesh(mesh));
    partMeta[g.getName()] = {
      triangles: Math.round(ptris),
      min: box.isEmpty() ? null : box.min.toArray().map((v) => +v.toFixed(3)),
      max: box.isEmpty() ? null : box.max.toArray().map((v) => +v.toFixed(3)),
    };
  }
  await doc.transform(prune({ keepLeaves: false }), dedup());
  // Un solo buffer (los componentes traían el suyo) y sin texturas (los CAD solo usan colores)
  const [buf0, ...extraBufs] = root.listBuffers();
  for (const a of root.listAccessors()) a.setBuffer(buf0);
  for (const t of root.listTextures()) t.dispose();
  for (const b of extraBufs) b.dispose();
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const out = `${OUT}/${src.team}.glb`;
  await io.write(out, doc);
  const kb = Math.round(statSync(out).size / 1024);
  meta[src.team] = { trianglesRaw: Math.round(raw), triangles: Math.round(tris), errorMm: +(err * 1000).toFixed(2), kb, removedParts: removed, materials: root.listMaterials().length, parts: partMeta };
  console.log(src.team, JSON.stringify({ raw: Math.round(raw), tris: Math.round(tris), errMm: +(err * 1000).toFixed(2), kb, removed, mats: root.listMaterials().length }));
}
writeFileSync('scripts/robots/models-meta.json', JSON.stringify(meta, null, 2) + '\n');
