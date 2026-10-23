// Torneo de 32 equipos completo: Qualifications → selección de alianzas (8 alianzas) → Playoffs
// de doble eliminación → Final al mejor de 3. Los matches del jugador se rellenan con un
// resultado (sin jugarlos) para recorrer todo el bracket; capturas en escritorio y móvil.
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const server = await startServer(4189);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu'], executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${server.url}/`);
await page.waitForFunction(() => !document.getElementById('loading'));
await page.click('[data-go="tournament"]');
await page.click('[data-seg="teams"] [data-v="32"]');
await page.click('[data-seg="others"] [data-v="skip"]');
await page.click('[data-create]');

/** Resultado inventado para el match pendiente del jugador (gana o pierde al azar). */
const fillMine = () =>
  page.evaluate(() => {
    const KEY = 'rebuilt-sim.tournament.v1';
    const t = JSON.parse(localStorage.getItem(KEY));
    const me = t.teams.findIndex((x) => x.isPlayer);
    const all = [...t.quals, ...t.playoffs];
    const m = all.find((x) => !x.result && [...x.red, ...x.blue].includes(me));
    if (!m) return false;
    const side = (s) => ({ score: s, noFoul: s, autoFuel: 20, tower: 20, rp: s > 200 ? 4 : 1 });
    // En Qualifications el jugador gana fácil (queda de capitán); en Playoffs, al azar
    const mine = m.red.includes(me) ? 'red' : 'blue';
    const a = 150 + Math.floor(Math.random() * 120);
    const b = 150 + Math.floor(Math.random() * 120);
    m.result = { red: side(a), blue: side(a === b ? b + 1 : b) };
    if (m.kind === 'qual') m.result[mine] = { ...side(420), rp: 6 };
    localStorage.setItem(KEY, JSON.stringify(t));
    window.app.openTournament();
    return true;
  });

let shotMid = false;
let shotPick = false;
for (let step = 0; step < 300; step++) {
  if (await page.$('[data-skipall]')) {
    await page.click('[data-skipall]');
    continue;
  }
  if (await page.$('[data-invite]')) {
    if (!shotPick) {
      shotPick = true;
      await page.screenshot({ path: 'shots/tournament-pick.png' });
    }
    await page.click('[data-invite]');
    continue;
  }
  if (await page.$('[data-accept]')) {
    await page.click('[data-accept]');
    continue;
  }
  const state = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('rebuilt-sim.tournament.v1'));
    return { alliances: t.alliances?.length ?? 0, playoffs: t.playoffs.filter((m) => m.result).length, champion: t.champion };
  });
  if (!shotMid && state.playoffs >= 7) {
    shotMid = true;
    await page.locator('.bracket').screenshot({ path: 'shots/tournament-bracket-mid.png' });
  }
  if (state.champion !== null) break;
  if (!(await fillMine())) {
    // El jugador ya quedó fuera: los demás matches se simulan solos al omitir
    if (await page.$('[data-skip]')) await page.click('[data-skip]');
    else break;
  }
}
const final = await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem('rebuilt-sim.tournament.v1'));
  return {
    teams: t.teams.length,
    alliances: t.alliances.map((a) => a.length),
    playoffs: t.playoffs.map((m) => m.id).join(' '),
    champion: t.champion,
    myAlliance: t.alliances.findIndex((a) => a.some((i) => t.teams[i].isPlayer)) + 1,
    cards: document.querySelectorAll('.br-match').length,
    places: document.querySelectorAll('.br-place').length,
  };
});
console.log('tournament', JSON.stringify({ ...final, picked: shotPick }));
await page.screenshot({ path: 'shots/tournament.png' });
await page.locator('.bracket').screenshot({ path: 'shots/tournament-bracket.png' });
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(200);
await page.locator('.bracket').scrollIntoViewIfNeeded();
await page.screenshot({ path: 'shots/tournament-bracket-mobile.png' });
console.log('errors', errors.length ? errors : 'none');
await browser.close();
server.close();
process.exit(final.champion !== null && final.alliances.length === 8 && !errors.length ? 0 : 1);
