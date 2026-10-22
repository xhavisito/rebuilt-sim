/**
 * Dashboard de estrategia del torneo (lo que haría el estratega de un equipo finalista): para tu
 * próximo match muestra tu DRIVER STATION, la predicción, la ESTRATEGIA DEL MATCH en cuatro
 * tablas editables (AUTO con mapa de salidas y rutas, SHIFT activo, SHIFT inactivo y END GAME),
 * que arranca con la sugerencia del drive coach, los consejos y el scouting de los 6 robots
 * (pros, contras y datos del evento). Al guardar, tus compañeros de la IA siguen el plan y el
 * drive coach lo recuerda en el match. Debajo, el scouting de todos los equipos del evento.
 */
import { autoConflicts, defaultStartZ, normalizeRow, planTowerPoints, rowsToPlans, suggestedRows, type PhaseRow } from '../ai/PhasePlan';
import { planMatch, report, type MatchPlan, type Note, type RobotReport, type ScoutRobot } from '../ai/Strategist';
import { ACTIVE_TASKS, INACTIVE_TASKS, loadStrategies, saveCustomStrategies, type Strategy } from '../ai/Strategy';
import { profileFromSpec } from '../ai/Scouting';
import { loadRoutines, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { robotById } from '../config/robots';
import { saveSettings, type Settings } from '../config/settings';
import { defaultStart, separateStarts } from '../core/startRules';
import { teamAverages, type TMatch, type Tournament } from '../core/tournament';
import type { Alliance, StationNumber } from '../core/types';
import { esc } from './forms';
import { t, type TKey } from './i18n';

export const COACH_PLAN_ID = 'coach-plan';

/** Robot del torneo con su scouting (ficha + promedios del evento). */
export function scoutTeam(tt: Tournament, i: number): ScoutRobot {
  const tm = tt.teams[i];
  const spec = robotById(tm.specId);
  spec.teamNumber = tm.team;
  const base = profileFromSpec(spec);
  const profile = tm.traits ? { ...base, ...tm.traits } : base;
  const av = teamAverages(tt, i);
  return { team: tm.team, name: tm.name, spec, profile, stats: av.played ? av : undefined, isPlayer: tm.isPlayer };
}

/** Plan del próximo match del jugador. */
export function planForMatch(tt: Tournament, m: TMatch): { plan: MatchPlan; mine: number[] } {
  const me = tt.teams.findIndex((x) => x.isPlayer);
  const mine = m.red.includes(me) ? m.red : m.blue;
  const opp = mine === m.red ? m.blue : m.red;
  const event = tt.teams.map((_, i) => scoutTeam(tt, i));
  return { plan: planMatch(mine.map((i) => event[i]), opp.map((i) => event[i]), tt.eventType, loadRoutines(), event), mine };
}

/** Tu DRIVER STATION y alianza en un match del torneo. */
export function myStation(tt: Tournament, m: TMatch): { station: StationNumber; alliance: Alliance } {
  const me = tt.teams.findIndex((x) => x.isPlayer);
  const red = m.red.includes(me);
  return { station: ((red ? m.red : m.blue).indexOf(me) + 1) as StationNumber, alliance: red ? 'red' : 'blue' };
}

/** Plan por fases del match: el que guardaste o, si no, la sugerencia del drive coach. */
export function rowsForMatch(tt: Tournament, m: TMatch): { plan: MatchPlan; rows: PhaseRow[]; suggested: PhaseRow[]; edited: boolean } {
  const { plan, mine } = planForMatch(tt, m);
  const suggested = suggestedRows(
    plan,
    mine.map((i) => robotById(tt.teams[i].specId).climb.maxLevel as 0 | 1 | 2 | 3),
  );
  const saved = (tt.matchPlans?.[m.id] as PhaseRow[] | undefined)?.map(normalizeRow);
  return { plan, rows: structuredClone(saved ?? suggested), suggested, edited: !!saved };
}

/**
 * Aplica el plan por fases: estrategia de tu alianza (tareas de cada fase, marcas, AUTO, salida y
 * TOWER de cada DS) y tu rutina de AUTO y tu salida.
 */
export function applyRows(rows: PhaseRow[], settings: Settings, label: string): void {
  const strat: Strategy = { id: COACH_PLAN_ID, name: label, plans: rowsToPlans(rows) as Strategy['plans'] };
  const list = loadStrategies().filter((s) => !s.builtin && s.id !== COACH_PLAN_ID);
  saveCustomStrategies([...list, strat]);
  settings.match.strategy = COACH_PLAN_ID;
  const me = rows.find((r) => r.isPlayer);
  if (me) {
    settings.match.autoRoutine = me.auto;
    settings.match.startOffset = me.startZ === null ? 0 : Math.round((me.startZ - defaultStartZ(me.station)) * 100) / 100;
  }
  saveSettings(settings);
}

const note = (n: Note) => esc(t(n.key as TKey, Object.fromEntries(Object.entries(n.params ?? {}).map(([k, v]) => [k, String(v)]))));

const bars = (r: RobotReport) =>
  (['scoring', 'defense', 'passing', 'driving', 'climb'] as const)
    .map((k) => `<div class="dbar"><span>${t(`prof_${k}` as TKey)}</span><i><b style="width:${Math.round(r.profile[k] * 100)}%"></b></i></div>`)
    .join('');

function card(r: RobotReport, you: boolean): string {
  return `<div class="dcard ${you ? 'me' : ''}">
    <div class="dcard-h"><b>${r.team}</b> <span>${esc(r.name)}</span>${you ? ` <em>${t('dash_you')}</em>` : ''}<span class="grow"></span><small>${Math.round(r.fuel)} ${t('dash_fuelPer')}</small></div>
    <div class="dbars">${bars(r)}</div>
    <div class="dpc"><div class="pro">${r.pros.map((p) => `<div>＋ ${note(p)}</div>`).join('')}</div><div class="con">${r.cons.map((c) => `<div>－ ${note(c)}</div>`).join('')}</div></div>
  </div>`;
}

const DS_COLOR = ['#ff9f1c', '#2ec4b6', '#c77dff'];

/** Mapa de tu lado (marco azul): salidas arrastrables sobre la ROBOT STARTING LINE y rutas de AUTO. */
function drawAutoMap(c: HTMLCanvasElement, rows: PhaseRow[], routines: AutoRoutine[], starts: number[]): void {
  const X0 = -F.HALF_L - 0.2;
  const X1 = 0.5;
  const Z0 = -F.HALF_W - 0.15;
  const Z1 = F.HALF_W + 0.15;
  const w = Math.max(260, c.clientWidth || 420);
  c.width = Math.round(w * (window.devicePixelRatio || 1));
  c.height = Math.round(c.width * ((Z1 - Z0) / (X1 - X0)));
  const S = c.width / (X1 - X0);
  const g = c.getContext('2d')!;
  const px = (x: number, z: number): [number, number] => [(x - X0) * S, (z - Z0) * S];
  const rect = (x0: number, z0: number, x1: number, z1: number, fill: string) => {
    const [a, b] = px(Math.min(x0, x1), Math.min(z0, z1));
    g.fillStyle = fill;
    g.fillRect(a, b, Math.abs(x1 - x0) * S, Math.abs(z1 - z0) * S);
  };
  g.fillStyle = '#3c4048';
  g.fillRect(0, 0, c.width, c.height);
  rect(-F.HALF_L, -F.HALF_W, 0.5, F.HALF_W, '#5d6168');
  rect(-F.HALF_L, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, '#566070');
  rect(-0.03, -F.HALF_W, 0.03, F.HALF_W, '#f0f0f0');
  const hx = F.HUB_CENTER_X_BLUE;
  rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, '#d9dde2');
  for (const sgn of [-1, 1]) {
    rect(hx - F.BUMP_DEPTH / 2, (sgn * F.HUB_SIZE) / 2, hx + F.BUMP_DEPTH / 2, sgn * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), '#2c6cc4');
    rect(hx - F.TRENCH_DEPTH / 2, sgn * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, sgn * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), '#1b4f9c');
  }
  const tw = F.towerInfo('blue');
  rect(tw.cx, tw.cz - F.TOWER_BASE_WIDTH / 2, tw.cx + F.TOWER_BASE_DEPTH, tw.cz + F.TOWER_BASE_WIDTH / 2, '#22252b');
  const dp = F.depotCenter('blue');
  rect(dp.x - F.DEPOT_DEPTH / 2, dp.z - F.DEPOT_WIDTH / 2, dp.x + F.DEPOT_DEPTH / 2, dp.z + F.DEPOT_WIDTH / 2, '#c9a400');
  // línea de salida
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(1, S * 0.05);
  g.beginPath();
  g.moveTo(...px(F.STARTING_LINE_X_BLUE, -F.HALF_W));
  g.lineTo(...px(F.STARTING_LINE_X_BLUE, F.HALF_W));
  g.stroke();
  rows.forEach((r, i) => {
    const color = DS_COLOR[r.station - 1];
    const st = defaultStart('blue', r.station, 0.45);
    const z0 = starts[i];
    // ruta de AUTO (las rutinas "de cualquier lado" se reflejan como en el match)
    const rt = routines.find((x) => x.id === r.auto);
    if (rt?.waypoints.length) {
      const first = rt.waypoints.find((w) => Math.abs(w.z) > 0.3);
      const flip = !!rt.mirrorToStart && !!first && Math.sign(first.z) !== Math.sign(z0) && Math.abs(z0) > 0.3;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1.5, S * 0.05);
      g.setLineDash([S * 0.14, S * 0.1]);
      g.beginPath();
      g.moveTo(...px(st.x, z0));
      for (const w of rt.waypoints) g.lineTo(...px(w.x, flip ? -w.z : w.z));
      g.stroke();
      g.setLineDash([]);
    }
    // robot
    const [a, b] = px(st.x, z0);
    const h = 0.43 * S;
    g.fillStyle = color;
    g.fillRect(a - h, b - h, 2 * h, 2 * h);
    if (r.isPlayer) {
      g.strokeStyle = '#f5c518';
      g.lineWidth = Math.max(2, S * 0.08);
      g.strokeRect(a - h, b - h, 2 * h, 2 * h);
    }
    g.fillStyle = '#111';
    g.font = `bold ${Math.round(S * 0.28)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(r.station), a, b);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(S * 0.2)}px sans-serif`;
    g.fillText(r.isPlayer ? `${r.team} · ${t('dash_you').toUpperCase()}` : String(r.team), a, b - h - S * 0.18);
  });
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
}

