import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4193);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:4193/?mode=practice&cam=chase');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.evaluate(() => { const s = window.app.session; window.__hub = 0; s.fuel.cb = { ...s.fuel.cb, onHubEnter: (i, h) => { if (s.fuel.flags[i] & 4 || s.fuel.shotBy[i] === -1) window.__hub++; } };
  let n = 0; for (let i = 0; i < s.fuel.count && n < 10; i++) if (s.fuel.state[i] === 0) { s.fuel.store(i, 4, 1); s.fuel.corral.blue.push(i); n++; } });
await page.waitForTimeout(12000);
console.log('HP', await page.evaluate(() => JSON.stringify({ thrown: window.app.session.humanPlayers.blue.thrown, hubEntries: window.__hub, corral: window.app.session.fuel.corral.blue.length })));
await page.screenshot({ path: 'shots/hp-throw.png' });
// DEPOT: robot mirando al DEPOT azul con intake
await page.evaluate(() => { const s = window.app.session; const r = s.robots[0]; r.phys.teleport(-6.4, -1.9, Math.PI); r.intakeOn = true; });
const h0 = await page.evaluate(() => window.app.session.fuel.robotCount(0));
await page.keyboard.down('KeyS'); await page.waitForTimeout(100); await page.keyboard.up('KeyS');
// field-relative: "atrás" (S) = hacia la pared azul
await page.keyboard.down('KeyS'); await page.waitForTimeout(1400); await page.keyboard.up('KeyS');
await page.waitForTimeout(500);
console.log('DEPOT', await page.evaluate((h0) => { const s = window.app.session, r = s.robots[0]; return JSON.stringify({ gained: s.fuel.robotCount(0) - h0, pos: [r.phys.curPos.x.toFixed(2), r.phys.curPos.y.toFixed(3), r.phys.curPos.z.toFixed(2)] }); }, h0));
await browser.close(); server.close();
