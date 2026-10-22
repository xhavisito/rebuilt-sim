/**
 * Dashboard de estrategia del torneo (lo que haría el estratega de un equipo finalista): para tu
 * próximo match muestra tu DRIVER STATION, la predicción, la ESTRATEGIA DEL MATCH en cuatro
 * tablas editables (AUTO con mapa de salidas y rutas, SHIFT activo, SHIFT inactivo y END GAME),
 * que arranca con la sugerencia del drive coach, los consejos y el scouting de los 6 robots
 * (pros, contras y datos del evento). Al guardar, tus compañeros de la IA siguen el plan y el
 * drive coach lo recuerda en el match. Debajo, el scouting de todos los equipos del evento.
 */
import { autoConflicts, defaultStartZ, normalizeRow, planTowerPoints, rowsToPlans, suggestedPaths, suggestedRows, type PhaseRow } from '../ai/PhasePlan';
import { planMatch, report, type MatchPlan, type Note, type RobotReport, type ScoutRobot } from '../ai/Strategist';
import { ACTIVE_TASKS, INACTIVE_TASKS, loadStrategies, saveCustomStrategies, type PathPhase, type Pt, type Strategy } from '../ai/Strategy';
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
  const saved = (tt.matchPlans?.[m.id] as Array<Partial<PhaseRow>> | undefined)?.map(normalizeRow);
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

/** Pestañas del mapa: el AUTO y las fases con ruta propia. */
type Tab = 'auto' | PathPhase;
const TABS: Tab[] = ['auto', 'active', 'inactive', 'endgame'];

/** Encuadre del mapa (marco azul) para pasar de píxeles a metros. */
interface View {
  X0: number;
  Z0: number;
  S: number;
}

/** ¿El punto de la fase es de tiro (anota) o de pase (alimenta / acapara)? null = no tiene. */
function spotKind(r: PhaseRow, tab: PathPhase): 'shoot' | 'pass' | null {
  if (tab === 'endgame') return 'shoot';
  if (tab === 'active') return r.active === 'feed' ? 'pass' : 'shoot';
  return r.inactive === 'defend' ? null : 'pass';
}

/**
 * Mapa del plan (marco azul, DS 1 arriba). En AUTO: tu lado, con las salidas arrastrables sobre
 * la ROBOT STARTING LINE y las rutas de AUTO. En las demás fases: hasta el HUB rival, con la ruta
 * de recolección y el punto de tiro o de pase de cada robot (el elegido, resaltado), a quién marca
 * el que defiende y a qué nivel de TOWER va cada uno en END GAME.
 */
