// Genera un CAD de prueba "pesado" como los que exporta Onshape (mm, Y arriba, cientos de piezas,
// tornillería): node scripts/robots/heavy-cad.mjs <salida.glb> [piezas]. Lo usa el escenario
// e2e robot-editor para probar que el taller aligera archivos grandes.
import { writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const out = process.argv[2] ?? 'heavy.glb';
const parts = Number(process.argv[3] ?? 260);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('robot');
const root = doc.createNode('Robot').setScale([1, 1, 1]);
scene.addChild(root);
const mats = ['#30343b', '#c0c4cc', '#f2b705', '#1e88e5'].map((c, i) => {
  const col = new THREE.Color(c);
  return doc.createMaterial(`m${i}`).setBaseColorFactor([col.r, col.g, col.b, 1]).setMetallicFactor(0.4).setRoughnessFactor(0.5);
});
function mesh(name, geo, mat) {
  const g = geo.index ? geo : geo;
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('position').array)).setBuffer(buffer);
  const nor = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('normal').array)).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setMaterial(mat);
  if (g.index) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index.array)).setBuffer(buffer));
  return doc.createMesh(name).addPrimitive(prim);
}
// Chasis 700 × 700 mm, piezas densas (como un CAD con resolución "Fine") y tornillos
const frame = doc.createNode('Frame').setMesh(mesh('frame', new THREE.BoxGeometry(700, 50, 700, 60, 8, 60), mats[1])).setTranslation([0, 80, 0]);
root.addChild(frame);
const turret = doc.createNode('Turret').setTranslation([-120, 380, 0]);
turret.setMesh(mesh('turret', new THREE.CylinderGeometry(140, 140, 120, 256, 40), mats[0]));
root.addChild(turret);
const intake = doc.createNode('Intake').setTranslation([380, 120, 0]);
intake.setMesh(mesh('intake', new THREE.CylinderGeometry(30, 30, 640, 128, 80).rotateX(Math.PI / 2), mats[2]));
root.addChild(intake);
for (let i = 0; i < parts; i++) {
  const sphere = new THREE.SphereGeometry(40 + (i % 5) * 6, 96, 64);
  const n = doc.createNode(`Part_${i}`).setMesh(mesh(`part${i}`, sphere, mats[i % 4]));
  n.setTranslation([((i % 13) - 6) * 50, 150 + Math.floor(i / 13) * 18, ((i * 7) % 13 - 6) * 50]);
  root.addChild(n);
}
const screw = mesh('screw', new THREE.CylinderGeometry(2, 2, 10, 24, 4), mats[1]);
for (let i = 0; i < 600; i++) root.addChild(doc.createNode(`Screw_${i}`).setMesh(screw).setTranslation([((i % 30) - 15) * 22, 106, (Math.floor(i / 30) - 10) * 33]));
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(out, glb);
console.log(out, (glb.byteLength / 1024 / 1024).toFixed(1), 'MB');
