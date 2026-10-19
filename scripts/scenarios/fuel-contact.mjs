// Robots contra FUEL: ningún robot debe treparse al FUEL ni hundirlo bajo el piso.
// Casos duros: montón de la NEUTRAL ZONE, FUEL suelto y apilado, FUEL atrapado contra la
// pared, reversa, strafe en diagonal y giros, con los 5 presets.
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
        let maxY = 0, maxTilt = 0, minFuel = 1, at = null;
        const t0 = performance.now();
        const p0 = { ...r.phys.curPos };
        const tick = () => {
          const ax = Math.abs(r.phys.curPos.x);
          // Fuera de BUMPS (con el largo del robot: los BUMPS sí lo levantan e inclinan, legalmente)
          if (ax < 2.55 || ax > 4.75) {
            maxY = Math.max(maxY, r.phys.curPos.y);
            if (r.phys.tilt() > maxTilt) { maxTilt = r.phys.tilt(); at = [r.phys.curPos.x.toFixed(2), r.phys.curPos.z.toFixed(2)]; }
          }
          for (let i = 0; i < s.fuel.count; i++) if (s.fuel.state[i] === 0) minFuel = Math.min(minFuel, s.fuel.pos[i * 3 + 1]);
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else
            res({
              maxY: +maxY.toFixed(3),
              tiltDeg: +((maxTilt * 180) / Math.PI).toFixed(1),
              minFuel: +(minFuel - R).toFixed(3),
              at,
              travel: +Math.hypot(r.phys.curPos.x - p0.x, r.phys.curPos.z - p0.z).toFixed(2),
            });
        };
        tick();
      }),
    ms,
  );

const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  const r = await sample(ms);
  for (const k of keys) await page.keyboard.up(k);
  return r;
};

const phases = [];
const merge = (a, b) => (phases.push(b), { maxY: Math.max(a.maxY, b.maxY), tiltDeg: Math.max(a.tiltDeg, b.tiltDeg), minFuel: Math.min(a.minFuel, b.minFuel) });
const results = {};
let frontTravel = 0;
for (const id of (process.env.PRESETS ?? 'balanced,tank,climber,defender').split(',')) {
  const ok = await page.evaluate((id) => {
    const a = window.app;
    if (!a.settings.match) return false;
    a.settings.match.robotId = id;
    a.settings.camera = 'driver'; // manejo field-relative fijo: W = hacia el campo contrario
    a.startPractice();
    return window.app.session.robots[0].spec.id === id;
  }, id);
  if (!ok) { results[id] = 'preset no encontrado'; continue; }
  await page.waitForTimeout(400);
  // 1) De frente contra el montón (+X), sin intake
  await page.evaluate(() => { const s = window.app.session; s.robots[0].intakeOn = false; s.robots[0].phys.teleport(-2.6, 0.8, 0); });
  await page.waitForTimeout(200);
  const front = await hold(['KeyW'], 1500);
  if (id === 'balanced') frontTravel = front.travel;
  let acc = merge(front, await hold(['KeyQ'], 900));
  acc = merge(acc, await hold(['KeyS'], 900)); // reversa
  acc = merge(acc, await hold(['KeyW', 'KeyD', 'KeyE'], 1000)); // diagonal girando
  // 2) FUEL suelto y en pirámides (como sale del HUB) en la NEUTRAL ZONE despejada
  await page.evaluate(() => {
    const s = window.app.session;
    const f = s.fuel;
    for (let i = 0; i < f.count; i++) if (f.state[i] === 0) f.store(i, 6, -1);
    let k = 0;
    const free = () => { while (k < f.count && f.state[k] === 0) k++; return k < f.count ? k++ : -1; };
    for (let n = 0; n < 90; n++) { const i = free(); if (i < 0) break; f.place(i, -2.4 + Math.random() * 4.8, 0.0751, -3.2 + Math.random() * 6.4, false); }
    // pirámides de 4 + 1 encima
    for (const [cx, cz] of [[-1, -1], [0.5, 0.8], [1.2, -2]]) {
      for (const [dx, dz] of [[0, 0], [0.152, 0], [0, 0.152], [0.152, 0.152]]) { const i = free(); if (i >= 0) f.place(i, cx + dx, 0.0751, cz + dz, false); }
      const i = free(); if (i >= 0) f.place(i, cx + 0.076, 0.18, cz + 0.076, false);
    }
    s.robots[0].phys.teleport(-2.2, -2.5, 0);
  });
  await page.waitForTimeout(300);
  acc = merge(acc, await hold(['KeyW', 'KeyD'], 1300));
  acc = merge(acc, await hold(['KeyS', 'KeyQ'], 1100));
  acc = merge(acc, await hold(['KeyW', 'KeyA', 'KeyE'], 1300));
  acc = merge(acc, await hold(['KeyS', 'KeyD'], 1100));
  // 3) FUEL atrapado entre el BUMPER y la guardrail (lado −Z, lejos de estructuras)
  await page.evaluate(() => {
    const s = window.app.session;
    const f = s.fuel;
    for (let n = 0, i = 0; n < 6 && i < f.count; i++) if (f.state[i] !== 0) { f.place(i, -1.4 + n * 0.17, 0.0751, -3.95, false); n++; }
    s.robots[0].phys.teleport(-1.0, -3.2, Math.PI / 2);
  });
  await page.waitForTimeout(200);
  // field-relative: A = −Z (hacia la guardrail). Lento (Shift): chocar contra la pared a toda
  // velocidad inclina al robot unos 6° aunque no haya FUEL, y eso no es lo que medimos aquí.
  acc = merge(acc, await hold(['ShiftLeft', 'KeyA'], 2000));
  acc = merge(acc, await hold(['ShiftLeft', 'KeyA', 'KeyQ'], 1200));
  results[id] = acc;
  if (process.env.DEBUG) console.log(id, JSON.stringify(phases.splice(0)));
}
console.log(JSON.stringify(results));
// Criterios: el robot no se levanta más de 2 cm ni se inclina más de 4° sobre FUEL, ningún
// FUEL queda bajo la alfombra y el montón frena al robot (no lo cruza a toda velocidad).
const bad = Object.entries(results).filter(([, r]) => typeof r === 'string' || r.maxY > 0.02 || r.tiltDeg > 4 || r.minFuel < -0.01);
if (frontTravel > 4.6) bad.push(['front', `el montón no frena al robot (${frontTravel} m)`]);
console.log(bad.length ? `FAIL ${JSON.stringify(bad)}` : 'OK');
if (bad.length || logs.length) process.exitCode = 1;
console.log('LOGS', logs);
await browser.close();
server.close();
