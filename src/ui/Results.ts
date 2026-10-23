/**
 * Pantalla de resultados: desglose por alianza, RP, MVP, gráfica de puntos en el tiempo
 * (con leyenda, etiquetas directas, cruz y tooltip al pasar, y vista de tabla), faltas y tarjetas.
 */
import { formatTimer, T, timerSeconds } from '../core/clock';
import { RULES } from '../core/fouls';
import type { Alliance } from '../core/types';
import type { AllianceResult, MatchResults } from '../game/results';
import { getLang, t } from './i18n';
import { ic } from './chrome';

/** Colores validados (dataviz validate_palette, superficie oscura). */
const SERIES: Record<Alliance, string> = { red: '#ef5350', blue: '#2f8fe0' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function matchClock(tm: number): string {
  return tm < T.teleopStart ? `AUTO ${formatTimer(timerSeconds(tm))}` : formatTimer(timerSeconds(tm));
}

function rpCell(r: AllianceResult): string {
  const chip = (on: boolean, label: string) => `<span class="rpchip ${on ? 'on' : ''}">${on ? '✓' : '·'} ${label}</span>`;
  return `<div class="rprow">${chip(r.rp.win === 3, 'WIN')}${r.rp.win === 1 ? chip(true, 'TIE') : ''}${chip(r.rp.energized, 'ENERGIZED')}${chip(
    r.rp.supercharged,
    'SUPERCHARGED',
  )}${chip(r.rp.traversal, 'TRAVERSAL')}</div><div class="rptotal">${r.rp.total} RP</div>`;
}

function chart(res: MatchResults): string {
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 74, t: 10, b: 22 };
  const tMax = T.postEnd;
  const max = Math.max(10, ...res.history.map((h) => Math.max(h.red, h.blue)));
  const yMax = Math.ceil(max / 20) * 20;
  const x = (tt: number) => pad.l + (tt / tMax) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const path = (a: Alliance) =>
    res.history.map((h, i) => `${i ? 'L' : 'M'}${x(h.t).toFixed(1)},${y(h[a]).toFixed(1)}`).join('');
  let grid = '';
  for (let v = 0; v <= yMax; v += yMax / 4)
    grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  // Marcas de periodo (AUTO, TRANSITION, SHIFTS, END GAME)
  const marks: Array<[number, string]> = [
    [T.teleopStart, 'T'],
    [T.shift1, 'S1'],
    [T.shift2, 'S2'],
    [T.shift3, 'S3'],
    [T.shift4, 'S4'],
    [T.endGame, 'EG'],
  ];
  for (const [tt, l] of marks)
    grid += `<line x1="${x(tt)}" x2="${x(tt)}" y1="${pad.t}" y2="${H - pad.b}" class="g2"/><text x="${x(tt)}" y="${H - 6}" class="ax" text-anchor="middle">${l}</text>`;
  const last = res.history[res.history.length - 1];
  // Etiquetas directas al final (texto neutro + muestra de color), separadas si chocan
  let ly = { red: y(last.red), blue: y(last.blue) };
  if (Math.abs(ly.red - ly.blue) < 14) {
    const mid = (ly.red + ly.blue) / 2;
    const up = last.red >= last.blue ? 'red' : 'blue';
    ly = up === 'red' ? { red: mid - 8, blue: mid + 8 } : { red: mid + 8, blue: mid - 8 };
  }
  const label = (a: Alliance) =>
    `<rect x="${x(last.t) + 6}" y="${ly[a] - 5}" width="10" height="10" rx="2" fill="${SERIES[a]}"/><text x="${x(last.t) + 20}" y="${ly[a] + 4}" class="lbl">${t(a)} ${last[a]}</text>`;
  return `
    <div class="legend"><span><i style="background:${SERIES.red}"></i>${t('red')}</span><span><i style="background:${SERIES.blue}"></i>${t('blue')}</span></div>
    <div class="chartwrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${t('scoreOverTime')}">
        ${grid}
        <path d="${path('red')}" stroke="${SERIES.red}" class="ln"/>
        <path d="${path('blue')}" stroke="${SERIES.blue}" class="ln"/>
        ${label('red')}${label('blue')}
        <line class="xh" y1="${pad.t}" y2="${H - pad.b}" x1="-10" x2="-10"/>
        <circle class="dot red" r="4" cx="-10" cy="-10" fill="${SERIES.red}"/>
        <circle class="dot blue" r="4" cx="-10" cy="-10" fill="${SERIES.blue}"/>
        <rect class="hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent"/>
      </svg>
      <div class="tip"></div>
    </div>
    <details class="tableview"><summary>Tabla</summary><table>
      <tr><th></th><th>${t('red')}</th><th>${t('blue')}</th></tr>
      ${[T.autoEnd, T.shift1, T.shift2, T.shift3, T.shift4, T.endGame, T.teleopEnd]
        .map((tt) => {
          const h = res.history.reduce((b, s) => (Math.abs(s.t - tt) < Math.abs(b.t - tt) ? s : b), res.history[0]);
          return `<tr><td>${matchClock(Math.min(tt, T.teleopEnd - 0.01))}</td><td>${h.red}</td><td>${h.blue}</td></tr>`;
        })
        .join('')}
    </table></details>`;
}

