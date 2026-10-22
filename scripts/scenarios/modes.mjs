// Flujo de modos: torneo (omitir matches de otros, jugar el propio → resultados → continuar) y
// multijugador local.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4184);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4184/');
await page.waitForFunction(() => !document.getElementById('loading'));
// --- torneo
await page.click('[data-go="tournament"]');
await page.click('[data-create]');
// Matches de otros equipos: se pueden ver u omitir; "omitir hasta mi match" los simula
if (await page.$('[data-watch]')) {
  console.log('other teams match: watch/skip buttons', await page.evaluate(() => document.querySelectorAll('[data-watch], [data-skip], [data-skipall]').length));
  await page.click('[data-skipall]');
}
await page.click('[data-play]');
await page.waitForTimeout(4000);
console.log('tournament session', await page.evaluate(() => JSON.stringify({ mode: window.app.session.cfg.mode, players: window.app.session.players().length, phase: window.app.session.match.phase })));
await page.evaluate(() => { window.app.session.match.t = 162.5; });
await page.waitForSelector('.results', { timeout: 15000 });
await page.screenshot({ path: 'shots/modes-results.png' });
await page.click('[data-a="continue"]');
await page.waitForTimeout(500);
console.log('after continue', await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('rebuilt-sim.tournament.v1')); const mine = t.quals.find((m) => m.result?.perf && Object.keys(m.result.perf).length === 6); return JSON.stringify({ played: t.quals.filter((m) => m.result).length, perf: mine ? Object.values(mine.result.perf)[0] : null, table: !!document.querySelector('.ranktable') }); }));
// --- multijugador local: teclado + táctil
await page.click('[data-back]');
await page.click('[data-go="local"]');
await page.keyboard.press('KeyK');
await page.click('[data-touchslot]');
const enabled = await page.evaluate(() => !document.querySelector('[data-start]').disabled);
console.log('local start enabled', enabled);
await page.click('[data-start]');
await page.waitForTimeout(4500);
console.log('local session', await page.evaluate(() => JSON.stringify({ mode: window.app.session.cfg.mode, players: window.app.session.players().map((r) => r.alliance + r.station), rigs: window.app.session.rigs.length, slots: window.app.input.slots })));
await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
console.log('p1 moved', await page.evaluate(() => window.app.session.playerRobot(0).phys.curPos.x.toFixed(2)));
await page.screenshot({ path: 'shots/modes-local.png' });
await browser.close(); server.close();
