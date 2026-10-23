// Ranking global con backend: el SQL real (docs/ranking.sql) en un Postgres local desechable y la
// página compilada con un Supabase de prueba cuyas llamadas RPC se pasan a ese Postgres (como el
// rol anon, igual que PostgREST). Un jugador termina un match → cuenta creada, match validado y
// rating calculado en el servidor; aparece en el ranking; su código de cuenta funciona en otro
// navegador; salir del ranking borra la cuenta. Sin Postgres instalado, se omite.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';

const pgBin = ['/usr/lib/postgresql'].filter(existsSync).flatMap((d) => readdirSync(d).map((v) => `${d}/${v}/bin`)).find((d) => existsSync(`${d}/initdb`));
if (!pgBin) {
  console.log('SKIP ranking: no hay Postgres (initdb) instalado');
  process.exit(0);
}

// --- Postgres desechable con el SQL del ranking
const dir = mkdtempSync('/var/tmp/rk-e2e-');
const asPg = process.getuid?.() === 0;
const sh = (cmd) => (asPg ? execFileSync('su', ['postgres', '-c', cmd]) : execFileSync('bash', ['-c', cmd]));
if (asPg) execFileSync('chown', ['-R', 'postgres', dir]);
const PORT = 5497;
sh(`${pgBin}/initdb -D ${dir}/data -A trust -U postgres >/dev/null`);
sh(`${pgBin}/pg_ctl -D ${dir}/data -o '-p ${PORT} -k ${dir} -c listen_addresses=' -l ${dir}/log -w start >/dev/null`);
process.on('exit', () => {
  try {
    sh(`${pgBin}/pg_ctl -D ${dir}/data stop -m fast >/dev/null`);
  } catch {
    /* ya parado */
  }
  rmSync(dir, { recursive: true, force: true });
});
const psql = (args, input) => spawnSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8' });
const setup = psql(['-q'], `
  create schema extensions; create extension pgcrypto schema extensions;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, extensions to anon, authenticated;
  \\i docs/ranking.sql`);
if (setup.status !== 0) throw new Error(setup.stderr);
const sql = (q) => psql(['-c', q]).stdout.trim();

// Firma de cada función: PostgREST arma la llamada con argumentos nombrados desde el JSON
const SIG = {
  register_player: { name: 'text', token: 'text' },
  rename_player: { pid: 'uuid', token: 'text', name: 'text' },
  delete_player: { pid: 'uuid', token: 'text' },
  submit_match: { pid: 'uuid', token: 'text', m: 'jsonb' },
  leaderboard: { sort: 'text', lim: 'int' },
  player_rank: { pid: 'uuid' },
};
function callRpc(fn, body) {
  const sig = SIG[fn];
  if (!sig) return { status: 404, body: { message: 'no rpc' } };
  const args = Object.entries(sig).map(([k, ty]) => `${k} => (:'b'::jsonb->${ty === 'jsonb' ? '' : '>'}'${k}')::${ty}`);
  const call = `public.${fn}(${args.join(', ')})`;
  const q = fn === 'leaderboard' ? `select coalesce(jsonb_agg(x), '[]') from ${call} x` : `select to_jsonb(${call})`;
  const r = psql(['-v', `b=${JSON.stringify(body)}`], `set role anon;\n${q};\n`);
  if (r.status !== 0) return { status: 400, body: { message: (r.stderr.match(/ERROR:\s+(.*)/) ?? [])[1]?.trim() ?? r.stderr, code: 'P0001' } };
  return { status: 200, body: JSON.parse(r.stdout.trim().split('\n').pop()) };
}

