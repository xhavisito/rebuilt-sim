/**
 * Estadísticas y ranking: el perfil del jugador (rating, promedios, por robot), todos los
 * robots de sus matches, el historial y el ranking global en vivo (ver net/leaderboard).
 */
import type { Settings } from '../config/settings';
import { boardEntry, newStore, RATED_MODES, sortBoard, summarize, type Agg, type BoardEntry, type BoardSort, type MatchRecord, type NamedAgg, type StatsStore } from '../core/stats';
import { loadStats, saveStats } from '../game/playerStats';
import { BoardBrowser, publishBoard } from '../net/leaderboard';
import { esc } from './forms';
import { t, type TKey } from './i18n';
import { backBtn, brandbar } from './chrome';

type Tab = 'me' | 'robots' | 'global' | 'history';
const TABS: Array<[Tab, TKey]> = [
  ['me', 'st_tabMe'],
  ['global', 'st_tabGlobal'],
  ['robots', 'st_tabRobots'],
  ['history', 'st_tabHistory'],
];
const SORTS: Array<[BoardSort, TKey]> = [
  ['rating', 'st_rating'],
  ['avgPoints', 'st_avgPts'],
  ['avgFuel', 'st_avgFuel'],
  ['accuracy', 'st_accuracy'],
  ['avgCycles', 'st_cycles'],
  ['matches', 'st_matches'],
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** Publica el resumen del jugador si así lo quiere (después de cada match y al abrir la pantalla). */
export function syncBoard(st: StatsStore, s: Settings): Promise<void> {
  if (!s.board || !s.driverName || !st.me.matches) return Promise.resolve();
  return publishBoard(st.id, boardEntry(st, s.driverName)).catch(() => {});
}

export class StatsScreen {
  private tab: Tab = 'me';
  private sort: BoardSort = 'rating';
  private st: StatsStore = newStore();
  private browser: BoardBrowser | null = null;
  private board: BoardEntry[] = [];
  private boardState: 'idle' | 'connecting' | 'ok' | 'error' = 'idle';
  private confirmReset = false;

  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private onBack: () => void,
    private save: () => void,
    private refreshNav: () => void,
  ) {}

  open(): void {
    this.st = loadStats();
    this.confirmReset = false;
    void syncBoard(this.st, this.settings);
    this.render();
  }

  /** Deja de escuchar el ranking (al salir de la pantalla). */
  close(): void {
    this.browser?.stop();
    this.browser = null;
    this.boardState = 'idle';
  }

  private startBoard(): void {
    if (this.browser) return;
    const b = new BoardBrowser();
    this.browser = b;
    this.boardState = 'connecting';
    b.onChange = (list) => {
      this.board = list;
      if (this.tab === 'global') this.render();
    };
    b.start().then(
      () => {
        if (this.browser !== b) return;
        this.boardState = 'ok';
        if (this.settings.board && this.settings.driverName && this.st.me.matches) b.setLocal(this.st.id, boardEntry(this.st, this.settings.driverName));
        else this.render();
      },
      () => {
        if (this.browser !== b) return;
        this.boardState = 'error';
        this.render();
      },
    );
  }

  private render(): void {
    if (this.tab === 'global') this.startBoard();
    const body = this.tab === 'me' ? this.me() : this.tab === 'robots' ? this.robots() : this.tab === 'global' ? this.global() : this.history();
    this.root.innerHTML = `<div class="inner stats">
      ${brandbar('2026 REBUILT', backBtn('data-nav data-back'))}
      <h1>${t('st_title')}</h1>
      <div class="st-tabs" role="tablist">${TABS.map(([k, l]) => `<button class="chipbtn ${k === this.tab ? 'on' : ''}" role="tab" aria-selected="${k === this.tab}" data-nav data-tab="${k}">${t(l)}</button>`).join('')}</div>
      ${body}
    </div>`;
    const r = this.root;
    r.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    r.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        this.render();
      }),
    );
    r.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sort = b.dataset.sort as BoardSort;
        this.render();
      }),
    );
    r.querySelector('[data-publish]')?.addEventListener('click', () => {
      this.settings.board = !this.settings.board;
      this.save();
      const on = this.settings.board && !!this.settings.driverName && this.st.me.matches > 0;
      void publishBoard(this.st.id, on ? boardEntry(this.st, this.settings.driverName) : null).catch(() => {});
      this.browser?.setLocal(this.st.id, on ? boardEntry(this.st, this.settings.driverName) : null);
      this.render();
    });
    r.querySelector('[data-reset]')?.addEventListener('click', () => {
      if (!this.confirmReset) {
        this.confirmReset = true;
        this.render();
        return;
      }
      // borra también la entrada publicada; el id nuevo empieza de cero
      void publishBoard(this.st.id, null).catch(() => {});
      this.browser?.setLocal(this.st.id, null);
      this.st = newStore();
      saveStats(this.st);
      this.confirmReset = false;
      this.render();
    });
    this.refreshNav();
  }

  // ------------------------------------------------------------------ pestañas
  private kpi(label: string, value: string, sub = ''): string {
    return `<div class="st-kpi"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  }

  private kpis(a: Agg): string {
    const s = summarize(a);
    return `<div class="st-kpis">
      ${this.kpi(t('st_matches'), String(a.matches), `${a.wins}-${a.matches - a.wins - a.ties}-${a.ties} ${t('st_record')}`)}
      ${this.kpi(t('st_winRate'), pct(s.winRate))}
      ${this.kpi(t('st_avgPts'), f1(s.avgPoints), `${t('st_best')}: ${s.best}`)}
      ${this.kpi(t('st_avgFuel'), f1(s.avgFuel))}
      ${this.kpi(t('st_accuracy'), a.shots ? pct(s.accuracy) : '—')}
      ${this.kpi(t('st_cycles'), f1(s.avgCycles), `${f1(s.perCycle)} ${t('st_perCycle')}`)}
      ${this.kpi(t('st_tower'), f1(s.avgTower), `${t('st_climb')} ${pct(s.climbRate)}`)}
      ${this.kpi(t('st_fouls'), f1(s.avgFouls))}
    </div>`;
  }

  /** Rating en los últimos matches (una sola serie: línea de 2 px, punto final etiquetado). */
  private trend(): string {
    const pts = this.st.history
      .filter((h) => RATED_MODES.includes(h.mode))
      .slice(0, 30)
      .reverse();
    if (pts.length < 2) return '';
    const W = 560;
    const H = 120;
    const pad = { l: 40, r: 56, t: 10, b: 14 };
    const vals = pts.map((p) => p.rating);
    const lo = Math.floor((Math.min(...vals) - 10) / 50) * 50;
    const hi = Math.ceil((Math.max(...vals) + 10) / 50) * 50;
    const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => H - pad.b - ((v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${Math.round(v)}</text>`).join('');
    // puntos con área de toque grande y tooltip nativo
    const hits = pts
      .map((p, i) => `<g><title>${new Date(p.ts).toLocaleDateString()} · ${t(`st_${p.outcome}` as TKey)} ${p.score}-${p.oppScore} · ${p.rating} (${p.delta >= 0 ? '+' : ''}${p.delta})</title><circle cx="${x(i)}" cy="${y(p.rating)}" r="9" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.rating)}" r="3" class="pt"/></g>`)
      .join('');
    return `<div class="panel"><b>${t('st_trend')}</b>
      <svg viewBox="0 0 ${W} ${H}" class="chart st-trend" role="img" aria-label="${t('st_trend')}">${grid}<path d="${d}" class="ln"/>${hits}
        <text x="${x(pts.length - 1) + 8}" y="${y(last.rating) + 4}" class="lbl">${last.rating}</text></svg></div>`;
  }

  private me(): string {
    const st = this.st;
    if (!st.me.matches) return `<div class="msg warn">${t('st_empty')}</div>`;
    const mine = Object.entries(st.mine).sort((a, b) => b[1].matches - a[1].matches);
    return `
      <div class="st-hero panel">
        <div class="st-rating"><small>${t('st_rating')}</small><b>${st.rating}</b><span>${t('st_peak', { n: st.peak })}</span></div>
        <div class="st-who"><b>${esc(this.settings.driverName || '—')}</b><span class="msg">${t('st_ratingHelp')}</span></div>
      </div>
      ${this.kpis(st.me)}
      ${this.trend()}
      <div class="panel"><b>${t('st_byRobot')}</b>${this.robotTable(mine)}</div>
      <div class="msg">${t('st_cycleHelp')}</div>
      <button class="chipbtn st-reset" data-nav data-reset>${this.confirmReset ? t('st_resetConfirm') : t('st_reset')}</button>`;
  }

  private robotTable(rows: Array<[string, NamedAgg]>): string {
    if (!rows.length) return '';
    return `<div class="st-scroll"><table class="ranktable"><tr><th>#</th><th>${t('st_robot')}</th><th>${t('st_matches')}</th><th>${t('st_winRate')}</th><th>${t('st_avgPts')}</th><th>${t('st_avgFuel')}</th><th>${t('st_accuracy')}</th><th>${t('st_cycles')}</th><th>${t('st_climb')}</th><th>${t('st_fouls')}</th></tr>
      ${rows
        .map(([, a], i) => {
          const s = summarize(a);
          return `<tr><td>${i + 1}</td><td>${a.team} <span style="color:var(--muted)">${esc(a.name)}</span></td><td>${a.matches}</td><td>${pct(s.winRate)}</td><td>${f1(s.avgPoints)}</td><td>${f1(s.avgFuel)}</td><td>${a.shots ? pct(s.accuracy) : '—'}</td><td>${f1(s.avgCycles)}</td><td>${pct(s.climbRate)}</td><td>${f1(s.avgFouls)}</td></tr>`;
        })
        .join('')}</table></div>`;
  }

  private robots(): string {
    const rows = Object.entries(this.st.robots).sort((a, b) => summarize(b[1]).avgPoints - summarize(a[1]).avgPoints || b[1].matches - a[1].matches);
    if (!rows.length) return `<div class="msg warn">${t('st_empty')}</div>`;
    return `<div class="msg">${t('st_robotsHelp')}</div><div class="panel">${this.robotTable(rows)}</div>`;
  }

  private global(): string {
    const s = this.settings;
    const list = sortBoard(this.board, this.sort);
    const mine = list.findIndex((e) => e.id === this.st.id);
    const status =
      this.boardState === 'connecting'
        ? `<div class="msg">${t('st_connecting')}</div>`
        : this.boardState === 'error'
          ? `<div class="msg bad">${t('st_offline')}</div>`
          : !list.length
            ? `<div class="msg warn">${t('st_noPlayers')}</div>`
            : '';
    const fmt = (e: BoardEntry, k: BoardSort) => (k === 'accuracy' ? pct(e.accuracy) : k === 'rating' || k === 'matches' ? String(e[k]) : f1(e[k]));
    const table = list.length
      ? `<div class="st-scroll"><table class="ranktable"><tr><th>#</th><th>${t('st_player')}</th>${SORTS.map(([k, l]) => `<th class="${k === this.sort ? 'on' : ''}">${t(l)}</th>`).join('')}<th>${t('st_winRate')}</th><th>${t('st_robot')}</th></tr>
        ${list
          .slice(0, 100)
          .map(
            (e, i) =>
              `<tr class="${e.id === this.st.id ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}${e.id === this.st.id ? ` <span style="color:var(--muted)">(${t('st_you')})</span>` : ''}</td>${SORTS.map(([k]) => `<td>${fmt(e, k)}</td>`).join('')}<td>${pct(e.winRate)}</td><td style="text-align:left">${e.team ? `${e.team} ` : ''}<span style="color:var(--muted)">${esc(e.robot)}</span></td></tr>`,
          )
          .join('')}</table></div>`
      : '';
    return `
      <div class="msg">${t('st_globalHelp')}</div>
      <div class="panel st-pub">
        <button class="ps-toggle ${s.board ? 'on' : ''}" data-nav data-publish role="switch" aria-checked="${s.board}"><span>${t('st_publish')}</span><i></i></button>
        ${s.board && !s.driverName ? `<div class="msg warn">${t('st_needName')}</div>` : ''}
        ${mine >= 0 ? `<b>${t('st_myPlace', { n: mine + 1, m: list.length })}</b>` : ''}
      </div>
      <div class="st-sort"><span>${t('st_sortBy')}</span>${SORTS.map(([k, l]) => `<button class="chipbtn ${k === this.sort ? 'on' : ''}" data-nav data-sort="${k}">${t(l)}</button>`).join('')}</div>
      ${status}
      ${table}`;
  }

  private history(): string {
    const h = this.st.history;
    if (!h.length) return `<div class="msg warn">${t('st_empty')}</div>`;
    const row = (m: MatchRecord) =>
      `<tr><td>${new Date(m.ts).toLocaleDateString()}</td><td>${t(m.mode as TKey) ?? m.mode}</td><td><span class="sw ${m.alliance}"></span>${t(`st_${m.outcome}` as TKey)} ${m.score}-${m.oppScore}</td><td>${m.me.team} <span style="color:var(--muted)">${esc(m.me.name)}</span></td><td>${m.me.fuel}</td><td>${m.me.shots ? pct(Math.min(1, m.me.fuel / m.me.shots)) : '—'}</td><td>${m.me.cycles}</td><td>${m.me.level ? `L${m.me.level}` : '—'}</td><td>${m.rp}</td><td>${m.rating}${m.delta ? ` <span class="${m.delta > 0 ? 'ok' : 'no'}">${m.delta > 0 ? '+' : ''}${m.delta}</span>` : ''}</td></tr>`;
    return `<div class="panel"><div class="st-scroll"><table class="ranktable st-hist"><tr><th></th><th>${t('st_mode')}</th><th>${t('st_result')}</th><th>${t('st_robot')}</th><th>FUEL</th><th>${t('st_accuracy')}</th><th>${t('st_cycles')}</th><th>TOWER</th><th>RP</th><th>${t('st_rating')}</th></tr>${h.map(row).join('')}</table></div></div>`;
  }
}