function drawPlanMap(c: HTMLCanvasElement, tab: Tab, rows: PhaseRow[], routines: AutoRoutine[], starts: number[], selDs: number): View {
  const X0 = -F.HALF_L - 0.2;
  const X1 = tab === 'auto' ? 0.5 : -F.HUB_CENTER_X_BLUE + F.HUB_SIZE / 2 + 0.4;
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
  rect(-F.HALF_L, -F.HALF_W, X1 - 0.2, F.HALF_W, '#5d6168');
  rect(-F.HALF_L, -F.HALF_W, F.STARTING_LINE_X_BLUE, F.HALF_W, '#566070');
  rect(-0.03, -F.HALF_W, 0.03, F.HALF_W, '#f0f0f0');
  // HUBS (el rival solo fuera del AUTO), BUMPS, TRENCHES, TOWER y DEPOT
  for (const [sx, col, dark] of (tab === 'auto' ? [[1, '#2c6cc4', '#1b4f9c']] : [[1, '#2c6cc4', '#1b4f9c'], [-1, '#c43c3c', '#8f2a2a']]) as Array<[number, string, string]>) {
    const hx = sx * F.HUB_CENTER_X_BLUE;
    rect(hx - F.HUB_SIZE / 2, -F.HUB_SIZE / 2, hx + F.HUB_SIZE / 2, F.HUB_SIZE / 2, sx > 0 ? '#d9dde2' : '#e3c9c9');
    for (const sgn of [-1, 1]) {
      rect(hx - F.BUMP_DEPTH / 2, (sgn * F.HUB_SIZE) / 2, hx + F.BUMP_DEPTH / 2, sgn * (F.HUB_SIZE / 2 + F.BUMP_WIDTH), col);
      rect(hx - F.TRENCH_DEPTH / 2, sgn * F.TRENCH_INNER_Z, hx + F.TRENCH_DEPTH / 2, sgn * (F.HALF_W - F.TRENCH_CLEAR_WIDTH), dark);
    }
  }
  const tw = F.towerInfo('blue');
  rect(tw.cx, tw.cz - F.TOWER_BASE_WIDTH / 2, tw.cx + F.TOWER_BASE_DEPTH, tw.cz + F.TOWER_BASE_WIDTH / 2, '#22252b');
  const dp = F.depotCenter('blue');
  rect(dp.x - F.DEPOT_DEPTH / 2, dp.z - F.DEPOT_WIDTH / 2, dp.x + F.DEPOT_DEPTH / 2, dp.z + F.DEPOT_WIDTH / 2, '#c9a400');
  // línea de salida
  g.strokeStyle = tab === 'auto' ? '#fff' : 'rgba(255,255,255,.35)';
  g.lineWidth = Math.max(1, S * 0.05);
  g.beginPath();
  g.moveTo(...px(F.STARTING_LINE_X_BLUE, -F.HALF_W));
  g.lineTo(...px(F.STARTING_LINE_X_BLUE, F.HALF_W));
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = (s: string, x: number, z: number, size: number, color = '#fff') => {
    g.font = `bold ${Math.round(S * size)}px sans-serif`;
    g.fillStyle = color;
    g.fillText(s, ...px(x, z));
  };
  if (tab !== 'auto') {
    text('NEUTRAL ZONE', -1.0, -F.HALF_W + 0.3, 0.2, 'rgba(255,255,255,.6)');
    text('HUB', F.HUB_CENTER_X_BLUE, 0, 0.2, '#222');
  }
  const robot = (r: PhaseRow, x: number, z: number, alpha: number) => {
    const [a, b] = px(x, z);
    const h = 0.43 * S;
    g.globalAlpha = alpha;
    g.fillStyle = DS_COLOR[r.station - 1];
    g.fillRect(a - h, b - h, 2 * h, 2 * h);
    if (r.isPlayer) {
      g.strokeStyle = '#f5c518';
      g.lineWidth = Math.max(2, S * 0.08);
      g.strokeRect(a - h, b - h, 2 * h, 2 * h);
    }
    text(String(r.station), x, z, 0.28, '#111');
    text(r.isPlayer ? `${r.team} · ${t('dash_you').toUpperCase()}` : String(r.team), x, z - 0.43 - 0.18, 0.2);
    g.globalAlpha = 1;
  };
  rows.forEach((r, i) => {
    const color = DS_COLOR[r.station - 1];
    const st = defaultStart('blue', r.station, 0.45);
    const z0 = starts[i];
    if (tab === 'auto') {
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
      robot(r, st.x, z0, 1);
      return;
    }
    const on = r.station === selDs;
    const path = r.paths[tab];
    const kind = spotKind(r, tab);
    g.globalAlpha = on ? 1 : 0.55;
    // ruta de recolección: línea con sus puntos numerados
    if (path.route.length) {
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, S * (on ? 0.07 : 0.045));
      g.beginPath();
      path.route.forEach((q, k) => (k ? g.lineTo(...px(q.x, q.z)) : g.moveTo(...px(q.x, q.z))));
      g.stroke();
      path.route.forEach((q, k) => {
        const [a, b] = px(q.x, q.z);
        g.fillStyle = color;
        g.beginPath();
        g.arc(a, b, S * (on ? 0.16 : 0.11), 0, Math.PI * 2);
        g.fill();
        if (on) text(String(k + 1), q.x, q.z, 0.17, '#111');
      });
    }
    // punto de tiro (mira) o de pase (rombo), unido al final de la ruta
    if (path.spot && kind) {
      const [a, b] = px(path.spot.x, path.spot.z);
      const last = path.route[path.route.length - 1];
      if (last) {
        g.strokeStyle = color;
        g.lineWidth = Math.max(1, S * 0.03);
        g.setLineDash([S * 0.08, S * 0.08]);
        g.beginPath();
        g.moveTo(...px(last.x, last.z));
        g.lineTo(a, b);
        g.stroke();
        g.setLineDash([]);
      }
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = Math.max(2, S * 0.05);
      g.beginPath();
      if (kind === 'shoot') {
        g.arc(a, b, S * 0.22, 0, Math.PI * 2);
        g.moveTo(a - S * 0.32, b);
        g.lineTo(a + S * 0.32, b);
        g.moveTo(a, b - S * 0.32);
        g.lineTo(a, b + S * 0.32);
        g.stroke();
      } else {
        g.moveTo(a, b - S * 0.25);
        g.lineTo(a + S * 0.25, b);
        g.lineTo(a, b + S * 0.25);
        g.lineTo(a - S * 0.25, b);
        g.closePath();
        g.fill();
      }
      text(`${r.station}`, path.spot.x, path.spot.z - 0.42, 0.18, color);
    }
    // el que defiende: flecha hacia la zona rival, con su marca
    if (tab === 'inactive' && r.inactive === 'defend') {
      const z = [-1.6, 0, 1.6][r.station - 1];
      const from = px(F.HUB_CENTER_X_BLUE + 1.2, z);
      const to = px(X1 - 0.5, z);
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, S * 0.06);
      g.setLineDash([S * 0.15, S * 0.1]);
      g.beginPath();
      g.moveTo(...from);
      g.lineTo(...to);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(to[0], to[1]);
      g.lineTo(to[0] - S * 0.3, to[1] - S * 0.2);
      g.lineTo(to[0] - S * 0.3, to[1] + S * 0.2);
      g.closePath();
      g.fill();
      text(t('dash_mapDefend', { team: r.defendTeam ?? t('dash_threat') }), (F.HUB_CENTER_X_BLUE + X1) / 2, z - 0.3, 0.19, color);
    }
    // END GAME: a la TOWER (y a qué nivel)
    if (tab === 'endgame' && r.climb) {
      const tz = tw.cz + (r.station - 2) * 0.25;
      const from = path.spot ?? path.route[path.route.length - 1] ?? { x: st.x, z: z0 };
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, S * 0.05);
      g.setLineDash([S * 0.15, S * 0.1]);
      g.beginPath();
      g.moveTo(...px(from.x, from.z));
      g.lineTo(...px(tw.uprightX + 0.35, tz));
      g.stroke();
      g.setLineDash([]);
      text(`L${r.climb}`, tw.uprightX + 0.65, tz, 0.22, color);
    }
    g.globalAlpha = 1;
  });
  g.textAlign = 'start';
  g.textBaseline = 'alphabetic';
  return { X0, Z0, S };
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

  // Pestaña del mapa, DS que se edita en él y herramienta (ruta o punto)
  let tab: Tab = 'auto';
  let selDs: number = me.station;
  let tool: 'route' | 'spot' = 'route';
  const touch = () => {
    dirty = true;
    savedNow = false;
  };

  const drawStrat = () => {
    const zs = starts();
    const conflicts = autoConflicts(rows, routines);
    const tower = planTowerPoints(rows);
    const th = plan.rp.th.traversal;
    const status = savedNow ? `<span class="tag ok">✓ ${t('dash_saved')}</span>` : dirty ? `<span class="tag warn">${t('dash_unsaved')}</span>` : `<span class="tag">${edited ? t('dash_edited') : t('dash_suggested')}</span>`;
    const ordered = [...rows].sort((a, b) => a.station - b.station);
    const idx = (r: PhaseRow) => rows.indexOf(r);
    const k = TABS.indexOf(tab) + 1;
    const selRow = ordered.find((r) => r.station === selDs) ?? ordered[0];
    const selKind = tab === 'auto' ? null : spotKind(selRow, tab);
    const trow = (r: PhaseRow, cells: string) => `<tr class="${r.isPlayer ? 'me' : ''} ${tab !== 'auto' && r.station === selDs ? 'sel' : ''}" data-ds="${r.station}">${teamCell(r)}${cells}</tr>`;
    // lo que dice el mapa de cada robot en esta fase (ruta y punto)
    const pathCell = (r: PhaseRow, ph: PathPhase) => {
      const p = r.paths[ph];
      const kind = spotKind(r, ph);
      if (!kind) return `<td class="pmap">${t('dash_mapNoRoute')}</td>`;
      return `<td class="pmap">${t('dash_mapPts', { n: p.route.length })}${p.spot ? ` · ${t(kind === 'shoot' ? 'dash_spotShoot' : 'dash_spotPass')}` : ''}</td>`;
    };
    let table = '';
    if (tab === 'auto')
      table = `<table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_start')}</th><th>${t('dash_routine')}</th></tr>
          ${ordered
            .map((r) => {
              const i = idx(r);
              const c = conflicts.get(r.station);
              const start = r.startZ === null ? t('dash_startDefault', { ds: r.station }) : `${t('dash_startCustom', { z: zs[i].toFixed(2) })} <button class="chipbtn tiny" data-resetstart="${i}" title="${t('dash_startReset')}">↺</button>`;
              return trow(r, `<td>${start}</td><td>${sel(i, 'auto', routines.map((x) => [x.id, x.name]), r.auto)}${c ? `<div class="pwarn">${t('dash_conflict', { list: c.join(', ') })}</div>` : ''}</td>`);
            })
            .join('')}</table>`;
    if (tab === 'active')
      table = `<table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_task')}</th><th class="pmap">${t('dash_mapCol')}</th></tr>
          ${ordered.map((r) => trow(r, `<td>${sel(idx(r), 'active', ACTIVE_TASKS.map((x) => [x, t(`act_${x}` as TKey)]), r.active)}<div class="pnote">${t(`note_act_${r.active}` as TKey)}</div></td>${pathCell(r, 'active')}`)).join('')}</table>`;
    if (tab === 'inactive')
      table = `<table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_task')}</th><th class="pmap">${t('dash_mapCol')}</th></tr>
          ${ordered
            .map((r) =>
              trow(
                r,
                `<td>${sel(idx(r), 'inactive', INACTIVE_TASKS.map((x) => [x, t(`inact_${x}` as TKey)]), r.inactive)}${
                  // a quién marca: solo si defiende
                  r.inactive === 'defend' ? `<div class="pmark"><span>${t('dash_marks2')}</span>${sel(idx(r), 'defendTeam', [['', t('dash_threat')], ...theirTeams.map((x): [number, string] => [x, String(x)])], r.defendTeam ?? '')}</div>` : ''
                }<div class="pnote">${t(`note_inact_${r.inactive}` as TKey)}</div></td>${pathCell(r, 'inactive')}`,
              ),
            )
            .join('')}</table>`;
    if (tab === 'endgame')
      table = `<div><table class="ranktable ptable"><tr><th>DS</th><th>${t('team')}</th><th>${t('dash_tower')}</th><th class="pmap">${t('dash_mapCol')}</th></tr>
          ${ordered
            .map((r) => {
              const spec = specOf(r.team);
              const opts: Array<[number, string]> = [[0, t('eg_none')]];
              for (let l = 1; l <= r.maxClimb; l++) opts.push([l, t('eg_level', { l, p: [0, 10, 20, 30][l] })]);
              const secs = r.climb ? [0, spec.climb.timeL1, spec.climb.timeL2, spec.climb.timeL3][r.climb] : 0;
              const noteTxt = r.maxClimb === 0 ? t('con_noClimb') : r.climb ? t('dash_climbTime', { s: secs }) : '';
              return trow(r, `<td>${sel(idx(r), 'climb', opts, r.climb, r.maxClimb === 0)}${noteTxt ? `<div class="pnote">${noteTxt}</div>` : ''}</td>${pathCell(r, 'endgame')}`);
            })
            .join('')}</table>
          <div class="ptotal ${tower >= th ? 'ok' : ''}">${t('dash_towerTotal', { pts: tower, th })} ${tower >= th ? '✓ TRAVERSAL' : ''}</div></div>`;
    const tools =
      tab === 'auto'
        ? ''
        : `<div class="maptools">
            <span class="dlabel">${t('dash_editDs')}</span>${ordered.map((r) => `<button class="chipbtn dsb ${r.station === selDs ? 'on' : ''}" data-selds="${r.station}" style="--c:${DS_COLOR[r.station - 1]}">${r.station}${r.isPlayer ? ` ${t('dash_you')}` : ''}</button>`).join('')}
            <span class="sep"></span>
            <button class="chipbtn ${tool === 'route' ? 'on' : ''}" data-tool="route">✎ ${t('dash_toolRoute')}</button>
            <button class="chipbtn ${tool === 'spot' ? 'on' : ''}" data-tool="spot" ${selKind ? '' : 'disabled'}>${selKind === 'pass' ? '◆' : '⊕'} ${t(selKind === 'pass' ? 'dash_spotPass' : 'dash_spotShoot')}</button>
            <span class="sep"></span>
            <button class="chipbtn" data-undo>↶ ${t('dash_undoPt')}</button>
            <button class="chipbtn" data-clear>${t('dash_clearRoute')}</button>
            <button class="chipbtn" data-sugg>↺ ${t('dash_pathReset')}</button>
          </div>`;
    const hint = tab === 'auto' ? t('dash_dragHint') : selKind ? t('dash_mapHint') : t('dash_mapHintDefend', { ds: selDs });
    box.innerHTML = `
      <div class="row strat-head"><b>${t('dash_strategy')}</b>${status}<span class="grow"></span>
        <button class="btn primary" data-save>✓ ${t('dash_save')}</button>
        <button class="btn" data-reset ${edited || dirty ? '' : 'disabled'}>↺ ${t('dash_reset')}</button>
        <button class="btn" data-play>▶ ${t('play')} ${m.id}</button></div>
      <nav class="strat-nav">${TABS.map((ph, n) => `<button class="chipbtn ${ph === tab ? 'on' : ''}" data-tab="${ph}"><b>${n + 1}</b> ${t(`phase_${ph}_short` as TKey)}</button>`).join('')}</nav>
      <div class="dlabel" style="margin-top:4px">${t('dash_summary')}</div>
      <table class="ranktable psum"><tr><th>DS</th><th>${t('team')}</th>${TABS.map((ph, n) => `<th class="${ph === tab ? 'on' : ''}">${n + 1} · ${t(`phase_${ph}_short` as TKey)}</th>`).join('')}</tr>
      ${ordered
        .map(
          (r) =>
            `<tr class="${r.isPlayer ? 'me' : ''}">${teamCell(r)}<td>${esc(routines.find((x) => x.id === r.auto)?.name ?? r.auto)}${r.startZ === null ? '' : ` · z ${zs[idx(r)].toFixed(2)} m`}</td><td>${t(`act_${r.active}` as TKey)}</td><td>${t(`inact_${r.inactive}` as TKey)}${r.inactive === 'defend' ? ` → ${r.defendTeam ?? t('dash_threat')}` : ''}</td><td>${r.climb ? `L${r.climb}` : t('eg_none')}</td></tr>`,
        )
        .join('')}</table>
      <div class="phase-grid">
        <section class="phase ph-${tab}" data-phase="map"><h3><span class="pn">${k}</span>${t(`phase_${tab}` as TKey)} <small>${t(`dash_when_${tab}` as TKey)}</small></h3>
          <div class="phase-tabs">${TABS.map((ph, n) => `<button class="chipbtn ${ph === tab ? 'on' : ''}" data-tab="${ph}"><b>${n + 1}</b> ${t(`phase_${ph}_short` as TKey)}</button>`).join('')}</div>
          <div class="auto-body"><div class="automap ${tab === 'auto' ? '' : 'draw'}"><canvas></canvas>${tools}<div class="msg">${hint}</div></div>
          ${table}</div>
        </section>
      </div>`;
    const canvas = box.querySelector('canvas')!;
    let view: View = { X0: 0, Z0: 0, S: 1 };
    const redraw = () => {
      const zs2 = starts();
      view = drawPlanMap(canvas, tab, ordered, routines, ordered.map((r) => zs2[idx(r)]), selDs);
    };
    requestAnimationFrame(redraw);
    const field = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const x = (((e.clientX - b.left) / b.width) * canvas.width) / view.S + view.X0;
      const z = (((e.clientY - b.top) / b.height) * canvas.height) / view.S + view.Z0;
      return { x: Math.max(-F.HALF_L + 0.45, Math.min(F.HALF_L - 0.45, x)), z: Math.max(-F.HALF_W + 0.45, Math.min(F.HALF_W - 0.45, z)) };
    };
    const round = (p: Pt): Pt => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
    // AUTO: arrastrar salidas (en z, sobre la línea de salida). Fases: dibujar y mover rutas y puntos
    let drag: { row: PhaseRow; k: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      const p = field(e);
      if (tab === 'auto') {
        const cur = starts();
        let best = -1;
        let bd = 0.8;
        rows.forEach((_, i) => {
          if (Math.abs(cur[i] - p.z) < bd) {
            bd = Math.abs(cur[i] - p.z);
            best = i;
          }
        });
        if (best < 0) return;
        drag = { row: rows[best], k: 0 };
      } else {
        const ph = tab;
        // ¿tocó un punto (o el punto de tiro / pase) de algún robot? primero los del elegido
        const cands = [...ordered].sort((a, b) => (a.station === selDs ? -1 : b.station === selDs ? 1 : 0));
        let hit: { row: PhaseRow; k: number } | null = null;
        for (const r of cands) {
          const path = r.paths[ph];
          if (path.spot && spotKind(r, ph) && Math.hypot(path.spot.x - p.x, path.spot.z - p.z) < 0.4) hit = { row: r, k: -1 };
          const j = path.route.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.35);
          if (!hit && j >= 0) hit = { row: r, k: j };
          if (hit) break;
        }
        if (hit) {
          selDs = hit.row.station;
          drag = hit;
        } else {
          const r = ordered.find((x) => x.station === selDs)!;
          const path = r.paths[ph];
          if (tool === 'spot' && spotKind(r, ph)) {
            path.spot = round(p);
            drag = { row: r, k: -1 };
          } else if (spotKind(r, ph) && path.route.length < 10) {
            path.route.push(round(p));
            drag = { row: r, k: path.route.length - 1 };
          } else return;
        }
      }
      canvas.setPointerCapture(e.pointerId);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = round(field(e));
      if (tab === 'auto') drag.row.startZ = p.z;
      else if (drag.k < 0) drag.row.paths[tab].spot = p;
      else drag.row.paths[tab].route[drag.k] = p;
      redraw();
    });
    const up = () => {
      if (!drag) return;
      drag = null;
      touch();
      drawStrat();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // herramientas del mapa
    const selPath = () => (tab === 'auto' ? null : ordered.find((x) => x.station === selDs)!.paths[tab]);
    box.querySelectorAll<HTMLElement>('[data-selds]').forEach((el) =>
      el.addEventListener('click', () => {
        selDs = Number(el.dataset.selds);
        drawStrat();
      }),
    );
    box.querySelectorAll<HTMLElement>('tr[data-ds]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (tab === 'auto' || (e.target as HTMLElement).closest('select,button')) return;
        selDs = Number(el.dataset.ds);
        drawStrat();
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-tool]').forEach((el) =>
      el.addEventListener('click', () => {
        tool = el.dataset.tool as typeof tool;
        drawStrat();
      }),
    );
    box.querySelector('[data-undo]')?.addEventListener('click', () => {
      selPath()?.route.pop();
      touch();
      drawStrat();
    });
    box.querySelector('[data-clear]')?.addEventListener('click', () => {
      const p = selPath();
      if (p) p.route = [];
      touch();
      drawStrat();
    });
    box.querySelector('[data-sugg]')?.addEventListener('click', () => {
      if (tab === 'auto') return;
      const r = ordered.find((x) => x.station === selDs)!;
      r.paths[tab] = suggestedPaths(r.station, r.active, r.inactive)[tab];
      touch();
      drawStrat();
    });
    box.querySelectorAll<HTMLSelectElement>('select[data-row]').forEach((el) =>
      el.addEventListener('change', () => {
        const r = rows[Number(el.dataset.row)];
        const v = el.value;
        const f = el.dataset.f;
        if (f === 'auto') r.auto = v;
        // otra tarea: la ruta de esa fase vuelve a la sugerida para la tarea nueva
        if (f === 'active') {
          r.active = v as PhaseRow['active'];
          r.paths.active = suggestedPaths(r.station, r.active, r.inactive).active;
        }
        if (f === 'inactive') {
          r.inactive = v as PhaseRow['inactive'];
          r.paths.inactive = suggestedPaths(r.station, r.active, r.inactive).inactive;
        }
        if (f === 'defendTeam') r.defendTeam = v ? Number(v) : null;
        if (f === 'climb') r.climb = Number(v) as PhaseRow['climb'];
        if (tab !== 'auto') selDs = r.station;
        touch();
        drawStrat();
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => {
        const fromNav = !!el.closest('.strat-nav');
        tab = el.dataset.tab as Tab;
        drawStrat();
        if (fromNav) box.querySelector('[data-phase="map"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
    box.querySelectorAll<HTMLElement>('[data-resetstart]').forEach((el) =>
      el.addEventListener('click', () => {
        rows[Number(el.dataset.resetstart)].startZ = null;
        touch();
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
