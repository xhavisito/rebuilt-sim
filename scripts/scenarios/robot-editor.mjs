// Taller de robots: importar un CAD propio (GLB), ajustarlo, guardarlo (sobrevive a recargar),
// jugar un match con él y exportar / importar el robot como archivo.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4188);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'es-MX' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
const fail = (m) => {
  console.log('FAIL', m);
  process.exitCode = 1;
};
await page.goto(`${server.url}/`);
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate(() => window.app.openRobotEditor());
await page.selectOption('[data-sel="pick"]', 'new');
// Asset de AdvantageScope (metros, Z arriba): se adivina la unidad; el eje se corrige a mano
await page.setInputFiles('[data-cadfile]', 'public/robots/1678.glb');
await page.waitForSelector('[data-cadmsg] .msg.ok', { timeout: 30000 });
let cad = await page.evaluate(() => window.app.editor.spec.customCad);
console.log('imported', JSON.stringify(cad));
if (!cad || cad.unit !== 1) fail('unidad adivinada');
await page.click('[data-seg="cup"] [data-v="z"]');
await page.click('[data-cadfit]');
await page.click('[data-cadmeasure]');
const dims = await page.evaluate(() => { const s = window.app.editor.spec; return [s.lengthIn, s.widthIn, s.heightIn]; });
console.log('measured (in)', dims);
if (dims[2] > 30 || dims[2] < 12) fail('altura medida');
// Piezas que se mueven: una turret y una intake del CAD
const opts = await page.$$eval('[data-sel="cturret"] option', (o) => o.map((x) => x.value).filter(Boolean));
console.log('nodes', opts.length, opts.slice(0, 6));
await page.selectOption('[data-sel="cturret"]', opts[1] ?? opts[0]);
await page.selectOption('[data-sel="cintake"]', opts[2] ?? opts[0]);
await page.waitForFunction(() => window.app.screens.showroom.robot?.customTurret, null, { timeout: 10000 }).catch(() => fail('turret del CAD'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/robot-editor-cad.png' });
const id = await page.evaluate(() => window.app.editor.spec.id);
await page.click('[data-save]');
// Recargar: el GLB vuelve de IndexedDB
await page.reload();
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate((id) => { window.app.settings.match.robotId = id; window.app.openRobotEditor(); }, id);
await page.waitForFunction(() => window.app.screens.showroom.robot?.cadLoaded, null, { timeout: 15000 }).catch(() => fail('CAD tras recargar'));
console.log('after reload: cad in showroom', await page.evaluate(() => !!window.app.screens.showroom.robot?.cadLoaded));
// Match con el robot propio
await page.click('[data-use]');
await page.evaluate(() => window.app.startMatch());
await page.waitForTimeout(3000);
const inMatch = await page.evaluate(() => { const r = window.app.session.playerRobot(0); return { name: r.spec.name, cad: r.view.cadLoaded, node: !!r.view.group.getObjectByName('cad') }; });
console.log('match robot', JSON.stringify(inMatch));
if (!inMatch.cad) fail('CAD en el match');
await page.screenshot({ path: 'shots/robot-editor-match.png' });
// Exportar e importar
await page.evaluate(() => window.app.quitToMenu());
await page.evaluate(() => window.app.openRobotEditor());
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export]')]);
const file = await dl.path();
console.log('exported', dl.suggestedFilename());
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('rebuilt-sim.robots.v1')).length);
await page.setInputFiles('[data-robotfile]', file);
await page.waitForSelector('[data-filemsg] .msg.ok', { timeout: 30000 });
const after = await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('rebuilt-sim.robots.v1')); return { n: l.length, cad: l[l.length - 1].customCad }; });
console.log('imported robots', before, '→', after.n, JSON.stringify(after.cad));
if (after.n !== before + 1 || !after.cad || after.cad.upAxis !== 'z') fail('importar robot');
await page.waitForFunction(() => window.app.screens.showroom.robot?.cadLoaded, null, { timeout: 15000 }).catch(() => fail('CAD del robot importado'));
await browser.close();
server.close();
console.log(process.exitCode ? 'robot-editor: FAIL' : 'robot-editor: OK');
