// Repeticiones y espectador: un match IA vs IA (acelerado) se graba solo; desde los resultados se
// ve la repetición (la pose de los robots coincide con la grabación al saltar), el director corta
// entre cámaras, se sigue a un robot, se recorta un clip (archivo y video), aparece en la pantalla
// de Repeticiones y el archivo del clip se vuelve a abrir.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4191);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-angle=vulkan', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const page = await ctx.newPage();
let fail = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${info ? ` · ${info}` : ''}`);
  if (!ok) fail++;
};
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  fail++;
});
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await page.goto('http://localhost:4191/?mode=match&spectate=1&quality=low');
await page.waitForFunction(() => !document.getElementById('loading'));
check('espectador: barra con cámaras y robots', await page.isVisible('.spec-bar .sp-camsel'));
await page.evaluate(() => {
  window.app.countdown = 0.01;
  window.app.session.timeScale = 4;
});
await page.waitForFunction(() => window.app.session.match.phase === 'AUTO', null, { timeout: 15000 });
// el director corta solo entre tomas
// (sin GPU hay pocos FPS y el director avanza con el tiempo de cada frame: se espera hasta 40 s)
const modes = new Set();
for (let k = 0; k < 80 && modes.size < 2; k++) {
  modes.add(await page.evaluate(() => window.app.session.rigs[0].mode));
  await page.waitForTimeout(500);
}
check('el director usa varias cámaras', modes.size >= 2, [...modes].join(','));
await page.screenshot({ path: 'shots/spectator-live.png' });
// seguir a un robot: tercera persona detrás de él
await page.click('.spec-bar [data-focus="4"]');
const follow = await page.evaluate(() => ({ cam: window.app.session.spectatorCam, focus: window.app.session.viewFocus }));
check('seguir a un robot', follow.cam === 'third' && follow.focus === 4, JSON.stringify(follow));
// al final del match
await page.evaluate(() => (window.app.session.match.t = 160));
await page.waitForSelector('.results [data-a="replay"]', { timeout: 30000 });
check('los resultados ofrecen la repetición', true);
const rec = await page.evaluate(() => ({ frames: window.app.lastReplay.frames.length, dur: window.app.lastReplay.meta.duration, events: window.app.lastReplay.events.length }));
check('se grabó el match (30 Hz)', rec.frames > rec.dur * 28 && rec.dur > 8, JSON.stringify(rec));
await page.click('.results [data-a="replay"]');
await page.waitForFunction(() => !!window.app.replay?.player, null, { timeout: 10000 });
check('la repetición abre con la línea de tiempo', await page.isVisible('.spec-bar .sp-tl'));
// saltar: los robots quedan donde estaban en la grabación
const pose = await page.evaluate(async () => {
  const p = window.app.replay.player;
  p.playing = false;
  const t = p.start + (p.end - p.start) * 0.6;
  p.seek(t);
  // (curPos = el cuadro siguiente; se dibuja interpolado entre los dos)
  const snap = p.reader.get(p.reader.indexAt(t) + 1);
  const r = window.app.session.robots[2].phys.curPos;
  const s = snap.robots[2].p;
  // y otra vez, hacia atrás
  p.seek(p.start + 1);
  const back = p.reader.get(p.reader.indexAt(p.start + 1) + 1).robots[2].p;
  const r2 = window.app.session.robots[2].phys.curPos;
  return { d1: Math.hypot(r.x - s[0], r.z - s[2]), d2: Math.hypot(r2.x - back[0], r2.z - back[2]), moved: Math.hypot(s[0] - back[0], s[2] - back[2]) };
});
check('saltar en la repetición pone los robots en su lugar', pose.d1 < 0.01 && pose.d2 < 0.01 && pose.moved > 0.3, JSON.stringify(pose));
// reproducir: avanza
const t0 = await page.evaluate(() => window.app.replay.player.t);
await page.click('.spec-bar [data-a="play"]');
await page.waitForTimeout(1200);
const t1 = await page.evaluate(() => window.app.replay.player.t);
check('play avanza el tiempo', t1 - t0 > 0.4, `${(t1 - t0).toFixed(2)} s`);
await page.keyboard.press('Space');
const paused = await page.evaluate(() => !window.app.replay.player.playing);
check('Espacio pausa', paused);
// clic en la línea de tiempo = saltar
const box = await page.locator('.sp-tl').boundingBox();
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
const frac = await page.evaluate(() => { const p = window.app.replay.player; return (p.t - p.start) / (p.end - p.start); });
check('clic en la línea de tiempo salta', Math.abs(frac - 0.25) < 0.03, frac.toFixed(3));
// cámaras del espectador en la repetición
for (const c of ['broadcast', 'top', 'onboard', 'free', 'director']) {
  await page.click('.spec-bar [data-a="cams"]');
  await page.click(`.spec-bar [data-cam="${c}"]`);
  await page.waitForTimeout(150);
}
check('cámaras de la repetición', (await page.evaluate(() => window.app.session.spectatorCam)) === 'director');
await page.evaluate(() => { window.app.replay.player.playing = true; });
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/replay.png' });
// clip: archivo
await page.click('.spec-bar [data-a="clip"]');
check('el clip muestra su rango', await page.isVisible('.sp-range'));
await page.screenshot({ path: 'shots/replay-clip.png' });
await page.click('.sp-clipbar [data-a="clipFile"]');
await page.waitForSelector('.file-ready', { timeout: 10000 });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.file-ready [data-a="download"]')]);
const clipPath = 'shots/clip.rbreplay';
await dl.saveAs(clipPath);
check('el clip se descarga', dl.suggestedFilename().endsWith('.rbreplay'), dl.suggestedFilename());
await page.click('.file-ready [data-a="close"]');
// clip: video (2 s)
const canVideo = await page.isVisible('.sp-clipbar [data-a="clipVideo"]');
if (canVideo) {
  await page.evaluate(() => {
    const p = window.app.replay.player;
    window.app.exportVideo(p.start + 3, p.start + 5);
  });
  await page.waitForSelector('.file-ready video', { timeout: 20000 });
  const size = await page.evaluate(() => document.querySelector('.file-ready .fr-name').textContent);
  check('el video del clip se graba', /KB|MB/.test(size), size);
  await page.screenshot({ path: 'shots/replay-video.png' });
  await page.click('.file-ready [data-a="close"]');
} else console.log('(sin MediaRecorder: se omite el video)');
// salir: Repeticiones lista el match (guardado solo)
await page.keyboard.press('Escape');
await page.click('.overlay [data-a="quit"]');
await page.waitForSelector('.rp-list .rp-row', { timeout: 10000 });
const rows = await page.locator('.rp-row').count();
check('la repetición quedó guardada', rows >= 1, `${rows}`);
await page.screenshot({ path: 'shots/replays-screen.png' });
// abrir el archivo del clip
await page.setInputFiles('[data-file]', clipPath);
await page.waitForFunction(() => !!window.app.replay?.player, null, { timeout: 10000 });
const clip = await page.evaluate(() => ({ dur: window.app.replay.player.end - window.app.replay.player.start, clip: window.app.replay.player.data.meta.clip }));
check('el clip se abre desde el archivo', clip.dur > 5 && clip.dur < 20 && !!clip.clip, JSON.stringify(clip));
// un archivo que no es repetición
await page.evaluate(() => window.app.quitToMenu());
await page.waitForSelector('[data-file]', { state: 'attached' });
await page.setInputFiles('[data-file]', { name: 'x.rbreplay', mimeType: 'application/octet-stream', buffer: Buffer.from('hola') });
await page.waitForSelector('.rp-panel .msg.bad', { timeout: 5000 });
check('un archivo inválido se rechaza con aviso', true);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
