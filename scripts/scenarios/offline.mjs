// PWA: tras la primera visita (service worker instalado) la app carga sin conexión.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4182);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(server.url + '/');
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 30000 });
await page.waitForFunction(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!r?.active;
}, null, { timeout: 30000 });
const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return (await c.keys()).length; });
console.log('SW activo · archivos en caché:', cached);
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => !document.getElementById('loading') && !!document.querySelector('.mm-hero'), null, { timeout: 30000 });
console.log('offline OK: menú cargado sin red =', await page.evaluate(() => !!document.querySelector('.mm-hero')));
await page.click('[data-go="spectate"]');
await page.waitForTimeout(5000);
console.log('offline match t =', await page.evaluate(() => window.app.session?.match?.t.toFixed(1)));
await browser.close();
server.close();