/** `replay`: hay repetición del match (botones para verla o guardarla). */
export function renderResults(res: MatchResults, tournament = false, replay = false): string {
  const lang = getLang();
  const title =
    res.winner === 'tie' ? t('tie') : t('winner', { a: t(res.winner) });
  const row = (label: string, k: (r: AllianceResult) => string | number, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td>${k(res.red)}</td><td>${k(res.blue)}</td></tr>`;
  const teams = (r: AllianceResult) =>
    r.teams
      .map(
        (tm) =>
          `<span class="team ${tm.isPlayer ? 'me' : ''}">${tm.team}${tm.dq ? ` <b class="dq">${t('dq')}</b>` : ''}${tm.level ? ` · L${tm.level}` : ''}</span>`,
      )
      .join('');
  const fouls = res.fouls.length
    ? res.fouls
        .map(
          (f) =>
            `<li><span class="sw ${f.offender}"></span><b>${f.rule}</b> – ${esc(RULES[f.rule].title)} · ${f.severity} FOUL <em>${res.teamOf(f.robot) || 'HP'} · ${matchClock(f.time)}</em></li>`,
        )
        .join('')
    : `<li class="none">${t('noFouls')}</li>`;
  const cards = res.cards
    .map((c) => `<li><span class="card ${c.card === 'RED' ? 'r' : 'y'}"></span><b>${c.card} CARD</b> · ${res.teamOf(c.robot)} (${c.rule})</li>`)
    .join('');
  const mvp = res.mvp
    ? `<div class="mvp"><span class="sw ${res.mvp.alliance}"></span><b>${t('mvp')}: ${res.mvp.team}</b> ${esc(res.mvp.name)} — FUEL ${res.mvp.fuel} · TOWER ${res.mvp.tower}${
        res.mvp.fouls ? ` · −${res.mvp.fouls} ${lang === 'es' ? 'en faltas' : 'in fouls'}` : ''
      }</div>`
    : '';
  return `
  <div class="dialog results">
    <h2 class="${res.winner}">${title}</h2>
    <div class="final"><span class="red">${res.red.total}</span><span class="dash">–</span><span class="blue">${res.blue.total}</span></div>
    ${mvp}
    <table class="breakdown">
      <tr><th></th><th class="red">${t('red')}</th><th class="blue">${t('blue')}</th></tr>
      <tr class="teams"><td></td><td>${teams(res.red)}</td><td>${teams(res.blue)}</td></tr>
      ${row(t('autoFuel'), (r) => r.autoFuel)}
      ${row(t('teleopFuel'), (r) => r.teleopFuel)}
      ${row(t('towerAuto'), (r) => r.towerAuto)}
      ${row(t('towerTeleop'), (r) => r.towerTeleop)}
      ${row(t('foulPts'), (r) => `+${r.foulPoints}`)}
      ${row(t('foulsCommitted'), (r) => `${r.minorCommitted} MINOR · ${r.majorCommitted} MAJOR`)}
      ${row(t('total'), (r) => r.total, 'tot')}
      <tr class="rp"><td>${t('rp')}</td><td>${rpCell(res.red)}</td><td>${rpCell(res.blue)}</td></tr>
    </table>
    <h3>${t('scoreOverTime')}</h3>
    ${chart(res)}
    <h3>${t('foulList')}</h3>
    <ul class="fouls">${fouls}${cards}</ul>
    <div class="actions">
      ${tournament ? `<button data-a="continue" class="primary">${t('continueTournament')}</button>` : `<button data-a="rematch" class="primary">${t('rematch')}</button>`}
      ${replay ? `<button data-a="replay">${ic.play}${t('rp_watch')}</button><button data-a="replayFile">${t('rp_saveFile')}</button>` : ''}
      ${tournament ? '' : `<button data-a="menu">${t('quit')}</button>`}
    </div>
  </div>`;
}

/** Cruz + tooltip al pasar sobre la gráfica. */
export function attachChartHover(root: HTMLElement, res: MatchResults): void {
  const svg = root.querySelector<SVGSVGElement>('svg.chart');
  const tip = root.querySelector<HTMLElement>('.tip');
  if (!svg || !tip) return;
  const vb = svg.viewBox.baseVal;
  const pad = { l: 34, r: 74, t: 10, b: 22 };
  const tMax = T.postEnd;
  const yMax = Math.ceil(Math.max(10, ...res.history.map((h) => Math.max(h.red, h.blue))) / 20) * 20;
  const xh = svg.querySelector('.xh')!;
  const dots = { red: svg.querySelector('.dot.red')!, blue: svg.querySelector('.dot.blue')! };
  const move = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * vb.width;
    const tt = Math.max(0, Math.min(tMax, ((px - pad.l) / (vb.width - pad.l - pad.r)) * tMax));
    const h = res.history.reduce((b, s) => (Math.abs(s.t - tt) < Math.abs(b.t - tt) ? s : b), res.history[0]);
    const x = pad.l + (h.t / tMax) * (vb.width - pad.l - pad.r);
    const y = (v: number) => vb.height - pad.b - (v / yMax) * (vb.height - pad.t - pad.b);
    xh.setAttribute('x1', String(x));
    xh.setAttribute('x2', String(x));
    dots.red.setAttribute('cx', String(x));
    dots.red.setAttribute('cy', String(y(h.red)));
    dots.blue.setAttribute('cx', String(x));
    dots.blue.setAttribute('cy', String(y(h.blue)));
    tip.style.display = 'block';
    tip.style.left = `${(x / vb.width) * 100}%`;
    tip.innerHTML = `<b>${matchClock(h.t)}</b><br><i style="background:${SERIES.red}"></i>${t('red')} ${h.red}<br><i style="background:${SERIES.blue}"></i>${t('blue')} ${h.blue}`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => {
    tip.style.display = 'none';
    xh.setAttribute('x1', '-10');
    xh.setAttribute('x2', '-10');
    dots.red.setAttribute('cx', '-10');
    dots.blue.setAttribute('cx', '-10');
  });
}
