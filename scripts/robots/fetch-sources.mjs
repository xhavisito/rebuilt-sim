// Descarga los assets de AdvantageScope de cada robot (ver sources.mjs) a <carpeta>/<equipo>/:
// config.json, model.glb y los componentes articulados model_0.glb, model_1.glb…
// Usa raw.githubusercontent.com (sin la API de GitHub ni su límite de peticiones).
// Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]
// Después: node scripts/robots/build-models.mjs <carpeta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { SOURCES } from './sources.mjs';

const [dir, ...only] = process.argv.slice(2);
if (!dir) throw new Error('Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]');
for (const s of SOURCES) {
  if (only.length && !only.includes(String(s.team))) continue;
  const base = `https://raw.githubusercontent.com/${s.repo}/HEAD/${s.path}`;
  mkdirSync(`${dir}/${s.team}`, { recursive: true });
  let n = 0;
  for (const f of ['config.json', 'model.glb']) {
    const r = await fetch(`${base}/${f}`);
    if (!r.ok) throw new Error(`${base}/${f}: ${r.status}`);
    writeFileSync(`${dir}/${s.team}/${f}`, Buffer.from(await r.arrayBuffer()));
    n++;
  }
  // Componentes: model_0.glb, model_1.glb… hasta el primero que no exista
  for (let i = 0; ; i++) {
    const r = await fetch(`${base}/model_${i}.glb`);
    if (!r.ok) break;
    writeFileSync(`${dir}/${s.team}/model_${i}.glb`, Buffer.from(await r.arrayBuffer()));
    n++;
  }
  console.log(s.team, n, 'archivos');
}
