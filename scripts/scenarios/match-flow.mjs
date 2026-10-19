import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4197', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('4197') && r()));
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
await page.goto('http://localhost:4197/?mode=match&cam=broadcast&fps=1');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.waitForTimeout(4200); // countdown
// AUTO: tirar 3 FUEL al HUB azul y 1 al rojo
await page.evaluate(() => {
  const s = window.app.session; const f = s.fuel;
  const shoot = (i, hubX, dir) => f.launch(i, { x: hubX - dir * 2.5, y: 0.6, z: 0 }, { x: dir * 2.6, y: 6.1, z: 0 }, null, 0);
  let n = 0;
  for (let i = 0; i < f.count && n < 4; i++) if (f.state[i] === 0 && Math.abs(f.pos[i*3]) < 1) { shoot(i, n < 3 ? -3.645 : 3.645, n < 3 ? 1 : -1); n++; }
});
await page.waitForTimeout(2500);
const auto = await page.evaluate(() => { const m = window.app.session.match; return { phase: m.phase, t: m.t.toFixed(1), blue: m.fuel.blue.auto, red: m.fuel.red.auto }; });
console.log('AUTO', JSON.stringify(auto));
await page.evaluate(() => { const s = window.app.session; s.match.t = 25; });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/match-transition.png' });
console.log('TRANSITION', await page.evaluate(() => { const m = window.app.session.match; return JSON.stringify({ phase: m.phase, first: m.firstInactive, red: m.light('red'), blue: m.light('blue') }); }));
await page.evaluate(() => { window.app.session.match.t = 40; });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/match-shift1.png' });
console.log('SHIFT1', await page.evaluate(() => { const m = window.app.session.match; return JSON.stringify({ phase: m.phase, red: m.light('red'), blue: m.light('blue'), score: [m.score('red'), m.score('blue')] }); }));
console.log('LOGS', logs);
await browser.close(); server.kill();
