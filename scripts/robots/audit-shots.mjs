// Capturas de scripts/robots/audit.html de todos los robots CAD (o los que se pasen), para revisar
// que el shooter, la turret y el hopper del modelo coincidan con la spec. Requiere `npm run dev`.
// Uso: node scripts/robots/audit-shots.mjs [cad-401,cad-2363] [vistas=top,iso] ["intake=1&turret=60"]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const src = readFileSync('src/config/robots.ts', 'utf8');
const all = [...src.matchAll(/id: '(cad-\d+)'/g)].map((m) => m[1]);
const [idsArg, viewsArg = 'top,iso', extra = ''] = process.argv.slice(2);
const ids = idsArg ? idsArg.split(',') : all;
mkdirSync('shots/audit', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
for (const id of ids)
  for (const view of viewsArg.split(',')) {
    await page.goto(`http://localhost:5173/scripts/robots/audit.html?id=${id}&view=${view}&${extra}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    const out = `shots/audit/${id}-${view}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '_') : ''}.png`;
    await page.screenshot({ path: out });
    console.log(out);
  }
await browser.close();
