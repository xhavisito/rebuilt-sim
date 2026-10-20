// Descarga los assets de AdvantageScope de cada robot (ver sources.mjs) a <carpeta>/<equipo>/.
// Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]
// Después: node scripts/robots/build-models.mjs <carpeta>
import { mkdirSync, writeFileSync } from 'node:fs';
import { SOURCES } from './sources.mjs';

const [dir, ...only] = process.argv.slice(2);
if (!dir) throw new Error('Uso: node scripts/robots/fetch-sources.mjs <carpeta> [equipo...]');
const gh = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'rebuilt-sim', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
for (const s of SOURCES) {
  if (only.length && !only.includes(String(s.team))) continue;
  const repo = await gh(`https://api.github.com/repos/${s.repo}`);
  const tree = await gh(`https://api.github.com/repos/${s.repo}/git/trees/${repo.default_branch}?recursive=1`);
  const files = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(`${s.path}/`) && /\.(glb|json)$/.test(e.path));
  mkdirSync(`${dir}/${s.team}`, { recursive: true });
  for (const f of files) {
    const r = await fetch(`https://raw.githubusercontent.com/${s.repo}/${repo.default_branch}/${f.path}`);
    writeFileSync(`${dir}/${s.team}/${f.path.split('/').pop()}`, Buffer.from(await r.arrayBuffer()));
  }
  console.log(s.team, files.length, 'archivos');
}
