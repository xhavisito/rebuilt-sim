// Modo en línea: dos pestañas del mismo navegador (señalización local por BroadcastChannel, la
// conexión sí es WebRTC). El host crea una sala pública, el cliente la encuentra en la lista y
// entra, el host arranca;
// el cliente ve el campo del host y su robot se mueve con sus controles.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4190);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=vulkan', '--enable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const host = await ctx.newPage();
const guest = await ctx.newPage();
let fail = 0;
// (con dos pestañas, waitForFunction no avanza en la que no está al frente: se sondea a mano)
const waitFor = async (page, fn, timeout) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 200))) if (await page.evaluate(fn)) return true;
  throw new Error(`timeout: ${fn}`);
};
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${info ? ` · ${info}` : ''}`);
  if (!ok) fail++;
};
for (const [n, p] of [['host', host], ['guest', guest]]) {
  p.on('pageerror', (e) => console.log(`PAGEERR ${n}`, e.message));
  p.on('console', (m) => m.type() === 'error' && console.log(`CONSOLE ${n}`, m.text()));
}
await host.goto('http://localhost:4190/?signal=local&quality=low');
await host.waitForFunction(() => !document.getElementById('loading'));
await host.click('[data-go="online"]');
await host.click('[data-create]');
await host.waitForSelector('[data-roomcode]');
const code = await host.textContent('[data-roomcode]');
check('sala creada', /^[A-Z2-9]{5}$/.test(code), code);
// sala pública: el cliente la encuentra en la lista y entra desde ahí
await host.click('[data-seg="vis"] [data-v="public"]');
await guest.goto('http://localhost:4190/?signal=local&quality=low');
await waitFor(guest, () => !document.getElementById('loading'), 30000);
await guest.click('[data-go="online"]');
await guest.waitForSelector(`[data-room="${code}"]`, { timeout: 10000 });
check('la sala pública aparece en la lista', true);
await guest.click(`[data-room="${code}"]`);
await guest.waitForSelector('.net-wait', { timeout: 20000 });
await waitFor(host, () => document.querySelectorAll('.net-p').length === 2, 10000);
check('lobby con 2 jugadores', true);
await host.screenshot({ path: 'shots/online-lobby.png' });
// el cliente cambia a la alianza roja en el lobby
await guest.click('[data-seg="al"] [data-v="red"]');
await waitFor(host, () => document.querySelectorAll('.net-p.red').length === 1, 5000);
check('el host ve el cambio de alianza', true);
await host.click('[data-start]');
await waitFor(guest, () => !!window.app.session?.replica, 10000);
const cfg = await guest.evaluate(() => {
  const s = window.app.session;
  const me = s.playerRobot(0);
  return { robots: s.robots.length, alliance: me?.alliance, mode: s.cfg.mode };
});
check('el cliente arranca el match', cfg.robots === 6 && cfg.alliance === 'red', JSON.stringify(cfg));
// tras la cuenta regresiva y el AUTO (se adelanta el reloj del host) llega TELEOP
// (sin GPU, dos pestañas dibujan a ~2 FPS: se salta la cuenta regresiva y se acelera el host)
await host.evaluate(() => { window.app.countdown = 0.01; window.app.session.timeScale = 8; });
await waitFor(host, () => window.app.session.match.phase === 'AUTO', 30000);
await host.evaluate(() => { window.app.session.match.t = 23.5; });
await waitFor(guest, () => window.app.session.match.phase === 'TRANSITION', 8000);
check('la fase del match llega al cliente', true);
const start = await host.evaluate(() => { const r = window.app.session.robots.find((x) => x.control.type === 'player' && x.control.slot === 1); return { x: r.phys.curPos.x, z: r.phys.curPos.z }; });
await guest.bringToFront();
await guest.keyboard.down('KeyW');
await guest.waitForTimeout(3000);
await guest.keyboard.up('KeyW');
const end = await host.evaluate(() => { const r = window.app.session.robots.find((x) => x.control.type === 'player' && x.control.slot === 1); return { x: r.phys.curPos.x, z: r.phys.curPos.z }; });
const moved = Math.hypot(end.x - start.x, end.z - start.z);
check('el robot del cliente se mueve en el host', moved > 0.5, `${moved.toFixed(2)} m`);
// el cliente dibuja la pose del host
await host.evaluate(() => { window.app.session.timeScale = 1; });
await guest.waitForTimeout(800);
const diff = await guest.evaluate(() => {
  const s = window.app.session;
  const r = s.playerRobot(0);
  return { x: r.phys.curPos.x, z: r.phys.curPos.z, fuelShown: s.fuel.state.filter((v) => v === 0).length };
});
check('el cliente ve su robot donde está en el host', Math.hypot(diff.x - end.x, diff.z - end.z) < 0.3, JSON.stringify(diff));
// mismo marcador (el estado lento llega a 4 Hz: se congela el host y se espera)
await host.evaluate(() => { window.app.session.timeScale = 0; });
const score = () => `${window.app.session.match.score('red')}-${window.app.session.match.score('blue')}`;
for (let k = 0; k < 10; k++) if ((await host.evaluate(score)) === (await guest.evaluate(score))) break; else await host.waitForTimeout(300);
const scores = await Promise.all([host, guest].map((p) => p.evaluate(score)));
await host.evaluate(() => { window.app.session.timeScale = 1; });
check('mismo marcador', scores[0] === scores[1], scores.join(' / '));
// un espectador entra con el match empezado: ve los 6 robots y el FUEL del host, sin robot propio
const spect = await ctx.newPage();
spect.on('pageerror', (e) => console.log('PAGEERR spect', e.message));
await spect.goto(`http://localhost:4190/?signal=local&quality=low&join=${code}&watch=1`);
await waitFor(spect, () => !!window.app.session?.replica, 30000).then(
  () => check('el espectador entra a medio match', true),
  () => check('el espectador entra a medio match', false),
);
await host.evaluate(() => { window.app.session.timeScale = 0; });
await spect.waitForTimeout(1500);
const seen = await spect.evaluate(() => {
  const s = window.app.session;
  return { robots: s.robots.length, mine: s.localPlayers().length, bar: !!document.querySelector('.spec-bar'), fuel: [...s.fuel.state].filter((v) => v === 0).length, x: s.robots[3].phys.curPos.x };
});
const truth = await host.evaluate(() => { const s = window.app.session; return { fuel: [...s.fuel.state].filter((v) => v === 0).length, x: s.robots[3].phys.curPos.x }; });
await host.evaluate(() => { window.app.session.timeScale = 1; });
check('el espectador ve el campo del host', seen.robots === 6 && seen.mine === 0 && seen.bar && seen.fuel === truth.fuel && Math.abs(seen.x - truth.x) < 0.05, `${JSON.stringify(seen)} vs ${JSON.stringify(truth)}`);
const lobbyCount = await host.evaluate(() => window.app.netHost.lobby().players.filter((p) => !p.spectator).length);
check('el espectador no ocupa lugar de jugador', lobbyCount === 2, String(lobbyCount));
await spect.screenshot({ path: 'shots/online-spectator.png' });
await spect.close();
await guest.screenshot({ path: 'shots/online-guest.png' });
await host.screenshot({ path: 'shots/online-host.png' });
// el cliente se va: la IA toma su robot
await guest.evaluate(() => window.app.quitToMenu());
await waitFor(host, () => window.app.session.ais.size === 5, 8000).then(
  () => check('la IA toma el robot del que se fue', true),
  () => check('la IA toma el robot del que se fue', false),
);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
