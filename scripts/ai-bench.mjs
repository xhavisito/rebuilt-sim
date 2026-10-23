// Banco de pruebas de la IA: matches de solo IA (espectador, simulados sin esperar a cada cuadro)
// con una dificultad por alianza y los mismos robots en las dos (`?mirror=1`). Mide puntos,
// victorias, faltas (y qué hacía la IA que la cometió) y tiempo defendiendo; alterna los lados
// para que el lado del campo no cuente. Requiere `npm run build`.
//
//   node scripts/ai-bench.mjs --a hard --b normal --matches 6 [--par 3]
//   node scripts/ai-bench.mjs --a hard --b hard --tweakA '{"defense":{"willing":0}}'
//
// `--tweakA`/`--tweakB` cambian el perfil de dificultad de esa alianza (ver src/ai/difficulty.ts)
// para comparar variantes. Con CHROMIUM_PATH se usa ese Chromium.
import { chromium } from 'playwright';
import { startServer } from './scenarios/_server.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const A = args.a ?? 'hard';
const B = args.b ?? 'normal';
const N = Number(args.matches ?? 4);
const PAR = Number(args.par ?? 3);
const tweak = { A: args.tweakA ? JSON.parse(args.tweakA) : null, B: args.tweakB ? JSON.parse(args.tweakB) : null };
const port = 4230 + Math.floor(Math.random() * 60);
const server = await startServer(port);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const labelA = `A:${A}${tweak.A ? '*' : ''}`;
const labelB = `B:${B}${tweak.B ? '*' : ''}`;
const eff = { marked: { t: 0, n: 0 }, free: { t: 0, n: 0 } };
const totals = { [labelA]: { pts: 0, wins: 0, fouls: 0, defend: 0 }, [labelB]: { pts: 0, wins: 0, fouls: 0, defend: 0 } };

async function runMatch(k) {
  const aBlue = k % 2 === 0;
  const blue = aBlue ? A : B;
  const red = aBlue ? B : A;
  // contexto nuevo por match: la memoria de la IA (localStorage) arranca igual en todos
  const context = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${server.url}/?mode=match&spectate=1&quality=low&mirror=1&difficultyBlue=${blue}&difficultyRed=${red}`);
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 180000 });
  const t0 = Date.now();
  const res = await page.evaluate(
    (tw) =>
      new Promise((resolve) => {
        const s = window.app.session;
        const defend = { red: 0, blue: 0 };
        const dt = s.pw.dt;
        // variantes del perfil de dificultad por alianza (solo para comparar)
        const merge = (d, t) => ({ ...d, ...t, defense: { ...d.defense, ...(t.defense ?? {}) } });
        for (const [i, ai] of s.ais) {
          const t = tw[s.robots[i].alliance];
          if (t) ai.d = merge(ai.d, t);
        }
        s.brain.alliances = s.brain.alliances.filter((a) => tw[a]?.brain !== false);
        const willing = s.brain.defenseWilling;
        s.brain.defenseWilling = (a) => tw[a]?.defense?.willing ?? willing(a);
        // qué hacía la IA que cometió cada falta (regla:estado)
        const why = {};
        const eff = { marked: { t: 0, n: 0 }, free: { t: 0, n: 0 } };
        let hooked = null;
        const hook = (m) => {
          if (hooked === m) return;
          hooked = m;
          const add = m.addFoul.bind(m);
          m.addFoul = (rule, sev, off, idx, note) => {
            const key = `${rule}:${s.ais.get(idx)?.state ?? '-'}`;
            why[key] = (why[key] ?? 0) + 1;
            return add(rule, sev, off, idx, note);
          };
        };
        // Simula a mano en bloques de 0.5 s de match (sin esperar a cada cuadro)
        const pump = () => {
          const m = s.match;
          if (!m.running && m.t === 0) return setTimeout(pump, 50); // cuenta regresiva
          s.timeScale = 0;
          hook(m);
          // ¿a quién defienden en este bloque? (para medir cuánto anota defendido vs. libre)
          const marked = new Set([...s.ais.values()].filter((ai) => ai.state === 'defend').map((ai) => ai.defendTarget));
          const before = s.robots.map((r) => r.stats.fuelScored);
          for (let i = 0; i < 0.5 / dt; i++) {
            s.step(dt, []);
            for (const [j, ai] of s.ais) if (ai.state === 'defend') defend[s.robots[j].alliance] += dt;
          }
          for (const r of s.robots) {
            if (!m.isHubActive(r.alliance)) continue;
            const o = marked.has(r.index) ? eff.marked : eff.free;
            o.t += 0.5;
            o.n += r.stats.fuelScored - before[r.index];
          }
          if (!(m.phase === 'DONE' || (m.phase === 'POST' && m.teleopTowerDone))) return setTimeout(pump, 0);
          const fouls = { red: 0, blue: 0 };
          for (const f of m.fouls) fouls[f.offender]++;
          resolve({ red: m.score('red'), blue: m.score('blue'), fouls, why, defend, eff });
        };
        pump();
      }),
    { blue: aBlue ? tweak.A : tweak.B, red: aBlue ? tweak.B : tweak.A },
  );
  await context.close();
  const wall = ((Date.now() - t0) / 1000).toFixed(0);
  const lb = aBlue ? labelA : labelB;
  const lr = aBlue ? labelB : labelA;
  const add = (label, a) => {
    const o = a === 'blue' ? 'red' : 'blue';
    totals[label].pts += res[a];
    totals[label].fouls += res.fouls[a];
    totals[label].defend += res.defend[a];
    if (res[a] > res[o]) totals[label].wins++;
  };
  for (const k of ['marked', 'free']) {
    eff[k].t += res.eff[k].t;
    eff[k].n += res.eff[k].n;
  }
  add(lb, 'blue');
  add(lr, 'red');
  console.log(
    `#${k + 1} azul ${lb} ${res.blue} – ${res.red} rojo ${lr} · faltas ${res.fouls.blue}/${res.fouls.red} ${JSON.stringify(res.why)} · defensa ${res.defend.blue.toFixed(0)}/${res.defend.red.toFixed(0)} s · ${wall}s${errs.length ? ' ERR ' + errs[0] : ''}`,
  );
}

for (let k = 0; k < N; k += PAR) await Promise.all(Array.from({ length: Math.min(PAR, N - k) }, (_, j) => runMatch(k + j)));
for (const [l, t] of Object.entries(totals))
  console.log(`${l}: ${t.wins}/${N} ganados · ${(t.pts / N).toFixed(0)} pts/match · ${(t.fouls / N).toFixed(1)} faltas/match · ${(t.defend / N).toFixed(0)} s defendiendo/match`);
console.log(`FUEL/s con el HUB activo: defendido ${(eff.marked.n / Math.max(1, eff.marked.t)).toFixed(2)} (${eff.marked.t.toFixed(0)} s) · libre ${(eff.free.n / Math.max(1, eff.free.t)).toFixed(2)}`);
await browser.close();
server.close();
process.exit(0);
