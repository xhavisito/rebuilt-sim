/**
 * Pantalla del torneo rápido. Los matches de otros equipos se pueden ver (transmisión o desde
 * las gradas) u omitir (se simulan); muestra rankings (general y por categoría), la selección
 * de alianzas (si eres capitán eliges tú; cada equipo acepta o rechaza) y el bracket.
 */
import { profileFromSpec } from '../ai/Scouting';
import { robotById, ROBOT_PRESETS } from '../config/robots';
import { loadJSON, saveJSON, type Settings } from '../config/settings';
import { Rng } from '../core/rng';
import {
  advancePlayoffs,
  aiAccepts,
  aiPick,
  allianceIndexOf,
  availableTeams,
  beginSelection,
  CATEGORIES,
  categoryRankings,
  createTournament,
  finishSelection,
  mustAccept,
  rankings,
  respondInvite,
  selectionTurn,
  simulateMatch,
  type Category,
  type TeamTraits,
  type TMatch,
  type Tournament,
} from '../core/tournament';
import type { EventType } from '../core/types';
import { bind, seg } from './forms';
import { renderDashboard } from './StrategyDashboard';
import { t, type TKey } from './i18n';

const KEY = 'rebuilt-sim.tournament.v1';

export const loadTournament = (): Tournament | null => loadJSON<Tournament | null>(KEY, null);
export const saveTournament = (tt: Tournament | null): void => saveJSON(KEY, tt);

const involvesPlayer = (tt: Tournament, m: TMatch) => [...m.red, ...m.blue].some((i) => tt.teams[i].isPlayer);

/** Pros y contras de un robot para el torneo (del scouting de la IA). */
const traitsOf = (specId: string): TeamTraits => {
  const p = profileFromSpec(robotById(specId));
  return { scoring: p.scoring, defense: p.defense, passing: p.passing, driving: p.driving };
};

/** Lo que sigue en el torneo para el jugador. */
type Next =
  | { kind: 'play'; m: TMatch }
  | { kind: 'watch'; m: TMatch }
  | { kind: 'pick'; alliance: number }
  | { kind: 'invite'; alliance: number }
  | null;

type Tab = 'overall' | Category;

