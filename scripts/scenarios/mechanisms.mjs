import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4196);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
await page.goto('http://localhost:4196/?mode=practice&cam=chase');
await page.waitForFunction(() => !document.getElementById('loading'));
const st = () => page.evaluate(() => { const s = window.app.session, r = s.robots[0]; return { pos: [r.phys.curPos.x.toFixed(2), r.phys.curPos.z.toFixed(2)], hopper: s.fuel.robotCount(0), shot: r.stats.fuelShot, scored: r.stats.fuelScored, chute: s.fuel.chute.blue.length, corral: s.fuel.corral.blue.length, door: s.humanPlayers.blue.doorOpen }; });
// 1) intake en la NEUTRAL ZONE
await page.evaluate(() => { const r = window.app.session.robots[0]; r.phys.teleport(-1.6, 0.6, 0); r.intakeOn = true; });
await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
await page.waitForTimeout(600);
console.log('intake', JSON.stringify(await st()));
// 2) disparo con auto-aim desde la ALLIANCE ZONE (mirando de lado: el auto-aim gira el robot)
await page.evaluate(() => { const r = window.app.session.robots[0]; r.intakeOn = false; r.phys.teleport(-6.0, -1.0, 1.2); });
await page.waitForTimeout(300);
await page.keyboard.down('Space'); await page.waitForTimeout(3500); await page.keyboard.up('Space');
await page.waitForTimeout(2000);
console.log('shoot', JSON.stringify(await st()));
await page.screenshot({ path: 'shots/mech-shoot.png' });
// 3) disparo en movimiento: strafe lateral con D mientras dispara
await page.evaluate(() => { const s = window.app.session; const r = s.robots[0]; r.phys.teleport(-6.2, -2.5, 0); for (let k = 0; k < 10; k++) { const i = s.fuel.state.findIndex((x) => x === 0); s.fuel.toRobot(i, 0); } });
const before = (await st()).scored;
await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForTimeout(1600); await page.keyboard.up('KeyD'); await page.keyboard.up('Space');
await page.waitForTimeout(2200);
const mv = await st(); console.log('shoot-on-move', JSON.stringify(mv), 'scored while moving:', mv.scored - before);
// 4) CHUTE: el HP (IA) abre cuando el robot espera frente a la salida
await page.evaluate(() => { const s = window.app.session; const r = s.robots[0]; const o = { x: -8.27 + 0.9, z: 3.37 }; r.phys.teleport(o.x, o.z, Math.PI); r.intakeOn = true; });
await page.waitForTimeout(2500);
console.log('chute', JSON.stringify(await st()));
// 5) CORRAL: pase de frente al OUTPOST
await page.evaluate(() => { const s = window.app.session; const r = s.robots[0]; r.intakeOn = false; r.phys.teleport(-8.27 + 0.75, 3.37, Math.PI); });
await page.keyboard.down('KeyG'); await page.waitForTimeout(1500); await page.keyboard.up('KeyG');
await page.waitForTimeout(1500);
console.log('corral', JSON.stringify(await st()));
console.log('LOGS', logs);
await browser.close(); server.close();
