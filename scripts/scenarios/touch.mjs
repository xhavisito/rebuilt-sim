import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4198);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4198/?mode=practice');
await page.waitForFunction(() => !document.getElementById('loading'));
await page.waitForTimeout(800);
const pos = () => page.evaluate(() => { const p = window.app.session.robots[0].phys.curPos; return [p.x.toFixed(2), p.z.toFixed(2)]; });
console.log('start', await pos());
const cdp = await ctx.newCDPSession(page);
const tp = (x, y, id = 1) => [{ x, y, id }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(200, 260) });
for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(200, 260 - i * 7) }); await page.waitForTimeout(16); }
await page.waitForTimeout(900);
console.log('after drag up (left stick)', await pos(), 'state', await page.evaluate(() => JSON.stringify(window.app.touch.state)));
// second finger on the right: rotate while holding left
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 190, id: 1 }, { x: 600, y: 200, id: 2 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 190, id: 1 }, { x: 650, y: 200, id: 2 }] });
await page.waitForTimeout(400);
console.log('multitouch state', await page.evaluate(() => JSON.stringify(window.app.touch.state)), 'heading', await page.evaluate(() => window.app.session.robots[0].phys.heading().toFixed(2)));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
console.log('released', await page.evaluate(() => JSON.stringify(window.app.touch.state)));
await browser.close(); server.close();
