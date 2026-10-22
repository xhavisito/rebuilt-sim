// Descarga los assets de AdvantageScope de cada robot (ver sources.mjs) a <carpeta>/<equipo>/:
// config.json, model.glb y los componentes articulados model_0.glb, model_1.glb…
// Usa raw.githubusercontent.com (sin la API de GitHub ni su límite de peticiones); los GLB en Git
// LFS (`lfs`) vienen de media.githubusercontent.com y los assets en un .zip (`zip`) se extraen.
// Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]
// Después: node scripts/robots/build-models.mjs <carpeta>
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { SOURCES } from './sources.mjs';

const [dir, ...only] = process.argv.slice(2);
if (!dir) throw new Error('Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]');
for (const s of SOURCES) {
  if (only.length && !only.includes(String(s.team))) continue;
  if (s.local) {
    mkdirSync(`${dir}/${s.team}`, { recursive: true });
    copyFileSync(`scripts/robots/local/${s.team}/config.json`, `${dir}/${s.team}/config.json`);
    console.log(s.team, `local: falta copiar a mano el CAD (${s.local}) como ${dir}/${s.team}/model.glb`);
    continue;
  }
  const path = s.path.split('/').map(encodeURIComponent).join('/');
  const base = `https://raw.githubusercontent.com/${s.repo}/HEAD/${path}`;
  const media = s.lfs ? `https://media.githubusercontent.com/media/${s.repo}/HEAD/${path}` : base;
  mkdirSync(`${dir}/${s.team}`, { recursive: true });
  if (s.zip) {
    // config.json, model.glb y model_N.glb dentro del .zip (sin carpetas)
    const r = await fetch(`${base}/${encodeURIComponent(s.zip)}`);
    if (!r.ok) throw new Error(`${base}/${s.zip}: ${r.status}`);
    writeFileSync(`${dir}/${s.team}/asset.zip`, Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', '-j', '-q', `${dir}/${s.team}/asset.zip`, 'config.json', 'model.glb', 'model_[0-9]*.glb', '-d', `${dir}/${s.team}`]);
    console.log(s.team, 'zip');
    continue;
  }
  let n = 0;
  for (const f of ['config.json', 'model.glb']) {
    const r = await fetch(`${f === 'config.json' ? base : media}/${f}`);
    if (!r.ok) throw new Error(`${base}/${f}: ${r.status}`);
    writeFileSync(`${dir}/${s.team}/${f}`, Buffer.from(await r.arrayBuffer()));
    n++;
  }
  // Componentes: model_0.glb, model_1.glb… hasta el primero que no exista
  for (let i = 0; ; i++) {
    const r = await fetch(`${media}/model_${i}.glb`);
    if (!r.ok) break;
    writeFileSync(`${dir}/${s.team}/model_${i}.glb`, Buffer.from(await r.arrayBuffer()));
    n++;
  }
  console.log(s.team, n, 'archivos');
}
