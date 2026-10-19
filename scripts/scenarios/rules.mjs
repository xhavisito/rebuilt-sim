import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('4191') && r()));
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('ERR', m.text()));
await page.goto('http://localhost:4191/?mode=match&cam=broadcast');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.waitForTimeout(3600);
const E = (f) => page.evaluate(f);
// Robots: 0..2 rojos, 3..5 azules. Jugador = azul DS2 (índice 4).
// AUTO: el robot azul 3 (DS1) trepa L1 en su TOWER (climber manual vía cmd)
await E(() => { const s = window.app.session; const r = s.robots[3]; const tw = { x: -8.27 + 1.07 + r.phys.outerL + 0.05, z: 0.29 }; r.phys.teleport(tw.x, tw.z, Math.PI); window.__climb3 = true; const orig = s.step; });
// forzamos climbUp en el robot 3 interceptando su comando cada frame
await E(() => { const s = window.app.session; const r = s.robots[3]; setInterval(() => { if (window.__climb3) { r.cmd.climbUp = true; } }, 5); const f = s.runClimb.bind(s); s.runClimb = (rb, dt) => { if (rb === r && window.__climb3) rb.cmd.climbUp = true; f(rb, dt); }; });
// G403: el jugador cruza completo la CENTER LINE en AUTO
await E(() => { const r = window.app.session.robots[4]; r.phys.teleport(1.2, -1.0, 0); });
await page.waitForTimeout(5200);
console.log('AUTO', await E(() => { const s = window.app.session; const r = s.robots[3]; return JSON.stringify({ t: s.match.t.toFixed(1), climbing: r.climbing, lvl: r.climb.level(), y: r.phys.curPos.y.toFixed(3), fouls: s.match.fouls.map((f) => f.rule + ':' + f.severity) }); }));
await E(() => { window.app.session.match.t = 19.0; });
await page.waitForTimeout(1500);
console.log('AUTO tower', await E(() => { const m = window.app.session.match; return JSON.stringify({ phase: m.phase, towerAuto: [m.tower.red.auto, m.tower.blue.auto] }); }));
// TELEOP: PIN — el jugador empuja al rojo 1 contra el barandal
await E(() => { const s = window.app.session; s.match.t = 40; window.__climb3 = false; s.robots[1].phys.teleport(0.5, -3.55, 0); s.robots[4].phys.teleport(0.5, -2.6, -Math.PI / 2); });
await page.waitForTimeout(300);
// cámara broadcast: W = alejarse de la cámara = hacia −Z (el barandal del fondo)
await page.keyboard.down('KeyW'); await page.waitForTimeout(7200); await page.keyboard.up('KeyW');
console.log('PIN', await E(() => { const s = window.app.session; return JSON.stringify({ fouls: s.match.fouls.map((f) => f.rule + ':' + f.severity), pins: s.referee.activePins().map((p) => p.seconds.toFixed(1)), z1: s.robots[1].phys.curPos.z.toFixed(2) }); }));
await page.screenshot({ path: 'shots/p4-pin.png' });
// END GAME: el rojo 0 trepa su TOWER; el jugador lo toca → G420 + L3
await E(() => { const s = window.app.session; s.match.t = 140; const r = s.robots[2]; r.phys.teleport(8.27 - 1.07 - r.phys.outerL - 0.05, -0.29, 0); const f = s.runClimb.bind(s); s.runClimb = (rb, dt) => { if (rb === r) rb.cmd.climbUp = true; f(rb, dt); }; });
await page.waitForTimeout(3500);
await E(() => { const s = window.app.session; const r0 = s.robots[2]; s.robots[4].phys.teleport(r0.phys.curPos.x - 1.25, r0.phys.curPos.z, 0); });
await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
console.log('G420', await E(() => { const s = window.app.session; return JSON.stringify({ l3: [...s.referee.g420Level3], fouls: s.match.fouls.filter((f) => f.rule === 'G420').length, red2: { climbing: s.robots[2].climbing, lvl: s.robots[2].climb.level(), y: s.robots[2].phys.curPos.y.toFixed(2) }, p: s.robots[4].phys.curPos.x.toFixed(2) }); }));
// final
await E(() => { window.app.session.match.t = 161; });
await page.waitForTimeout(9000);
console.log('END', await E(() => { const m = window.app.session.match; return JSON.stringify({ phase: m.phase, tower: m.tower, score: [m.score('red'), m.score('blue')], overlay: !document.querySelector('.overlay').classList.contains('hidden') && !!document.querySelector('.results') }); }));
await page.screenshot({ path: 'shots/p4-results.png', fullPage: false });
await browser.close(); server.kill();