export function renderDashboard(root: HTMLElement, tt: Tournament, m: TMatch, settings: Settings, on: { back: () => void; play: () => void; save: () => void }): void {
  const st = rowsForMatch(tt, m);
  const plan = st.plan;
  let rows = st.rows;
  let edited = st.edited;
  let dirty = false;
  let savedNow = false;
  const routines = loadRoutines();
  const me = myStation(tt, m);
  const p = Math.round(plan.winProb * 100);
  const event = tt.teams.map((_, i) => scoutTeam(tt, i));
  const all = event.map((r) => report(r, event));
  const theirTeams = plan.theirs.map((r) => r.team);
  const specOf = (team: number) => robotById(tt.teams.find((x) => x.team === team)!.specId);
  root.innerHTML = `<div class="inner dash">
    <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">${t('dash_title')}</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
    <h1>${m.id} · ${t('dash_title')}</h1>
    <div class="panel dash-top">
      <div class="dsbadge ${me.alliance}"><small>DS</small><b>${me.station}</b></div>
      <div><div class="dlabel">${t('dash_yourDs')}</div><div class="dsline">${t('dash_dsLine', { ds: me.station, a: t(me.alliance) })}</div></div>
      <div><div class="dlabel">${t('dash_prediction')}</div><div class="dpred"><span class="you">${plan.predicted.ours}</span> – <span>${plan.predicted.theirs}</span></div></div>
      <div class="grow"><div class="dlabel">${t('dash_win')} · ${p}%</div><div class="dwin"><i style="width:${p}%"></i></div></div>
      <div><div class="dlabel">${t('dash_auto')}</div><div><b>${t(plan.autoAdvice === 'win' ? 'dash_winAuto' : plan.autoAdvice === 'lose' ? 'dash_loseAuto' : 'dash_eitherAuto')}</b></div></div>
    </div>
    <div class="panel" data-strat></div>
    <div class="panel"><b>${t('dash_tips')}</b><ol class="dtips">${plan.tips.map((x) => `<li>${note(x)}</li>`).join('')}</ol></div>
    <div class="panel"><b>${t('dash_scout')}</b>
      <div class="dcols"><div><div class="dlabel">${t('dash_ours')}</div>${plan.ours.map((r) => card(r, tt.teams.find((x) => x.team === r.team)?.isPlayer ?? false)).join('')}</div>
      <div><div class="dlabel">${t('dash_theirs')}</div>${plan.theirs.map((r) => card(r, false)).join('')}</div></div>
    </div>
    <div class="panel"><b>${t('dash_allTeams')}</b>
      <table class="ranktable dall"><tr><th>${t('team')}</th><th>${t('dash_fuelPer')}</th><th>${t('dash_pros')}</th><th>${t('dash_cons')}</th></tr>
      ${[...all]
        .sort((a, b) => b.fuel - a.fuel)
        .map((r) => `<tr class="${tt.teams.find((x) => x.team === r.team)?.isPlayer ? 'me' : ''}"><td>${r.team} <span style="color:var(--muted)">${esc(r.name)}</span></td><td>${Math.round(r.fuel)}</td><td class="pro">${r.pros.map(note).join(' · ')}</td><td class="con">${r.cons.map(note).join(' · ')}</td></tr>`)
        .join('')}</table>
    </div>
  </div>`;
  root.querySelector('[data-back]')!.addEventListener('click', on.back);
  const box = root.querySelector<HTMLElement>('[data-strat]')!;

  const starts = () => separateStarts(rows.map((r) => ({ z: r.startZ ?? defaultStartZ(r.station), halfZ: 0.45 })));
  const teamCell = (r: PhaseRow) => `<td class="dsn"><i style="background:${DS_COLOR[r.station - 1]}">${r.station}</i></td><td>${r.team}${r.isPlayer ? ` <em class="you">${t('dash_you')}</em>` : ''}</td>`;
  const sel = (i: number, f: string, opts: Array<[string | number, string]>, cur: string | number | null, disabled = false) =>
    `<select data-row="${i}" data-f="${f}" ${disabled ? 'disabled' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const drawStrat = () => {
    const zs = starts();
    const conflicts = autoConflicts(rows, routines);
    const tower = planTowerPoints(rows);
    const th = plan.rp.th.traversal;
    const status = savedNow ? `<span class="tag ok">✓ ${t('dash_saved')}</span>` : dirty ? `<span class="tag warn">${t('dash_unsaved')}</span>` : `<span class="tag">${edited ? t('dash_edited') : t('dash_suggested')}</span>`;
    const ordered = [...rows].sort((a, b) => a.station - b.station);
    const idx = (r: PhaseRow) => rows.indexOf(r);
    // Una tabla por SHIFT, en el orden en que pasan si sale el AUTO que sugiere el estratega
    // (quien gana el AUTO empieza con su HUB inactivo en SHIFT 1)
    type Sec = { key: string; kind?: 'active' | 'inactive'; w: 0 | 1 };
    const shiftSecs: Sec[] =
      plan.autoAdvice === 'win'
        ? [{ key: 'i0', kind: 'inactive', w: 0 }, { key: 'a0', kind: 'active', w: 0 }, { key: 'i1', kind: 'inactive', w: 1 }, { key: 'a1', kind: 'active', w: 1 }]
        : [{ key: 'a0', kind: 'active', w: 0 }, { key: 'i0', kind: 'inactive', w: 0 }, { key: 'a1', kind: 'active', w: 1 }, { key: 'i1', kind: 'inactive', w: 1 }];
    const sections: Sec[] = [{ key: 'auto', w: 0 }, ...shiftSecs, { key: 'endgame', w: 1 }];
    box.innerHTML = `
      <div class="row strat-head"><b>${t('dash_strategy')}</b>${status}<span class="grow"></span>
        <button class="btn primary" data-save>✓ ${t('dash_save')}</button>
        <button class="btn" data-reset ${edited || dirty ? '' : 'disabled'}>↺ ${t('dash_reset')}</button>
        <button class="btn" data-play>▶ ${t('play')} ${m.id}</button></div>
      <nav class="strat-nav">${sections.map((x, k) => `<button class="chipbtn" data-goto="${x.key}"><b>${k + 1}</b> ${t(`phase_${x.key}` as TKey)}</button>`).join('')}</nav>
      <div class="dlabel" style="margin-top:4px">${t('dash_summary')}</div>
      <table class="ranktable psum"><tr><th>DS</th><th>${t('team')}</th>${sections.map((x, k) => `<th>${k + 1} · ${t(`phase_${x.key}` as TKey)}</th>`).join('')}</tr>
      ${ordered
        .map(
          (r) =>
            `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}${sections
              .map((x) => {
                if (x.key === 'auto') return `<td>${esc(routines.find((y) => y.id === r.auto)?.name ?? r.auto)}${r.startZ === null ? '' : ` · z ${zs[idx(r)].toFixed(2)} m`}</td>`;
                if (x.key === 'endgame') return `<td>${r.climb ? `L${r.climb}` : t('eg_none')}</td>`;
                const sp = r.windows[x.w];
                if (x.kind === 'active') return `<td>${t(`act_${sp.active}` as TKey)}</td>`;
                return `<td>${t(`inact_${sp.inactive}` as TKey)}${sp.inactive === 'defend' ? ` → ${sp.defendTeam ?? t('dash_threat')}` : ''}</td>`;
              })
              .join('')}</tr>`,
        )
        .join('')}</table>
      <div class="phase-grid">
        <section class="phase ph-auto" data-phase="auto"><h3><span class="pn">1</span>${t('phase_auto')} <small>0:20</small></h3>
          <div class="auto-body"><div class="automap"><canvas></canvas><div class="msg">${t('dash_dragHint')}</div></div>
          <table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_start')}</th><th>${t('dash_routine')}</th></tr>
          ${ordered
            .map((r) => {
              const i = idx(r);
              const c = conflicts.get(r.station);
              const start = r.startZ === null ? t('dash_startDefault', { ds: r.station }) : `${t('dash_startCustom', { z: zs[i].toFixed(2) })} <button class="chipbtn tiny" data-resetstart="${i}" title="${t('dash_startReset')}">↺</button>`;
              return `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}<td>${start}</td><td>${sel(i, 'auto', routines.map((x) => [x.id, x.name]), r.auto)}${c ? `<div class="pwarn">${t('dash_conflict', { list: c.join(', ') })}</div>` : ''}</td></tr>`;
            })
            .join('')}</table></div>
        </section>
        ${sections
          .filter((x) => x.kind)
          .map((x) => {
            const k = sections.indexOf(x) + 1;
            const head = `<section class="phase ph-${x.kind}" data-phase="${x.key}"><h3><span class="pn">${k}</span>${t(`phase_${x.key}` as TKey)} <small>${t(`when_${x.key}` as TKey)}</small></h3>
              <table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_task')}</th></tr>`;
            const body = ordered
              .map((r) => {
                const sp = r.windows[x.w];
                if (x.kind === 'active')
                  return `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}<td>${sel(idx(r), `active:${x.w}`, ACTIVE_TASKS.map((y) => [y, t(`act_${y}` as TKey)]), sp.active)}<div class="pnote">${t(`note_act_${sp.active}` as TKey)}</div></td></tr>`;
                return `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}<td>${sel(idx(r), `inactive:${x.w}`, INACTIVE_TASKS.map((y) => [y, t(`inact_${y}` as TKey)]), sp.inactive)}${
                  // a quién marca: solo si defiende
                  sp.inactive === 'defend' ? `<div class="pmark"><span>${t('dash_marks2')}</span>${sel(idx(r), `defend:${x.w}`, [['', t('dash_threat')], ...theirTeams.map((y): [number, string] => [y, String(y)])], sp.defendTeam ?? '')}</div>` : ''
                }<div class="pnote">${t(`note_inact_${sp.inactive}` as TKey)}</div></td></tr>`;
              })
              .join('');
            return `${head}${body}</table></section>`;
          })
          .join('')}
        <section class="phase ph-endgame" data-phase="endgame"><h3><span class="pn">6</span>${t('phase_endgame')} <small>0:30</small></h3>
          <table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_tower')}</th></tr>
          ${ordered
            .map((r) => {
              const spec = specOf(r.team);
              const opts: Array<[number, string]> = [[0, t('eg_none')]];
              for (let l = 1; l <= r.maxClimb; l++) opts.push([l, t('eg_level', { l, p: [0, 10, 20, 30][l] })]);
              const secs = r.climb ? [0, spec.climb.timeL1, spec.climb.timeL2, spec.climb.timeL3][r.climb] : 0;
              const noteTxt = r.maxClimb === 0 ? t('con_noClimb') : r.climb ? t('dash_climbTime', { s: secs }) : '';
              return `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}<td>${sel(idx(r), 'climb', opts, r.climb, r.maxClimb === 0)}${noteTxt ? `<div class="pnote">${noteTxt}</div>` : ''}</td></tr>`;
            })
            .join('')}</table>
          <div class="ptotal ${tower >= th ? 'ok' : ''}">${t('dash_towerTotal', { pts: tower, th })} ${tower >= th ? '✓ TRAVERSAL' : ''}</div>
        </section>
      </div>`;
    const canvas = box.querySelector('canvas')!;
    requestAnimationFrame(() => drawAutoMap(canvas, ordered, routines, ordered.map((r) => zs[idx(r)])));
    // arrastrar salidas en el mapa (en z, sobre la línea de salida)
    let drag = -1;
    const fieldZ = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const Z0 = -F.HALF_W - 0.15;
      const Z1 = F.HALF_W + 0.15;
      return Math.max(-F.HALF_W + 0.45, Math.min(F.HALF_W - 0.45, Z0 + ((e.clientY - b.top) / b.height) * (Z1 - Z0)));
    };
    canvas.addEventListener('pointerdown', (e) => {
      const z = fieldZ(e);
      const cur = starts();
      let best = -1;
      let bd = 0.8;
      rows.forEach((_, i) => {
        if (Math.abs(cur[i] - z) < bd) {
          bd = Math.abs(cur[i] - z);
          best = i;
        }
      });
      if (best < 0) return;
      drag = best;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      rows[drag].startZ = Math.round(fieldZ(e) * 100) / 100;
      const zs2 = starts();
      drawAutoMap(canvas, ordered, routines, ordered.map((r) => zs2[idx(r)]));
    });
    const up = () => {
      if (drag < 0) return;
      drag = -1;
      dirty = true;
      savedNow = false;
      drawStrat();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    box.querySelectorAll<HTMLSelectElement>('select[data-row]').forEach((el) =>
      el.addEventListener('change', () => {
        const r = rows[Number(el.dataset.row)];
        const v = el.value;
        const f = el.dataset.f;
        if (f === 'auto') r.auto = v;
        // tareas por SHIFT: "active:0", "inactive:1", "defend:0"…
        const [kind, wi] = (f ?? '').split(':');
        const sp = wi !== undefined ? r.windows[Number(wi) as 0 | 1] : null;
        if (sp && kind === 'active') sp.active = v as typeof sp.active;
        if (sp && kind === 'inactive') sp.inactive = v as typeof sp.inactive;
        if (sp && kind === 'defend') sp.defendTeam = v ? Number(v) : null;
        if (f === 'climb') r.climb = Number(v) as PhaseRow['climb'];
        dirty = true;
        savedNow = false;
        drawStrat();
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-goto]').forEach((el) =>
      el.addEventListener('click', () => box.querySelector(`[data-phase="${el.dataset.goto}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    );
    box.querySelectorAll<HTMLElement>('[data-resetstart]').forEach((el) =>
      el.addEventListener('click', () => {
        rows[Number(el.dataset.resetstart)].startZ = null;
        dirty = true;
        savedNow = false;
        drawStrat();
      }),
    );
    box.querySelector('[data-play]')!.addEventListener('click', () => {
      if (dirty) save();
      on.play();
    });
    box.querySelector('[data-save]')!.addEventListener('click', () => {
      save();
      drawStrat();
    });
    box.querySelector('[data-reset]')!.addEventListener('click', () => {
      rows = structuredClone(st.suggested);
      if (tt.matchPlans) delete tt.matchPlans[m.id];
      edited = false;
      dirty = false;
      savedNow = false;
      applyRows(rows, settings, `${t('dash_title')} ${m.id}`);
      on.save();
      drawStrat();
    });
  };
  const save = () => {
    (tt.matchPlans ??= {})[m.id] = structuredClone(rows);
    applyRows(rows, settings, `${t('dash_title')} ${m.id}`);
    on.save();
    edited = true;
    dirty = false;
    savedNow = true;
  };
  drawStrat();
}
