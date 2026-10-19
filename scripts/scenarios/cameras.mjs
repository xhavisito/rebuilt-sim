// Recorre las cámaras en práctica (captura cada una) y comprueba el manejo relativo a la cámara.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4199);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto('http://localhost:4199/?mode=practice');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate(() => { const r = window.app.session.robots[0]; r.phys.teleport(-2.6, 1.2, 0.5); r.intakeOn = true; });
for (const mode of ['driver', 'third', 'onboard', 'chase', 'top', 'broadcast']) {
  await page.evaluate((m) => window.app.session.rigs[0].setMode(m), mode);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/cam-${mode}.png` });
}
// Tercera persona: W avanza hacia donde mira el robot, aunque no mire al campo contrario
await page.evaluate(() => {
  const s = window.app.session;
  s.rigs[0].setMode('third');
  for (let i = 0; i < s.fuel.count; i++) if (s.fuel.state[i] === 0) s.fuel.store(i, 6, -1);
  s.robots[0].phys.teleport(-5, 0, Math.PI / 2); // mirando a −Z
});
await page.waitForTimeout(400);
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.keyboard.up('KeyW');
const mv = await page.evaluate(() => ({ ...window.app.session.robots[0].phys.curPos }));
const relOk = Math.abs(mv.x + 5) < 0.3 && mv.z < -0.8;
console.log('third W from (-5,0) facing -Z →', mv.x.toFixed(2), mv.z.toFixed(2), relOk ? 'OK' : 'FAIL');
if (!relOk) process.exitCode = 1;
// Botón de cámara del HUD
const before = await page.evaluate(() => window.app.session.rigs[0].mode);
await page.click('.cam-btn');
const after = await page.evaluate(() => [window.app.session.rigs[0].mode, window.app.settings.camera]);
console.log('cam-btn', before, '→', after.join(' / saved '));
if (after[0] === before || after[1] !== after[0]) process.exitCode = 1;
if (logs.length) process.exitCode = 1;
console.log('LOGS', logs);
await browser.close();
server.close();
