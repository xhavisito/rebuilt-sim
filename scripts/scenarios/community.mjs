// Galería de robots de la comunidad contra un Supabase simulado (page.route): un jugador publica
// su robot con CAD, otro (navegador limpio) lo ve, lo descarga y juega con él; reportar y borrar.
// Compila su propia versión con la galería activada (dist-community/).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';

const HUB = 'https://hub.test';
const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-community', '--logLevel', 'error'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: HUB, VITE_SUPABASE_ANON_KEY: 'anon-test' },
});
if (b.status !== 0) process.exit(1);
const server = await startServer(4189, 'dist-community');
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const fail = (m) => {
  console.log('FAIL', m);
  process.exitCode = 1;
};

// --- Supabase simulado (compartido entre los dos navegadores)
const rows = [];
const files = new Map();
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let uploads = 0;
async function mock(route) {
  const req = route.request();
  const u = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.headers()['apikey'] !== 'anon-test' && !u.pathname.includes('/object/public/')) return json({ message: 'no key' }, 401);
  if (u.pathname === '/rest/v1/robots' && req.method() === 'GET')
    return json(rows.filter((r) => r.reports < 3).map(({ delete_hash, reports, ...r }) => r).reverse());
  if (u.pathname === '/rest/v1/robots' && req.method() === 'POST') {
    const body = req.postDataJSON();
    const row = { ...body, id: crypto.randomUUID(), created_at: new Date().toISOString(), downloads: 0, reports: 0 };
    rows.push(row);
    return json([{ id: row.id }], 201);
  }
  if (u.pathname.startsWith('/storage/v1/object/robots/') && req.method() === 'POST') {
    uploads++;
    files.set(u.pathname.split('/').pop(), req.postDataBuffer());
    return json({ Key: u.pathname });
  }
  if (u.pathname.startsWith('/storage/v1/object/public/robots/')) {
    const f = files.get(u.pathname.split('/').pop());
    return f ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'model/gltf-binary' }, body: f }) : json({}, 404);
  }
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.split('/').pop();
    const { rid, token } = req.postDataJSON();
    const row = rows.find((r) => r.id === rid);
    if (fn === 'report_robot' && row) row.reports++;
    if (fn === 'count_download' && row) row.downloads++;
    if (fn === 'delete_robot') {
      const h = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
      const ok = !!row && row.delete_hash === h;
      if (ok) rows.splice(rows.indexOf(row), 1);
      return json(ok);
    }
    return json(null);
  }
  return json({ message: 'not mocked' }, 404);
}

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-MX' });
  await ctx.route(`${HUB}/**`, mock);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'PAGEERR', e.message));
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  return page;
}

// --- Jugador A: importa su CAD y lo publica
const a = await player('A');
await a.evaluate(() => { window.app.settings.driverName = 'Piloto A'; window.app.save(); window.app.openRobotEditor(); });
await a.selectOption('[data-sel="pick"]', 'new');
await a.fill('[data-name]', 'Bestia');
await a.dispatchEvent('[data-name]', 'input');
await a.setInputFiles('[data-cadfile]', 'public/robots/1678.glb');
await a.waitForSelector('[data-cadmsg] .msg.ok', { timeout: 30000 });
await a.click('[data-seg="cup"] [data-v="z"]');
await a.click('[data-save]');
await a.click('[data-publish]'); // primer clic: aviso de que será público
await a.click('[data-publish]');
await a.waitForSelector('[data-filemsg] .msg.ok', { timeout: 30000 }).catch(() => fail('publicar'));
console.log('published', JSON.stringify({ rows: rows.length, uploads, name: rows[0]?.name, author: rows[0]?.author, upAxis: rows[0]?.spec?.customCad?.upAxis, specId: rows[0]?.spec?.id ?? null }));
if (rows.length !== 1 || uploads !== 1 || rows[0].spec.id) fail('fila publicada');
if (readFileSync('public/robots/1678.glb').length !== [...files.values()][0].length) fail('GLB subido completo');

// Sin GPU, dos pestañas dibujando a la vez se estorban: A se va a una página en blanco mientras tanto
await a.goto('about:blank');

// --- Jugador B (navegador limpio): lo ve en la galería, lo previsualiza y lo descarga
const bp = await player('B');
await bp.evaluate(() => window.app.openCommunity());
await bp.waitForSelector('.rcard[data-id]', { timeout: 15000 }).catch(() => fail('lista de la galería'));
await bp.waitForFunction(() => window.app.screens.showroom.robot?.cadLoaded, null, { timeout: 45000 }).catch(() => fail('vista previa con CAD'));
await bp.waitForFunction(() => document.querySelector('img[data-thumb]')?.src, null, { timeout: 45000 }).catch(() => fail('miniatura'));
await bp.screenshot({ path: 'shots/community-gallery.png' });
await bp.click('[data-get]');
await bp.waitForSelector('[data-sel="pick"]', { timeout: 15000 });
const got = await bp.evaluate(() => { const s = window.app.editor.spec; return { id: s.id, name: s.name, cad: !!s.customCad, url: s.customCad?.url?.slice(0, 40) }; });
console.log('B downloaded', JSON.stringify(got), 'downloads', rows[0]?.downloads);
if (!got.cad || got.name !== 'Bestia') fail('descarga');
await bp.click('[data-use]');
await bp.evaluate(() => window.app.startMatch());
await bp.waitForTimeout(2500);
const inMatch = await bp.evaluate(() => { const r = window.app.session.playerRobot(0); return { name: r.spec.name, cad: r.view.cadLoaded }; });
console.log('B match robot', JSON.stringify(inMatch));
if (!inMatch.cad) fail('CAD de la galería en el match');
// Sin red al recargar: el GLB quedó en IndexedDB
await bp.context().unroute(`${HUB}/**`);
await bp.context().route(`${HUB}/**`, (r) => r.abort());
await bp.reload();
await bp.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
await bp.evaluate(() => window.app.openRobotEditor());
await bp.waitForFunction(() => window.app.screens.showroom.robot?.cadLoaded, null, { timeout: 15000 }).catch(() => fail('CAD guardado sin red'));
console.log('B offline reload: cad', await bp.evaluate(() => !!window.app.screens.showroom.robot?.cadLoaded));

// --- B no puede borrarlo (no es suyo) pero sí reportarlo; A sí lo borra
await bp.context().unroute(`${HUB}/**`);
await bp.context().route(`${HUB}/**`, mock);
await bp.evaluate(() => window.app.openCommunity());
await bp.waitForSelector('[data-report]');
if (await bp.$('[data-del]')) fail('B ve "borrar"');
await bp.click('[data-report]');
await bp.waitForTimeout(300);
console.log('reports', rows[0]?.reports);
await bp.goto('about:blank');
await a.goto(`${server.url}/`);
await a.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
await a.evaluate(() => window.app.openCommunity());
await a.waitForSelector('[data-del]', { timeout: 15000 });
await a.click('[data-del]');
await a.waitForTimeout(500);
console.log('after delete rows', rows.length);
if (rows.length !== 0) fail('borrar el propio');

await browser.close();
server.close();
console.log(process.exitCode ? 'community: FAIL' : 'community: OK');