// --- Página con el "Supabase" de prueba
const HUB = 'https://rank.test';
const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-ranking', '--logLevel', 'error'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: HUB, VITE_SUPABASE_ANON_KEY: 'anon-test' },
});
if (b.status !== 0) process.exit(1);
const server = await startServer(4188, 'dist-ranking');
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'], executablePath: process.env.CHROMIUM_PATH || undefined });
let failed = 0;
const check = (ok, msg) => {
  console.log(ok ? 'OK ' : 'FAIL', msg);
  if (!ok) failed++;
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function route(r) {
  const req = r.request();
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  const u = new URL(req.url());
  if (req.headers()['apikey'] !== 'anon-test') return r.fulfill({ status: 401, headers: cors, body: '{}' });
  if (!u.pathname.startsWith('/rest/v1/rpc/')) return r.fulfill({ status: 404, headers: cors, body: '[]' });
  const out = callRpc(u.pathname.split('/').pop(), req.postDataJSON() ?? {});
  return r.fulfill({ status: out.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(out.body) });
}
const logs = [];
async function player(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-MX' });
  await ctx.route(`${HUB}/**`, route);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`${tag} ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`${tag} ${m.text()}`));
  await page.goto(`${server.url}/?mode=match`);
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  return page;
}

// --- Jugador A termina un match (simulado a paso fijo: el render de software va a pocos FPS)
const a = await player('A');
await a.evaluate(() => {
  window.app.settings.driverName = 'Piloto A';
  window.app.save();
});
await a.waitForFunction(() => window.app.session?.match);
await a.evaluate(() => {
  const app = window.app;
  if (!app.session.match.running) {
    app.countdown = -1;
    app.overlay.classList.remove('passthrough');
    app.closeOverlay();
    app.session.beginMatch();
  }
});
for (let k = 0; k < 120; k++) {
  const done = await a.evaluate(() => {
    const s = window.app.session;
    for (let i = 0; i < 240 && s.match.phase !== 'DONE'; i++) s.step(1 / 120, []);
    return s.match.phase === 'DONE';
  });
  if (done) break;
}
await a.waitForFunction(() => JSON.parse(localStorage.getItem('rebuilt-sim.ranking.v1') || '{}').account, null, { timeout: 15000 }).catch(() => {});
await a.waitForFunction(() => !JSON.parse(localStorage.getItem('rebuilt-sim.ranking.v1') || '{}').queue?.length, null, { timeout: 15000 }).catch(() => {});
const row = sql(`select name || '|' || matches || '|' || rating || '|' || fuel from players`);
console.log('servidor:', row);
check(/^Piloto A\|1\|\d+\|\d+$/.test(row), 'cuenta creada y match aceptado por el servidor');
const toast = await a.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' · '));
check(/Ranking global/.test(toast), `aviso del rating global (${toast.slice(0, 120)})`);
check(sql('select count(*) from players where token_hash is not null') === '1', 'el servidor guarda solo el hash del token');

// --- El ranking muestra al jugador
await a.evaluate(() => {
  window.app.quitToMenu();
  window.app.openStats();
});
await a.click('[data-tab="global"]');
await a.waitForSelector('.stats tr.me', { timeout: 15000 }).catch(() => {});
check(!!(await a.$('.stats tr.me')), 'aparece en el ranking global (tú)');
const place = await a.evaluate(() => document.querySelector('.st-pub b')?.textContent ?? '');
check(/#1/.test(place), `lugar: ${place}`);
await a.click('.st-code summary');
const code = await a.evaluate(() => document.querySelector('.st-coderow code')?.textContent ?? '');
check(code.startsWith('RBSIM1-'), 'código de cuenta');
await a.screenshot({ path: 'shots/ranking-global.png' });
await a.goto('about:blank');

// --- Otro navegador usa el código: es la misma cuenta
const bp = await player('B');
await bp.evaluate(() => {
  window.app.settings.driverName = 'Piloto A (tablet)';
  window.app.save();
  window.app.quitToMenu();
  window.app.openStats();
});
await bp.click('[data-tab="global"]');
await bp.waitForSelector('.st-code', { timeout: 15000 });
await bp.click('.st-code summary');
await bp.fill('[data-codein]', code);
await bp.click('[data-usecode]');
await bp.waitForSelector('.stats tr.me', { timeout: 15000 }).catch(() => {});
check(!!(await bp.$('.stats tr.me')), 'el código abre la cuenta en otro navegador');
check(sql('select name from players') === 'Piloto A (tablet)', 'y la renombra');
// salir del ranking (dos toques) borra la cuenta del servidor
await bp.click('[data-publish]');
await bp.click('[data-publish]');
await bp.waitForFunction(() => !JSON.parse(localStorage.getItem('rebuilt-sim.ranking.v1') || '{}').account, null, { timeout: 15000 }).catch(() => {});
check(sql('select count(*) from players') === '0' && sql('select count(*) from matches') === '0', 'salir del ranking borra la cuenta y sus matches');
await bp.screenshot({ path: 'shots/ranking-left.png' });

check(!logs.filter((l) => !/Failed to load resource/.test(l)).length, `sin errores ${JSON.stringify(logs.slice(0, 4))}`);
await browser.close();
server.close();
console.log(failed ? 'ranking: FAIL' : 'ranking: OK');
process.exit(failed ? 1 : 0);
