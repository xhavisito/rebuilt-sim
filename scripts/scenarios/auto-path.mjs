// Autónomo programable (tipo PathPlanner): el diseñador dibuja la ruta suave, la reproduce,
// importa JSON y el robot del jugador la sigue en AUTO (pasa por los waypoints, sin cruzar la
// CENTER LINE). Con la ruta dibujada en el campo 3D.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4211);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
await page.goto('http://localhost:4211/');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate(() => window.app.openAutoDesigner());
await page.waitForSelector('.designer canvas');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/auto-designer-new.png' });
console.log('new routine', await page.evaluate(() => document.querySelector('[data-info]').textContent));
// Ruta propia: sale, recoge en la NEUTRAL ZONE pasando por el BUMP de abajo y regresa a tirar
const routine = {
  name: 'e2e curva',
  spline: true,
  speed: 0.85,
  shootPreload: true,
  waypoints: [
    { x: -2.3, z: 1.5, heading: null, intake: true },
    { x: -1.2, z: 2.6, heading: null },
    { x: -1.5, z: 0.9, heading: Math.PI },
    { x: -2.5, z: 1.5, heading: Math.PI },
    { x: -5.5, z: 1.6, heading: 0, shoot: true },
  ],
};
const ok = await page.evaluate((r) => window.app.designer.importJson(JSON.stringify(r)), routine);
console.log('import ok', ok, await page.evaluate(() => document.querySelector('[data-info]').textContent));
const bad = await page.evaluate(() => window.app.designer.importJson('{"nope":1}'));
console.log('import bad rejected', !bad);
// Selecciona y arrastra el waypoint 2 con el mouse (y deshace con Ctrl+Z)
const box = await page.locator('.designer canvas').boundingBox();
const X0 = -16.541 / 2 - 0.25, X1 = 1.2, Z0 = -8.069 / 2 - 0.15;
const px = (x, z) => ({ x: box.x + ((x - X0) / (X1 - X0)) * box.width, y: box.y + ((z - Z0) / (X1 - X0)) * box.width });
const p2 = px(-1.2, 2.6);
await page.mouse.move(p2.x, p2.y);
await page.mouse.down();
await page.mouse.move(p2.x - 30, p2.y - 30, { steps: 5 });
await page.mouse.up();
const moved = await page.evaluate(() => window.app.designer.cur.waypoints[1]);
await page.keyboard.press('Control+z');
const undone = await page.evaluate(() => window.app.designer.cur.waypoints[1]);
console.log('drag', moved.x.toFixed(2), moved.z.toFixed(2), '→ undo', undone.x.toFixed(2), undone.z.toFixed(2));
// Vista previa a la mitad
await page.click('[data-play]');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/auto-designer.png' });
console.log('preview clock', await page.evaluate(() => document.querySelector('[data-clock]').textContent));
// Móvil (horizontal)
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/auto-designer-mobile.png', fullPage: true });
await page.setViewportSize({ width: 1600, height: 900 });
// Probar en un match: el robot del jugador sigue la ruta
await page.click('[data-seg="station"] [data-v="3"]');
await page.click('[data-test]');
await page.waitForFunction(() => window.app.session?.match);
// Sin cuenta regresiva, y la simulación se avanza a mano (paso fijo, sin esperar al render: sin
// GPU el navegador puede dibujar muy lento)
await page.evaluate(() => {
  window.app.countdown = -1;
  window.app.closeOverlay?.();
  window.app.session.beginMatch();
});
const track = [];
// Muestrea por tiempo de simulación (sin GPU el navegador puede ir más lento que el reloj real)
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => {
    const s = window.app.session;
    const t1 = s.match.t + 0.5;
    while (s.match.t < t1) s.step(s.pw.dt, []);
    const r = s.playerRobot(0);
    const ex = s.autos.get(r.index);
    return { t: s.match.t, x: r.phys.curPos.x, z: r.phys.curPos.z, a: r.alliance, stage: ex?.stage.kind, i: ex?.stage.i, n: s.fuel.robotCount(r.index), phase: s.match.phase };
  });
  track.push(s);
  if (i === 6) await page.screenshot({ path: 'shots/auto-path-match.png' });
  if (s.phase !== 'AUTO') break;
}
const sgn = track[0].a === 'blue' ? 1 : -1;
const near = routine.waypoints.map((w) => Math.min(...track.map((q) => Math.hypot(q.x - sgn * w.x, q.z - sgn * w.z))).toFixed(2));
console.log('alliance', track[0].a, 'min dist to each waypoint', near.join(' '));
console.log('stages', [...new Set(track.map((q) => `${q.stage}${q.i ?? ''}`))].join(' → '));
console.log('max x past center (blue frame)', Math.max(...track.map((q) => sgn * q.x)).toFixed(2));
console.log('LOGS', logs);
await browser.close();
server.close();
