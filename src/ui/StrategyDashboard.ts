/**
 * Dashboard de estrategia del torneo (lo que haría el estratega de un equipo finalista): para tu
 * próximo match muestra la predicción, el scouting de los 6 robots (pros, contras y datos del
 * evento), las órdenes por robot (rol, a quién marcar, AUTO, END GAME) y los consejos; con un
 * botón se aplica el plan (tus compañeros de la IA lo siguen y el drive coach lo recuerda).
 * Debajo, el scouting de todos los equipos del evento.
 */
import { planMatch, report, type MatchPlan, type Note, type RobotReport, type ScoutRobot } from '../ai/Strategist';
import { plan as mkPlan, loadStrategies, saveCustomStrategies, type Strategy } from '../ai/Strategy';
import { profileFromSpec } from '../ai/Scouting';
import { loadRoutines } from '../auto/AutoRoutine';
import { robotById } from '../config/robots';
import { saveSettings, type Settings } from '../config/settings';
import { teamAverages, type TMatch, type Tournament } from '../core/tournament';
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

/** Aplica el plan: estrategia de tu alianza (roles, marcas, AUTO, climb) y tu rutina de AUTO. */
export function applyPlan(plan: MatchPlan, settings: Settings, label: string): void {
  const strat: Strategy = {
    id: COACH_PLAN_ID,
    name: label,
    plans: plan.orders.map((o) => mkPlan({ role: o.role, climb: o.climb, auto: o.auto, defendTeam: o.defendTeam })) as Strategy['plans'],
  };
  const list = loadStrategies().filter((s) => !s.builtin && s.id !== COACH_PLAN_ID);
  saveCustomStrategies([...list, strat]);
  settings.match.strategy = COACH_PLAN_ID;
  const mine = plan.orders.find((o) => o.isPlayer);
  if (mine) settings.match.autoRoutine = mine.auto;
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

export function renderDashboard(root: HTMLElement, tt: Tournament, m: TMatch, settings: Settings, on: { back: () => void; play: () => void }): void {
  const { plan } = planForMatch(tt, m);
  const routines = loadRoutines();
  const rname = (id: string) => routines.find((r) => r.id === id)?.name ?? id;
  const p = Math.round(plan.winProb * 100);
  const applied = settings.match.strategy === COACH_PLAN_ID;
  const event = tt.teams.map((_, i) => scoutTeam(tt, i));
  const all = event.map((r) => report(r, event));
  const roleLabel = (r: string) => t(`role_${r}` as TKey);
  root.innerHTML = `<div class="inner dash">
    <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">${t('dash_title')}</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
    <h1>${m.id} · ${t('dash_title')}</h1>
    <div class="panel dash-top">
      <div><div class="dlabel">${t('dash_prediction')}</div><div class="dpred"><span class="you">${plan.predicted.ours}</span> – <span>${plan.predicted.theirs}</span></div></div>
      <div class="grow"><div class="dlabel">${t('dash_win')} · ${p}%</div><div class="dwin"><i style="width:${p}%"></i></div></div>
      <div><div class="dlabel">${t('dash_auto')}</div><div><b>${t(plan.autoAdvice === 'win' ? 'dash_winAuto' : plan.autoAdvice === 'lose' ? 'dash_loseAuto' : 'dash_eitherAuto')}</b></div></div>
      <div><div class="dlabel">${t('dash_rp')}</div><div class="drp">${plan.rp.energized ? '⚡ ENERGIZED ' : ''}${plan.rp.supercharged ? '🔋 SUPERCHARGED ' : ''}${plan.rp.traversal ? '🧗 TRAVERSAL' : ''}${!plan.rp.energized && !plan.rp.traversal ? '—' : ''}</div></div>
    </div>
    <div class="split">
      <div class="panel"><b>${t('dash_orders')}</b>
        <table class="ranktable"><tr><th>DS</th><th>${t('team')}</th><th>${t('role')}</th><th>AUTO</th><th>END GAME</th></tr>
        ${plan.orders
          .map(
            (o) => `<tr class="${o.isPlayer ? 'me' : ''}"><td>${o.station}</td><td>${o.team}${o.isPlayer ? ` (${t('dash_you')})` : ''}</td><td>${roleLabel(o.role)}${o.defendTeam ? ` · ${t('dash_marks', { t: String(o.defendTeam) })}` : ''}</td><td>${esc(rname(o.auto))}</td><td>${o.climb ? t('dash_climb', { l: String(o.climb) }) : t('dash_noClimb')}</td></tr>`,
          )
          .join('')}</table>
        <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn primary" data-apply>✓ ${t('dash_apply')}</button><button class="btn" data-play>▶ ${t('play')} ${m.id}</button></div>
        ${applied ? `<div class="msg ok" style="margin-top:8px">${t('dash_applied')}</div>` : ''}
      </div>
      <div class="panel"><b>${t('dash_tips')}</b><ol class="dtips">${plan.tips.map((x) => `<li>${note(x)}</li>`).join('')}</ol></div>
    </div>
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
  root.querySelector('[data-play]')!.addEventListener('click', on.play);
  root.querySelector('[data-apply]')!.addEventListener('click', () => {
    applyPlan(plan, settings, `${t('dash_title')} ${m.id}`);
    renderDashboard(root, tt, m, settings, on);
  });
}
