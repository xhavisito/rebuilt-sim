// Partida rápida en línea (botón Jugar, sin códigos), con pestañas del mismo navegador
// (señalización y directorio locales por BroadcastChannel; la conexión sí es WebRTC):
// dos jugadores pican Jugar a la vez, no hay salas y abren una cada quien: se juntan solos en una.
// El lobby arranca solo con la IA en los lugares vacíos; un tercero pica Jugar con el match
// empezado y entra en lugar de un robot de la IA. El cliente predice su robot (va en el presente).
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4192);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=vulkan', '--enable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
let fail = 0;
const waitFor = async (page, fn, timeout, arg) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 200))) if (await page.evaluate(fn, arg)) return true;
  throw new Error(`timeout: ${fn}`);
};
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${info ? ` · ${info}` : ''}`);
  if (!ok) fail++;
};
const open = async (n, q = '') => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`PAGEERR ${n}`, e.message));
  p.on('console', (m) => m.type() === 'error' && console.log(`CONSOLE ${n}`, m.text()));
  await p.goto(`http://localhost:4192/?signal=local&quality=low${q}`);
  await waitFor(p, () => !document.getElementById('loading'), 30000);
  return p;
};
const a = await open('a');
const b = await open('b');
// los dos pican Jugar al mismo tiempo
await Promise.all([a.click('[data-go="quick"]'), b.click('[data-go="quick"]')]);
// uno se queda de host y el otro se cambia a su sala
let host, guest;
try {
  await waitFor(a, () => true, 1);
  for (const t0 = Date.now(); Date.now() - t0 < 20000; await new Promise((r) => setTimeout(r, 300))) {
    const [ha, hb] = await Promise.all([a, b].map((p) => p.evaluate(() => ({ host: !!window.app.netHost, client: !!window.app.netClient, n: window.app.netHost?.lobby().players.length ?? 0 }))));
    if (ha.host && ha.n === 2 && hb.client) [host, guest] = [a, b];
    else if (hb.host && hb.n === 2 && ha.client) [host, guest] = [b, a];
    if (host) break;
  }
} catch {}
check('dos que buscan a la vez quedan en la misma sala', !!host);
if (!host) {
  await browser.close();
  server.close();
  process.exit(1);
}
const lobby = await host.evaluate(() => ({ quick: window.app.netHost.quick, pub: window.app.netHost.isPublic, fill: window.app.netHost.fillAi, cd: document.querySelector('[data-startsin]')?.textContent ?? '' }));
check('sala rápida pública, con IA y cuenta regresiva', lobby.quick && lobby.pub && lobby.fill && /\d/.test(lobby.cd), JSON.stringify(lobby));
await waitFor(guest, () => /\d/.test(document.querySelector('[data-startsin]')?.textContent ?? ''), 5000).then(
  () => check('el invitado ve la cuenta regresiva', true),
  () => check('el invitado ve la cuenta regresiva', false),
);
await host.screenshot({ path: 'shots/quick-lobby.png' });
// arranca solo (se adelanta la hora)
await host.evaluate(() => (window.app.netHost.startAt = performance.now()));
await waitFor(guest, () => !!window.app.session?.replica, 15000);
const ais = await host.evaluate(() => window.app.session.ais.size);
check('el lobby arranca solo con la IA en los lugares vacíos', ais === 4, `IA: ${ais}`);
await host.evaluate(() => {
  window.app.countdown = 0.01;
  window.app.session.timeScale = 8;
});
await waitFor(host, () => window.app.session.match.phase === 'AUTO', 30000);
await host.evaluate(() => {
  window.app.session.match.t = 23.5;
  window.app.session.timeScale = 1;
});
await waitFor(guest, () => window.app.session.match.phase === 'TRANSITION', 8000);
// un tercero pica Jugar con el match empezado: entra en lugar de un robot de la IA
await waitFor(host, () => window.app.netHost.lobby().players.length === 2, 1000);
const c = await open('c', '&lag=300');
await c.click('[data-go="quick"]');
await waitFor(c, () => !!window.app.session?.replica, 25000).then(
  () => check('el tercero entra a medio match', true),
  () => check('el tercero entra a medio match', false),
);
const late = await c.evaluate(() => {
  const s = window.app.session;
  return { mine: s.localPlayers().length, robot: window.app.netClient?.robot ?? -1, phase: s.match?.phase };
});
const hostSide = await host.evaluate((i) => ({ ais: window.app.session.ais.size, ctl: window.app.session.robots[i]?.control.type }), late.robot);
check('toma un robot de la IA', late.mine === 1 && late.robot >= 0 && hostSide.ais === 3 && hostSide.ctl === 'player', `${JSON.stringify(late)} ${JSON.stringify(hostSide)}`);
// (sin GPU tres pestañas no caben: el invitado se va, la IA toma su robot)
await guest.evaluate(() => window.app.quitToMenu());
await guest.close();
await waitFor(host, () => window.app.session.ais.size === 4, 8000);
// sus controles mueven ese robot en el host
const pos = (i) => host.evaluate((k) => ({ x: window.app.session.robots[k].phys.curPos.x, z: window.app.session.robots[k].phys.curPos.z }), i);
await host.bringToFront();
// (con ?lag=300 el cliente simula 300 ms de ida y vuelta: sin predicción su robot tardaría eso más
// los 100 ms de interpolación en moverse en su pantalla)
// cuánto tarda el robot propio en moverse en la pantalla del cliente desde que pica W
const respond = (predict) =>
  c.evaluate(
    (predict) =>
      new Promise((res) => {
        const s = window.app.session;
        const rep = s.replica;
        rep.__pred ??= rep.prediction;
        rep.prediction = predict ? rep.__pred : null;
        if (rep.__pred) rep.__pred.weight = 0;
        const r = s.playerRobot(0);
        const x0 = r.phys.curPos.x;
        const z0 = r.phys.curPos.z;
        const t0 = performance.now();
        let first = -1;
        let maxW = 0;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
        const f = () => {
          maxW = Math.max(maxW, rep.prediction?.weight ?? 0);
          if (first < 0 && Math.hypot(r.phys.curPos.x - x0, r.phys.curPos.z - z0) > 0.05) first = performance.now() - t0;
          if (performance.now() - t0 < 1500) setTimeout(f, 20);
          else {
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
            res({ first: Math.round(first), maxW, rtt: Math.round(window.app.netClient.rtt * 1000) });
          }
        };
        f();
      }),
    predict,
  );
