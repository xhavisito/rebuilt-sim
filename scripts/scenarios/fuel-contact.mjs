// Robots contra FUEL: el robot no debe treparse al FUEL ni hundirlo bajo el piso.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4197);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto('http://localhost:4197/?mode=practice');
await page.waitForFunction(() => !document.getElementById('loading'));

/** Muestrea durante `ms` la altura/inclinación máxima del robot y el FUEL más hundido. */
const sample = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((res) => {
        const s = window.app.session;
        const r = s.robots[0];
        const R = 0.0751;
        let maxY = 0, maxTilt = 0, minFuel = 1, sunk = 0, pushed = 0;
        const t0 = performance.now();
        const p0 = { ...r.phys.curPos };
        const tick = () => {
          // Solo dentro de la NEUTRAL ZONE (los BUMPS sí inclinan al robot, legalmente)
          if (Math.abs(r.phys.curPos.x) < 2.7) {
            maxY = Math.max(maxY, r.phys.curPos.y);
            maxTilt = Math.max(maxTilt, r.phys.tilt());
          }
          for (let i = 0; i < s.fuel.count; i++) {
            if (s.fuel.state[i] !== 0) continue;
            const y = s.fuel.pos[i * 3 + 1];
            if (y < minFuel) minFuel = y;
            if (y < R - 0.015) sunk++;
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else {
            pushed = Math.hypot(r.phys.curPos.x - p0.x, r.phys.curPos.z - p0.z);
            res({ maxY: +maxY.toFixed(3), tiltDeg: +((maxTilt * 180) / Math.PI).toFixed(1), minFuel: +minFuel.toFixed(3), sunkFrames: sunk, travel: +pushed.toFixed(2), out: s.fuel.countState(6) });
          }
        };
        tick();
      }),
    ms,
  );

const results = {};
// 1) De frente contra el montón de la NEUTRAL ZONE (+X), sin intake
await page.evaluate(() => {
  const s = window.app.session;
  s.resetField();
  const r = s.robots[0];
  r.intakeOn = false;
  r.phys.teleport(-2.6, 0.8, 0);
});
await page.waitForTimeout(300);
await page.keyboard.down('KeyW');
results.front = await sample(1800);
await page.keyboard.up('KeyW');
// 2) Entra 0.7 s al montón y gira en su lugar
await page.evaluate(() => {
  const s = window.app.session;
  s.resetField();
  s.robots[0].phys.teleport(-2.6, -0.8, 0);
});
await page.waitForTimeout(300);
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyQ');
results.spin = await sample(1500);
await page.keyboard.up('KeyQ');
// 3) Strafe lateral (+Z) a través del montón
await page.evaluate(() => {
  const s = window.app.session;
  s.resetField();
  s.robots[0].phys.teleport(0.2, -3.3, 0);
});
await page.waitForTimeout(300);
await page.keyboard.down('KeyD');
results.strafe = await sample(2000);
await page.keyboard.up('KeyD');
console.log(JSON.stringify(results, null, 1));
// Criterios: el robot no se levanta más de 2 cm ni se inclina más de 5° sobre FUEL,
// ningún FUEL queda bajo la alfombra y el montón frena al robot (no lo cruza a toda velocidad).
const bad = Object.entries(results).filter(([, r]) => r.maxY > 0.02 || r.tiltDeg > 5 || r.minFuel < 0.06);
if (results.front.travel > 5) bad.push(['front', 'el montón no frena al robot']);
console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'OK');
if (bad.length || logs.length) process.exitCode = 1;
await page.screenshot({ path: 'shots/fuel-contact.png' });
console.log('LOGS', logs);
await browser.close();
server.close();
