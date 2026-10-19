// Ejecuta todos los escenarios e2e en serie.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let fail = 0;
for (const f of readdirSync('scripts/scenarios').filter((x) => x.endsWith('.mjs') && !x.startsWith('_'))) {
  console.log(`\n### ${f}`);
  const r = spawnSync('node', [`scripts/scenarios/${f}`], { stdio: 'inherit', timeout: 180000 });
  if (r.status !== 0) fail++;
}
process.exit(fail ? 1 : 0);