const still = () => waitFor(host, (i) => Math.hypot(window.app.session.robots[i].phys.velocity().x, window.app.session.robots[i].phys.velocity().z) < 0.05, 15000, late.robot).catch(() => {});
await waitFor(c, () => ['TRANSITION', 'SHIFT1'].includes(window.app.session.match.phase) && window.app.session.playerRobot(0).enabled, 10000);
const slow = await respond(false);
await still();
const p0 = await pos(late.robot);
const resp = await respond(true);
await still();
const p1 = await pos(late.robot);
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check('el robot tomado responde a sus controles', moved > 0.1, `${moved.toFixed(2)} m`);
// (sin GPU el host simula a tirones: con más de ~0.35 s sin sus estados la predicción se apaga
// a propósito y la comparación no dice nada; las cuentas están en tests/quickMatch.test.ts)
if (resp.rtt > 600) console.log(`SKIP predicción en pantalla: host trabado en este equipo (ida y vuelta ${resp.rtt} ms)`);
else check('con predicción se mueve en su pantalla antes que sin ella', resp.maxW > 0.3 && resp.first >= 0 && (slow.first < 0 || resp.first < slow.first), `con ${JSON.stringify(resp)} · sin ${JSON.stringify(slow)}`);
// ya quieto (en el host también), el cliente lo ve donde está en el host
await still();
await c.waitForTimeout(1500);
const seen = await c.evaluate(() => {
  const r = window.app.session.playerRobot(0);
  return { x: r.phys.curPos.x, z: r.phys.curPos.z };
});
const truth = await pos(late.robot);
const d = Math.hypot(seen.x - truth.x, seen.z - truth.z);
check('ya quieto, el cliente lo ve donde está en el host', d < 0.3, `${d.toFixed(2)} m`);
await c.screenshot({ path: 'shots/quick-late.png' });
// se va: la IA lo vuelve a tomar
await c.evaluate(() => window.app.quitToMenu());
await waitFor(host, () => window.app.session.ais.size === 5, 8000).then(
  () => check('al irse, la IA retoma el robot', true),
  () => check('al irse, la IA retoma el robot', false),
);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
