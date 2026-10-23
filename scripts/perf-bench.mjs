// Banco de rendimiento: levanta `vite preview`, arranca un match en espectador (los 6 robots
// en IA, con FUEL volando) en cada calidad y perfil, y mide FPS, ms de simulación y de
// render, draw calls y triángulos. Sirve para comparar antes/después de un cambio.
//
// Uso: npm run perf -- [--qualities low,medium,high] [--only desktop|mobile]
//        [--throttle 4] [--seconds 8] [--query "dynres=0"]
// Requiere `npm run build`. Con CHROMIUM_PATH se usa ese Chromium. Ojo: en la nube el GPU es
// SwiftShader (software), así que los números absolutos son peores que en un equipo real;
// lo que importa es la comparación entre calidades y entre versiones.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const qualities = opt('qualities', 'low,medium,high').split(',');
const only = opt('only', '');
const throttle = Number(opt('throttle', '0'));
const seconds = Number(opt('seconds', '8'));
const extra = opt('query', '');
const port = 4198;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const profiles = [
  { id: 'desktop', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { id: 'mobile', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
].filter((p) => !only || p.id === only);

const rows = [];
for (const p of profiles) {
  for (const q of qualities) {
    const ctx = await browser.newContext({
      viewport: p.viewport,
      deviceScaleFactor: p.deviceScaleFactor,
      isMobile: p.isMobile,
      hasTouch: p.hasTouch,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (throttle > 1) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?mode=match&spectate=1&speed=1&quality=${q}&dynres=0&fpscap=0&${extra}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 }).catch(() => {});
    const loadMs = Date.now() - t0;
    // deja pasar la cuenta regresiva y el arranque de AUTO
    await page.waitForTimeout(4000);
    const r = await page.evaluate(async (secs) => {
      const w = window;
      const info = w.app.renderer.info.render;
      let frames = 0;
      let sim = 0;
      let render = 0;
      let worst = 0;
      let last = performance.now();
      const end = last + secs * 1000;
      await new Promise((done) => {
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          frames++;
          sim += w.__perf?.sim ?? 0;
          render += w.__perf?.render ?? 0;
          if (now < end) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return {
        fps: frames / secs,
        sim: sim / frames,
        render: render / frames,
        worst,
        draws: info.calls,
        tris: info.triangles,
        quality: w.app.renderer.quality,
        scale: w.app.renderer.dynScale ?? 1,
      };
    }, seconds);
    rows.push({ profile: p.id, quality: q, loadMs, ...r, errors: errors.length });
    await ctx.close();
  }
}
await browser.close();
server.kill();

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nthrottle ×${throttle || 1}, ${seconds} s por corrida\n`);
console.log(pad('perfil', 9) + pad('calidad', 9) + pad('FPS', 7) + pad('peor ms', 9) + pad('sim ms', 8) + pad('render ms', 11) + pad('draws', 7) + pad('k tris', 8) + pad('escala', 8) + pad('carga s', 9) + 'errores');
for (const r of rows)
  console.log(
    pad(r.profile, 9) +
      pad(r.quality, 9) +
      pad(r.fps.toFixed(1), 7) +
      pad(r.worst.toFixed(0), 9) +
      pad(r.sim.toFixed(1), 8) +
      pad(r.render.toFixed(1), 11) +
      pad(r.draws, 7) +
      pad((r.tris / 1000).toFixed(0), 8) +
      pad(r.scale.toFixed(2), 8) +
      pad((r.loadMs / 1000).toFixed(1), 9) +
      r.errors,
  );
process.exit(rows.some((r) => r.errors) ? 1 : 0);
