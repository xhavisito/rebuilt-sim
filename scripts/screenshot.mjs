// Verificación visual con Playwright: levanta `vite preview` (o `vite` con --dev),
// abre la app en escritorio (1920×1080) y celular horizontal (844×390, táctil),
// guarda capturas en shots/, imprime errores de consola y FPS medidos.
//
// Uso: node scripts/screenshot.mjs [--dev] [--query "a=1&b=2"] [--wait 6000]
//        [--keys "KeyW:1500,KeyD:500"] [--throttle 4] [--only desktop|mobile] [--name prefijo]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const dev = args.includes('--dev');
const query = opt('query', '');
const wait = Number(opt('wait', '6000'));
const keys = opt('keys', '');
const throttle = Number(opt('throttle', '0'));
const only = opt('only', '');
const name = opt('name', 'shot');
const evalJs = opt('eval', '');
const port = dev ? 5199 : 4199;

mkdirSync('shots', { recursive: true });
const server = spawn('npx', dev ? ['vite', '--port', String(port), '--strictPort'] : ['vite', 'preview', '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(to);
      resolve();
    }
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const url = `http://localhost:${port}/?${query}`;
const profiles = [
  { id: 'desktop', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { id: 'mobile', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
].filter((p) => !only || p.id === only);

let failed = false;
for (const p of profiles) {
  const ctx = await browser.newContext({
    viewport: p.viewport,
    deviceScaleFactor: p.deviceScaleFactor,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    userAgent: p.isMobile
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
      : undefined,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 30000 }).catch(() => {});
  if (evalJs) await page.evaluate(evalJs).catch((e) => logs.push(`[eval] ${e.message}`));
  if (p.isMobile) await page.touchscreen.tap(10, 10).catch(() => {});
  for (const k of keys.split(',').filter(Boolean)) {
    const [code, ms] = k.split(':');
    await page.keyboard.down(code);
    await page.waitForTimeout(Number(ms || 300));
    await page.keyboard.up(code);
  }
  await page.waitForTimeout(wait);
  const fps = await page.evaluate(() => window.__fps ?? 0);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const file = `shots/${name}-${p.id}.png`;
  await page.screenshot({ path: file });
  console.log(`\n== ${p.id}: ${file}  fps≈${Number(fps).toFixed(1)}  gpu=${renderer}`);
  for (const l of logs) console.log('  ' + l);
  if (logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))) failed = true;
  await ctx.close();
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
