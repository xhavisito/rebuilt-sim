// Capturas de scripts/robots/preview.html para revisar el rig de un robot CAD sin abrir el juego.
// Requiere `npm run dev` corriendo. Guarda shots/robot-<archivo>-<vista>.png.
// Uso: node scripts/robots/preview-shots.mjs 401.glb [vistas=iso,front,side,top] ["intake=1&tint=1"]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [file, viewsArg = 'iso,front,side,top', extra = ''] = process.argv.slice(2);
if (!file) throw new Error('Uso: node scripts/robots/preview-shots.mjs <archivo.glb> [vistas] [query]');
mkdirSync('shots', { recursive: true });
// PW_CHROMIUM: otro Chromium si el de esta versión de Playwright no está instalado
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
for (const view of viewsArg.split(',')) {
  await page.goto(`http://localhost:5173/scripts/robots/preview.html?file=${file}&view=${view}&${extra}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '_')}` : '';
  const out = `shots/robot-${file.replace('.glb', '')}-${view}${tag}.png`;
  await page.screenshot({ path: out });
  console.log(out);
}
await browser.close();
