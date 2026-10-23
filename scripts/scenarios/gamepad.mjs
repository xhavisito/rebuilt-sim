// Control simulado (Gamepad API falsa): pantalla de Control navegable con el control,
// reasignar un botón, manejar con los sticks y la vibración al tirar y al recoger FUEL.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4211);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name} ${extra}`);
  if (!ok) fail++;
};
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
// Un control "Xbox" con vibración y gatillos; window.__pad lo mueve, window.__fx registra efectos
await page.addInitScript(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const fx = [];
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons,
    vibrationActuator: { effects: ['dual-rumble', 'trigger-rumble'], playEffect: (type, p) => (fx.push({ type, ...p }), Promise.resolve('complete')), reset: () => Promise.resolve('complete') },
  };
  window.__fx = fx;
  window.__pad = {
    press: (i, v = 1) => Object.assign(buttons[i], { pressed: v > 0.1, value: v }),
    release: (i) => Object.assign(buttons[i], { pressed: false, value: 0 }),
    axes: (a) => (pad.axes = a),
  };
  navigator.getGamepads = () => [pad, null, null, null];
});
const tap = async (i, ms = 120) => {
  await page.evaluate((i) => window.__pad.press(i), i);
  await page.waitForTimeout(ms);
  await page.evaluate((i) => window.__pad.release(i), i);
  await page.waitForTimeout(ms);
};

// 1) Pantalla de Control: se ve el control conectado y se navega con el D-pad
await page.goto(`${server.url}/`);
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate(() => window.app.screens.controller());
await page.waitForTimeout(400);
check('lista el control', (await page.textContent('[data-pads]')).includes('Xbox'));
const focusedKey = () => page.evaluate(() => document.querySelector('.focused')?.getAttribute('data-key'));
const k0 = await focusedKey();
await tap(13); // ↓
const k1 = await focusedKey();
check('D-pad mueve el foco', k0 !== k1, `${k0} → ${k1}`);
// ←→ sobre la intensidad cambia el valor
const vs0 = await page.evaluate(() => window.app.settings.pad.vibrationStrength);
await tap(14); // ←
const vs1 = await page.evaluate(() => window.app.settings.pad.vibrationStrength);
check('← baja la intensidad', vs1 < vs0, `${vs0} → ${vs1}`);
check('probadita al ajustar', (await page.evaluate(() => window.__fx.length)) > 0);
await page.screenshot({ path: 'shots/gamepad-screen.png', fullPage: true });

// 2) Reasignar "Disparar" a A: intercambia con "Subir (climb)"
await page.click('[data-rebindpad="shoot"]');
await page.waitForTimeout(100);
await tap(0); // A
await page.waitForTimeout(200);
const b = await page.evaluate(() => ({ shoot: window.app.settings.padBindings.shoot, climbUp: window.app.settings.padBindings.climbUp }));
check('reasignar intercambia', b.shoot[0] === 0 && b.climbUp[0] === 7, JSON.stringify(b));
await page.waitForTimeout(300);
check('sigue en la pantalla de Control', (await focusedKey()) === 'bind-shoot', await focusedKey());
// esquema predeterminado otra vez
await page.evaluate(() => {
  window.app.settings.padBindings = structuredClone({ ...window.app.settings.padBindings, shoot: [7], climbUp: [0] });
  window.app.save();
});

// 3) Práctica: stick izquierdo maneja, RT tira y vibra (con gatillo), la intake vibra
await page.goto(`${server.url}/?mode=practice`);
await page.waitForFunction(() => !document.getElementById('loading') && window.app.session);
await page.waitForTimeout(500);
// Espera tiempo de SIMULACIÓN (sin GPU el render va muy lento y la simulación también)
const simWait = async (sec) => {
  const t0 = await page.evaluate(() => window.app.session.simTime);
  await page.waitForFunction((t) => window.app.session.simTime >= t, t0 + sec, { timeout: 150000, polling: 100 });
};
const pos = () => page.evaluate(() => { const p = window.app.session.robots[0].phys.curPos; return [p.x, p.z]; });
const p0 = await pos();
await page.evaluate(() => window.__pad.axes([0, -1, 0, 0]));
await simWait(0.8);
await page.evaluate(() => window.__pad.axes([0, 0, 0, 0]));
const p1 = await pos();
check('el stick mueve el robot', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.5, JSON.stringify({ p0, p1 }));
// intake en la NEUTRAL ZONE
await page.evaluate(() => { window.__fx.length = 0; const r = window.app.session.robots[0]; r.phys.teleport(-1.6, 0.6, 0); r.intakeOn = true; });
await page.evaluate(() => window.__pad.axes([0, -1, 0, 0]));
await simWait(0.9);
await page.evaluate(() => window.__pad.axes([0, 0, 0, 0]));
await simWait(0.4);
const fxIntake = await page.evaluate(() => window.__fx.filter((f) => f.leftTrigger > 0).length);
const hopper = await page.evaluate(() => window.app.session.fuel.robotCount(0));
check('vibra al recoger FUEL', hopper > 0 && fxIntake > 0, `hopper=${hopper} efectos=${fxIntake}`);
// tiro desde la ALLIANCE ZONE con RT
await page.evaluate(() => { window.__fx.length = 0; const s = window.app.session; const r = s.robots[0]; r.intakeOn = false; r.phys.teleport(-6.0, -1.0, 0); for (let k = 0; k < 8; k++) { const i = s.fuel.state.findIndex((x) => x === 0); s.fuel.toRobot(i, 0); } });
await simWait(0.3);
await page.evaluate(() => window.__pad.press(7, 1));
await simWait(2.5);
await page.evaluate(() => window.__pad.release(7));
const shotFx = await page.evaluate(() => ({ n: window.__fx.length, trig: window.__fx.filter((f) => f.type === 'trigger-rumble' && f.rightTrigger > 0).length, shot: window.app.session.robots[0].stats.fuelShot }));
check('vibra al tirar (gatillo derecho)', shotFx.shot > 0 && shotFx.trig > 0 && shotFx.trig <= shotFx.shot, JSON.stringify(shotFx));
// apagar los tiros en Ajustes: ya no vibra
await page.evaluate(() => { window.__fx.length = 0; window.app.settings.pad.haptics.shots = false; const s = window.app.session; for (let k = 0; k < 6; k++) { const i = s.fuel.state.findIndex((x) => x === 0); s.fuel.toRobot(i, 0); } });
await page.evaluate(() => window.__pad.press(7, 1));
await simWait(1.5);
await page.evaluate(() => window.__pad.release(7));
check('grupo "Tiros" apagado no vibra', (await page.evaluate(() => window.__fx.filter((f) => f.rightTrigger > 0).length)) === 0);
console.log('LOGS', logs);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
