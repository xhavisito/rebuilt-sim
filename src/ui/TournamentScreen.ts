/**
 * Pantalla del torneo rápido. Simula los matches de otros equipos hasta el siguiente match
 * del jugador; muestra rankings, alianzas y el bracket de Playoffs.
 */
import { robotById, ROBOT_PRESETS } from '../config/robots';
import { loadJSON, saveJSON, type Settings } from '../config/settings';
import { Rng } from '../core/rng';
import {
  advancePlayoffs,
  allianceIndexOf,
  createTournament,
  rankings,
  selectAlliances,
  simulateMatch,
  startPlayoffs,
  type TMatch,
  type Tournament,
} from '../core/tournament';
import type { EventType } from '../core/types';
import { bind, seg } from './forms';
import { t, type TKey } from './i18n';

const KEY = 'rebuilt-sim.tournament.v1';

export const loadTournament = (): Tournament | null => loadJSON<Tournament | null>(KEY, null);
export const saveTournament = (tt: Tournament | null): void => saveJSON(KEY, tt);

const involvesPlayer = (tt: Tournament, m: TMatch) => [...m.red, ...m.blue].some((i) => tt.teams[i].isPlayer);

export class TournamentScreen {
  private cfg = { teams: 12, perTeam: 5, ev: 'regional' as EventType };

  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private onBack: () => void,
    private onPlay: (tt: Tournament, m: TMatch) => void,
  ) {}

  open(): void {
    const tt = loadTournament();
    if (!tt) this.setup();
    else this.view(tt);
  }

  private setup(): void {
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('tournament')}</h1>
      <div class="panel form">
        <label>${t('teams')}</label>${seg('teams', ['12', '18', '24'].map((v) => ({ value: v, label: v })), String(this.cfg.teams))}
        <label>${t('matchesPerTeam')}</label>${seg('per', ['3', '5', '8'].map((v) => ({ value: v, label: v })), String(this.cfg.perTeam))}
        <label>${t('eventType')}</label>${seg('ev', (['regional', 'districtChamp', 'champs'] as const).map((e) => ({ value: e, label: t(`ev_${e}` as TKey) })), this.cfg.ev)}
        <label>${t('robot')}</label><div>${robotById(this.settings.match.robotId).name}</div>
      </div>
      <button class="btn primary" data-create style="align-self:center;min-width:240px">${t('createTournament')}</button>
    </div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    bind(this.root, (n, v) => {
      if (n === 'teams') this.cfg.teams = Number(v);
      if (n === 'per') this.cfg.perTeam = Number(v);
      if (n === 'ev') this.cfg.ev = v as EventType;
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
        return { team, specId: p.id, name: p.name, strength: Math.round(strength * 100) / 100 };
      });
      const tt = createTournament({ team: spec.teamNumber, specId: spec.id, name: spec.name, strength: 0.6, isPlayer: true }, pool, this.cfg.teams, this.cfg.perTeam, this.cfg.ev, rng, seed);
      saveTournament(tt);
      this.view(tt);
    });
  }

  /** Simula todo lo que no involucra al jugador hasta su siguiente match. */
  private advance(tt: Tournament): TMatch | null {
    const rng = new Rng(tt.seed + tt.quals.filter((m) => m.result).length * 7919 + tt.playoffs.length * 31);
    for (const m of tt.quals) {
      if (m.result) continue;
      if (involvesPlayer(tt, m)) return m;
      m.result = simulateMatch(tt.teams, m, tt.eventType, rng);
    }
    if (!tt.alliances) {
      tt.alliances = selectAlliances(tt, rankings(tt, new Rng(tt.seed)));
      startPlayoffs(tt);
    }
    for (let guard = 0; guard < 10 && tt.champion === null; guard++) {
      const pending = tt.playoffs.find((m) => !m.result);
      if (!pending) {
        advancePlayoffs(tt);
        continue;
      }
      if (involvesPlayer(tt, pending)) return pending;
      pending.result = simulateMatch(tt.teams, pending, tt.eventType, rng);
      advancePlayoffs(tt);
    }
    return null;
  }

  view(tt: Tournament): void {
    const next = this.advance(tt);
    saveTournament(tt);
    const rk = rankings(tt, new Rng(tt.seed));
    const num = (i: number) => tt.teams[i].team;
    const side = (ids: number[]) => ids.map((i) => `<span class="team ${tt.teams[i].isPlayer ? 'me' : ''}">${num(i)}</span>`).join('');
    const played = tt.quals.filter((m) => m.result).length;
    const res = (m: TMatch) => (m.result ? `${m.result.red.score} – ${m.result.blue.score}` : '—');
    const allianceList = tt.alliances
      ? tt.alliances.map((a, i) => `<div class="row"><b>A${i + 1}</b>${side(a)}</div>`).join('')
      : `<div class="msg warn">${t('afterQuals')}</div>`;
    const bracket = tt.playoffs.map((m) => `<div class="row"><b>${m.id}</b> <span class="sw red"></span>A${allianceIndexOf(tt, m.red) + 1} ${res(m)} A${allianceIndexOf(tt, m.blue) + 1}<span class="sw blue" style="margin-left:6px"></span></div>`).join('');
    const champ = tt.champion !== null ? `<div class="msg ok" style="font-size:16px;text-align:center">🏆 ${t('champion')}: A${tt.champion + 1} ${side(tt.alliances![tt.champion])}</div>` : '';
    const playerOut = next === null && tt.champion !== null;
    this.root.innerHTML = `<div class="inner">
      <div class="brandbar"><div class="brand">REBUILT <span>SIM</span></div><div class="ctx">2026 REBUILT</div><div class="grow"></div><button class="chipbtn" data-new>${t('newTournament')}</button><button class="chipbtn" data-back>← ${t('back')}</button></div>
      <h1>${t('tournament')} · ${t(`ev_${tt.eventType}` as TKey)}</h1>
      ${champ}
      ${
        next
          ? `<div class="panel row" style="justify-content:space-between"><div><b>${next.id}</b> <span class="sw red"></span>${side(next.red)} <span style="color:var(--muted)">vs</span> <span class="sw blue"></span>${side(next.blue)}</div><button class="btn primary" data-play>▶ ${t('play')} ${next.id}</button></div>`
          : playerOut
            ? ''
            : `<div class="msg warn">${t('eliminated')}</div>`
      }
      <div class="split">
        <div class="panel"><b>${t('rankings')}</b> <span style="color:var(--muted);font-size:12px">(${played}/${tt.quals.length} Qualifications)</span>
          <table class="ranktable"><tr><th>#</th><th>${t('team')}</th><th>RS</th><th>${t('avgPts')}</th><th>AUTO</th><th>TOWER</th><th>${t('played')}</th></tr>
          ${rk.map((r, i) => `<tr class="${tt.teams[r.team].isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${num(r.team)} <span style="color:var(--muted)">${tt.teams[r.team].name}</span></td><td>${r.rs.toFixed(2)}</td><td>${r.avgNoFoul.toFixed(0)}</td><td>${r.avgAuto.toFixed(1)}</td><td>${r.avgTower.toFixed(0)}</td><td>${r.played}</td></tr>`).join('')}
          </table></div>
        <div class="panel" style="display:flex;flex-direction:column;gap:6px"><b>${t('alliancesTitle')}</b>${allianceList}<b style="margin-top:8px">Playoffs</b>${bracket || `<div class="msg warn">${t('afterQuals')}</div>`}</div>
      </div></div>`;
    this.root.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    this.root.querySelector('[data-new]')!.addEventListener('click', () => {
      saveTournament(null);
      this.setup();
    });
    this.root.querySelector('[data-play]')?.addEventListener('click', () => next && this.onPlay(tt, next));
  }
}