export class TournamentScreen {
  private cfg = { teams: 12, perTeam: 5, ev: 'regional' as EventType, others: 'ask' as 'ask' | 'skip' };
  private tab: Tab = 'overall';
  /** "Omitir hasta mi match": simula los demás sin preguntar hasta que le toque al jugador. */
  private skipToMine = false;
  private note = '';

  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private onBack: () => void,
    private onPlay: (tt: Tournament, m: TMatch, watch?: 'broadcast' | 'stands') => void,
  ) {}

  open(): void {
    const tt = loadTournament();
    if (!tt) this.setup();
    else {
      // Torneos guardados antes del scouting
      for (const tm of tt.teams) tm.traits ??= traitsOf(tm.specId);
      this.view(tt);
    }
  }

  private setup(): void {
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('tournament')}</h1>
      <div class="panel form">
        <label>${t('teams')}</label>${seg('teams', ['12', '18', '24'].map((v) => ({ value: v, label: v })), String(this.cfg.teams))}
        <label>${t('matchesPerTeam')}</label>${seg('per', ['3', '5', '8'].map((v) => ({ value: v, label: v })), String(this.cfg.perTeam))}
        <label>${t('eventType')}</label>${seg('ev', (['regional', 'districtChamp', 'champs'] as const).map((e) => ({ value: e, label: t(`ev_${e}` as TKey) })), this.cfg.ev)}
        <label>${t('otherMatches')}</label>${seg('others', [{ value: 'ask', label: t('others_ask') }, { value: 'skip', label: t('others_skip') }], this.cfg.others)}
        <label>${t('robot')}</label><div>${robotById(this.settings.match.robotId).name}</div>
      </div>
      <button class="btn primary" data-create style="align-self:center;min-width:240px">${t('createTournament')}</button>
    </div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    bind(this.root, (n, v) => {
      if (n === 'teams') this.cfg.teams = Number(v);
      if (n === 'per') this.cfg.perTeam = Number(v);
      if (n === 'ev') this.cfg.ev = v as EventType;
      if (n === 'others') this.cfg.others = v as 'ask' | 'skip';
    });
    this.root.querySelector('[data-create]')!.addEventListener('click', () => {
      const seed = (Math.random() * 2 ** 32) >>> 0;
      const rng = new Rng(seed);
      const spec = robotById(this.settings.match.robotId);
      // Los mejores robots de la temporada conservan su número de equipo real (la primera vez)
      const used = new Set<number>([spec.teamNumber]);
      const pool = Array.from({ length: this.cfg.teams }, (_, i) => {
        const p = ROBOT_PRESETS[i % ROBOT_PRESETS.length];
        let team = p.real && !used.has(p.teamNumber) ? p.teamNumber : 100 + Math.floor(rng.next() * 9800);
        while (used.has(team)) team = 100 + Math.floor(rng.next() * 9800);
        used.add(team);
        const strength = p.real ? rng.range(0.7, 0.97) : rng.range(0.25, 0.8);
        return { team, specId: p.id, name: p.name, strength: Math.round(strength * 100) / 100, traits: traitsOf(p.id) };
      });
      const tt = createTournament({ team: spec.teamNumber, specId: spec.id, name: spec.name, strength: 0.6, isPlayer: true, traits: traitsOf(spec.id) }, pool, this.cfg.teams, this.cfg.perTeam, this.cfg.ev, rng, seed);
      tt.others = this.cfg.others;
      this.skipToMine = false;
      saveTournament(tt);
      this.view(tt);
    });
  }

  private rng(tt: Tournament): Rng {
    const s = tt.selection;
    return new Rng(tt.seed + tt.quals.filter((m) => m.result).length * 7919 + tt.playoffs.length * 31 + (s ? s.log.length * 131 : 0));
  }

  /** ¿Se pregunta si ver este match de otros equipos? */
  private asks(tt: Tournament): boolean {
    return (tt.others ?? 'ask') === 'ask' && !this.skipToMine;
  }

  /**
   * Avanza hasta lo siguiente que necesita al jugador: su match, un match de otros (para verlo u
   * omitirlo), su turno de elegir como capitán o una invitación a una alianza.
   */
  private advance(tt: Tournament): Next {
    const rng = this.rng(tt);
    for (const m of tt.quals) {
      if (m.result) continue;
      if (involvesPlayer(tt, m)) return { kind: 'play', m };
      if (this.asks(tt)) return { kind: 'watch', m };
      m.result = simulateMatch(tt.teams, m, tt.eventType, rng);
    }
    if (!tt.alliances) {
      if (!tt.selection) beginSelection(tt, rankings(tt, new Rng(tt.seed)));
      for (let guard = 0; guard < 80; guard++) {
        const a = selectionTurn(tt);
        if (a === null) break;
        const captain = tt.selection!.alliances[a][0];
        if (tt.teams[captain].isPlayer) return { kind: 'pick', alliance: a };
        const team = aiPick(tt, a);
        if (tt.teams[team].isPlayer) {
          if (mustAccept(tt, team)) respondInvite(tt, team, a, true);
          else return { kind: 'invite', alliance: a };
          continue;
        }
        respondInvite(tt, team, a, aiAccepts(tt, team, a, rng));
      }
      finishSelection(tt);
    }
    for (let guard = 0; guard < 10 && tt.champion === null; guard++) {
      const pending = tt.playoffs.find((m) => !m.result);
      if (!pending) {
        advancePlayoffs(tt);
        continue;
      }
      if (involvesPlayer(tt, pending)) return { kind: 'play', m: pending };
      if (this.asks(tt)) return { kind: 'watch', m: pending };
      pending.result = simulateMatch(tt.teams, pending, tt.eventType, rng);
      advancePlayoffs(tt);
    }
    return null;
  }

  view(tt: Tournament): void {
    const next = this.advance(tt);
    if (next?.kind === 'play') this.skipToMine = false;
    saveTournament(tt);
    const rk = rankings(tt, new Rng(tt.seed));
    const num = (i: number) => tt.teams[i].team;
    const side = (ids: number[]) => ids.map((i) => `<span class="team ${tt.teams[i].isPlayer ? 'me' : ''}">${num(i)}</span>`).join('');
    const played = tt.quals.filter((m) => m.result).length;
    const res = (m: TMatch) => (m.result ? `${m.result.red.score} – ${m.result.blue.score}` : '—');
    const sel = tt.selection;
    const alliancesNow = tt.alliances ?? sel?.alliances ?? null;
    const allianceList = alliancesNow
      ? alliancesNow.map((a, i) => `<div class="row"><b>A${i + 1}</b>${side(a)}</div>`).join('')
      : `<div class="msg warn">${t('afterQuals')}</div>`;
    const selLog = sel?.log.length
      ? `<div class="sel-log">${sel.log
          .map((l) => `<div>A${l.alliance + 1} → ${num(l.team)} ${l.accepted ? `<span class="ok">✓ ${t('accepted')}</span>` : `<span class="no">✗ ${t('declined')}</span>`}</div>`)
          .join('')}</div>`
      : '';
    const bracket = tt.playoffs.map((m) => `<div class="row"><b>${m.id}</b> <span class="sw red"></span>A${allianceIndexOf(tt, m.red) + 1} ${res(m)} A${allianceIndexOf(tt, m.blue) + 1}<span class="sw blue" style="margin-left:6px"></span></div>`).join('');
    const champ = tt.champion !== null ? `<div class="msg ok" style="font-size:16px;text-align:center">🏆 ${t('champion')}: A${tt.champion + 1} ${side(tt.alliances![tt.champion])}</div>` : '';
    const inPlayoffs = tt.alliances?.some((a) => a.some((i) => tt.teams[i].isPlayer));
    const cat = (i: number, c: Category) => {
      const row = categoryRankings(tt, c).find((r) => r.team === i);
      return row && row.played ? row.value : 0;
    };
    const fmt = (c: Category, v: number) => (c === 'defense' ? `${v.toFixed(0)} s` : v.toFixed(c === 'driving' ? 0 : 1));
    // ---- Panel de lo que sigue
    let action = '';
    if (next?.kind === 'play')
      action = `<div class="panel row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div><b>${next.m.id}</b> <span class="sw red"></span>${side(next.m.red)} <span style="color:var(--muted)">vs</span> <span class="sw blue"></span>${side(next.m.blue)}</div><div class="row" style="gap:8px"><button class="btn" data-dash>${t('dash_open')}</button><button class="btn primary" data-play>▶ ${t('play')} ${next.m.id}</button></div></div>`;
    else if (next?.kind === 'watch')
      action = `<div class="panel" style="display:flex;flex-direction:column;gap:8px"><div><b>${next.m.id}</b> · ${t('otherTeamsMatch')} &nbsp;<span class="sw red"></span>${side(next.m.red)} <span style="color:var(--muted)">vs</span> <span class="sw blue"></span>${side(next.m.blue)}</div>
        <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn primary" data-watch="broadcast">📺 ${t('watchBroadcast')}</button><button class="btn" data-watch="stands">🏟 ${t('watchStands')}</button><button class="chipbtn" data-skip>⏭ ${t('skipMatch')}</button><button class="chipbtn" data-skipall>⏩ ${t('skipToMine')}</button></div></div>`;
    else if (next?.kind === 'pick') {
      const avail = availableTeams(tt).sort((a, b) => (rk.findIndex((r) => r.team === a) - rk.findIndex((r) => r.team === b)));
      action = `<div class="panel" style="display:flex;flex-direction:column;gap:8px"><b>${t('youPick', { a: `A${next.alliance + 1}` })}</b><div class="msg">${t('pickHelp')}</div>
        <table class="ranktable"><tr><th>#</th><th>${t('team')}</th><th>RS</th>${CATEGORIES.map((c) => `<th>${t(`cat_${c}` as TKey)}</th>`).join('')}<th></th></tr>
        ${avail
          .map((i) => {
            const r = rk.findIndex((x) => x.team === i);
            return `<tr><td>${r + 1}</td><td>${num(i)} <span style="color:var(--muted)">${tt.teams[i].name}</span></td><td>${rk[r].rs.toFixed(2)}</td>${CATEGORIES.map((c) => `<td>${fmt(c, cat(i, c))}</td>`).join('')}<td><button class="chipbtn" data-invite="${i}">${t('invite')}</button></td></tr>`;
          })
          .join('')}</table>${this.note ? `<div class="msg warn">${this.note}</div>` : ''}</div>`;
    } else if (next?.kind === 'invite') {
      const capt = sel!.alliances[next.alliance][0];
      action = `<div class="panel" style="display:flex;flex-direction:column;gap:8px"><b>${t('invitedBy', { team: String(num(capt)), a: `A${next.alliance + 1}` })}</b> <div>${side(sel!.alliances[next.alliance])}</div>
        <div class="msg">${mustAccept(tt, tt.teams.findIndex((x) => x.isPlayer)) ? t('mustAccept') : t('declineHelp')}</div>
        <div class="row" style="gap:8px"><button class="btn primary" data-accept>✓ ${t('accept')}</button>${mustAccept(tt, tt.teams.findIndex((x) => x.isPlayer)) ? '' : `<button class="btn" data-decline>✗ ${t('decline')}</button>`}</div></div>`;
    } else if (tt.champion !== null && !inPlayoffs) action = `<div class="msg warn">${t('notPicked')}</div>`;
    else if (tt.champion === null || !tt.alliances?.[tt.champion]?.some((i) => tt.teams[i].isPlayer)) action = tt.champion === null ? '' : `<div class="msg warn">${t('eliminated')}</div>`;
    // ---- Ranking: general o por categoría
    const tabs = (['overall', ...CATEGORIES] as Tab[]).map((c) => ({ value: c, label: c === 'overall' ? t('cat_overall') : t(`cat_${c}` as TKey) }));
    const table =
      this.tab === 'overall'
        ? `<table class="ranktable"><tr><th>#</th><th>${t('team')}</th><th>RS</th><th>${t('avgPts')}</th><th>AUTO</th><th>TOWER</th><th>${t('played')}</th></tr>
          ${rk.map((r, i) => `<tr class="${tt.teams[r.team].isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${num(r.team)} <span style="color:var(--muted)">${tt.teams[r.team].name}</span></td><td>${r.rs.toFixed(2)}</td><td>${r.avgNoFoul.toFixed(0)}</td><td>${r.avgAuto.toFixed(1)}</td><td>${r.avgTower.toFixed(0)}</td><td>${r.played}</td></tr>`).join('')}
          </table>`
        : (() => {
            const c = this.tab as Category;
            const rows = categoryRankings(tt, c);
            return `<div class="msg" style="margin:4px 0">${t(`catHelp_${c}` as TKey)}</div><table class="ranktable"><tr><th>#</th><th>${t('team')}</th><th>${t(`cat_${c}` as TKey)}</th><th>${t('played')}</th></tr>
              ${rows.map((r, i) => `<tr class="${tt.teams[r.team].isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${num(r.team)} <span style="color:var(--muted)">${tt.teams[r.team].name}</span></td><td>${fmt(c, r.value)}</td><td>${r.played}</td></tr>`).join('')}</table>`;
          })();
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-new>${t('newTournament')}</button><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('tournament')} · ${t(`ev_${tt.eventType}` as TKey)}</h1>
      ${champ}
      ${action}
      <div class="split">
        <div class="panel"><b>${t('rankings')}</b> <span style="color:var(--muted);font-size:12px">(${played}/${tt.quals.length} Qualifications)</span>
          <div style="margin:6px 0">${seg('tab', tabs, this.tab)}</div>
          ${table}</div>
        <div class="panel" style="display:flex;flex-direction:column;gap:6px"><b>${t('alliancesTitle')}</b>${allianceList}${selLog}<b style="margin-top:8px">Playoffs</b>${bracket || `<div class="msg warn">${t('afterQuals')}</div>`}</div>
      </div></div>`;
    this.note = '';
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    this.root.querySelector('[data-new]')!.addEventListener('click', () => {
      saveTournament(null);
      this.setup();
    });
    bind(this.root, (n, v) => {
      if (n === 'tab') {
        this.tab = v as Tab;
        this.view(tt);
      }
    });
    const m = next && (next.kind === 'play' || next.kind === 'watch') ? next.m : null;
    this.root.querySelector('[data-play]')?.addEventListener('click', () => m && this.onPlay(tt, m));
    this.root.querySelector('[data-dash]')?.addEventListener('click', () => {
      if (m) renderDashboard(this.root, tt, m, this.settings, { back: () => this.view(tt), play: () => this.onPlay(tt, m) });
    });
    this.root.querySelectorAll<HTMLElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => m && this.onPlay(tt, m, b.dataset.watch as 'broadcast' | 'stands')));
    this.root.querySelector('[data-skip]')?.addEventListener('click', () => {
      if (m) m.result = simulateMatch(tt.teams, m, tt.eventType, this.rng(tt));
      if (m?.kind !== 'qual') advancePlayoffs(tt);
      this.view(tt);
    });
    this.root.querySelector('[data-skipall]')?.addEventListener('click', () => {
      this.skipToMine = true;
      this.view(tt);
    });
    this.root.querySelectorAll<HTMLElement>('[data-invite]').forEach((b) =>
      b.addEventListener('click', () => {
        if (next?.kind !== 'pick') return;
        const team = Number(b.dataset.invite);
        const ok = aiAccepts(tt, team, next.alliance, this.rng(tt));
        respondInvite(tt, team, next.alliance, ok);
        this.note = ok ? '' : t('teamDeclined', { team: String(num(team)) });
        this.view(tt);
      }),
    );
    const answer = (ok: boolean) => {
      if (next?.kind !== 'invite') return;
      const me = tt.teams.findIndex((x) => x.isPlayer);
      respondInvite(tt, me, next.alliance, ok);
      this.view(tt);
    };
    this.root.querySelector('[data-accept]')?.addEventListener('click', () => answer(true));
    this.root.querySelector('[data-decline]')?.addEventListener('click', () => answer(false));
  }
}
