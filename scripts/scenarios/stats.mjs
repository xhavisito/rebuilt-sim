// Estadísticas: un match termina → se guardan el registro del jugador, el rating y los robots;
// la pantalla de estadísticas muestra perfil, robots, historial y ranking global (escritorio y móvil).
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4199);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
let fail = 0;
const check = (ok, msg) => {
  console.log(ok ? 'OK ' : 'FAIL', msg);
  if (!ok) fail++;
};
await page.goto('http://localhost:4199/?mode=match&signal=local');
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
await page.evaluate(() => {
  window.app.settings.driverName = 'E2E Bot';
  window.app.save();
});
await page.waitForFunction(() => window.app.session?.match);
// sin esperar la cuenta regresiva (el render de software va a pocos FPS)
await page.evaluate(() => {
  const a = window.app;
  if (!a.session.match.running) {
    a.countdown = -1;
    a.overlay.classList.remove('passthrough');
    a.closeOverlay();
    a.session.beginMatch();
  }
});
// El render de software es lento: el match se simula a paso fijo desde la página (sin dibujar)
for (let k = 0; k < 120; k++) {
  const done = await page.evaluate(() => {
    const s = window.app.session;
    for (let i = 0; i < 240 && s.match.phase !== 'DONE'; i++) s.step(1 / 120, []);
    return s.match.phase === 'DONE';
  });
  if (done) break;
}
await page.waitForTimeout(2500);
const st = await page.evaluate(() => JSON.parse(localStorage.getItem('rebuilt-sim.stats.v1') || 'null'));
check(st && st.me.matches === 1, `registro del jugador (${st?.me.matches} matches, rating ${st?.rating})`);
check(st && st.history[0]?.delta !== 0, `rating cambió (${st?.history[0]?.delta})`);
check(st && Object.keys(st.robots).length >= 3, `robots registrados: ${st && Object.keys(st.robots).length}`);
const cyc = await page.evaluate(() => window.app.session.robots.map((r) => r.stats.cycles));
console.log('ciclos por robot', cyc.join(','), '· FUEL', st?.me.fuel, 'tiros', st?.me.shots);
// abrir otra vez la pantalla de resultados no debe registrar dos veces
await page.evaluate(() => window.app.showResults());
const n2 = await page.evaluate(() => JSON.parse(localStorage.getItem('rebuilt-sim.stats.v1')).me.matches);
check(n2 === 1, 'sin doble registro');
await page.evaluate(() => {
  window.app.quitToMenu();
  window.app.openStats();
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/stats-me.png' });
for (const tab of ['robots', 'history', 'global']) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(tab === 'global' ? 5000 : 300);
  await page.screenshot({ path: `shots/stats-${tab}.png` });
}
console.log('global:', await page.evaluate(() => document.querySelector('.stats .msg.bad, .stats .msg.warn, .stats tr.me')?.textContent?.trim().slice(0, 80)));
// móvil
await page.setViewportSize({ width: 844, height: 390 });
await page.click('[data-tab="me"]');
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, 'sin scroll horizontal en móvil');
await page.screenshot({ path: 'shots/stats-mobile.png', fullPage: true });
check(!logs.length, `sin errores de consola ${logs.length ? JSON.stringify(logs.slice(0, 5)) : ''}`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
