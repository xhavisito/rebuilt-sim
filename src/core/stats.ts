/**
 * Estadísticas del jugador y de los robots (lógica pura, pruebas en tests/stats.test.ts).
 *
 * - Cada match terminado deja una línea por robot (`RobotLine`): FUEL anotado, tiros, ciclos,
 *   TOWER, faltas… Se acumulan en `Agg` por jugador, por robot que usó el jugador y por diseño
 *   de robot (todos los del campo, también los de la IA).
 * - Rating tipo Elo del jugador: el rival vale según la dificultad de la IA (o 1200 si es otra
 *   persona). Solo cuenta en matches con reglas completas (no práctica).
 * - El ranking global publica un resumen (`BoardEntry`) por jugador; `parseBoardEntry` valida
 *   lo que llega de cualquiera.
 */
import type { Alliance } from './types';

export type Outcome = 'W' | 'L' | 'T';

/** Desempeño de un robot en un match. */
export interface RobotLine {
  specId: string;
  name: string;
  team: number;
  alliance: Alliance;
  /** Lo manejaba una persona (local o en línea). */
  human: boolean;
  fuel: number;
  /** FUEL lanzados al HUB (sin pases ni entregas al CORRAL). */
  shots: number;
  passes: number;
  intaked: number;
  cycles: number;
  tower: number;
  level: number;
  /** Puntos regalados al oponente en faltas. */
  foulPts: number;
  defense: number;
  distance: number;
}

/** Acumulado de varias líneas. */
export interface Agg {
  matches: number;
  wins: number;
  ties: number;
  fuel: number;
  shots: number;
  passes: number;
  cycles: number;
  tower: number;
  climbs: number;
  foulPts: number;
  defense: number;
  distance: number;
  /** Puntos aportados (FUEL + TOWER − faltas), total y mejor match. */
  points: number;
  best: number;
}

export interface NamedAgg extends Agg {
  name: string;
  team: number;
}

/** Un match en el historial del jugador. */
export interface MatchRecord {
  ts: number;
  mode: string;
  difficulty: string;
  alliance: Alliance;
  outcome: Outcome;
  score: number;
  oppScore: number;
  rp: number;
  me: RobotLine;
  /** Rating después del match y cambio. */
  rating: number;
  delta: number;
}

export interface StatsStore {
  v: 1;
  /** Id anónimo del jugador (ranking global). */
  id: string;
  rating: number;
  peak: number;
  /** Matches con rating (los primeros mueven más el rating). */
  rated: number;
  me: Agg;
  /** Del jugador, por robot que usó. */
  mine: Record<string, NamedAgg>;
  /** Todos los robots de los matches del jugador (también los de la IA). */
  robots: Record<string, NamedAgg>;
  history: MatchRecord[];
}

export const HISTORY_MAX = 60;
export const RATING_START = 1200;
/** Rating del rival según la dificultad de la IA; una persona cuenta como el inicial. */
export const AI_RATING: Record<string, number> = { easy: 950, normal: 1150, hard: 1350, einstein: 1550 };
/** Modos que cuentan para el rating (matches con reglas completas). */
export const RATED_MODES = ['match', 'local', 'tournament', 'online'];

export const emptyAgg = (): Agg => ({
  matches: 0,
  wins: 0,
  ties: 0,
  fuel: 0,
  shots: 0,
  passes: 0,
  cycles: 0,
  tower: 0,
  climbs: 0,
  foulPts: 0,
  defense: 0,
  distance: 0,
  points: 0,
  best: 0,
});

export function newStore(id = randomId()): StatsStore {
  return { v: 1, id, rating: RATING_START, peak: RATING_START, rated: 0, me: emptyAgg(), mine: {}, robots: {}, history: [] };
}

export function randomId(rand: () => number = Math.random): string {
  let s = '';
  while (s.length < 12) s += Math.floor(rand() * 36).toString(36);
  return s;
}

export const linePoints = (l: RobotLine): number => l.fuel + l.tower - l.foulPts;

export function addLine(a: Agg, l: RobotLine, o: Outcome): void {
  const pts = linePoints(l);
  a.best = a.matches ? Math.max(a.best, pts) : pts;
  a.matches++;
  if (o === 'W') a.wins++;
  if (o === 'T') a.ties++;
  a.fuel += l.fuel;
  a.shots += l.shots;
  a.passes += l.passes;
  a.cycles += l.cycles;
  a.tower += l.tower;
  if (l.level > 0) a.climbs++;
  a.foulPts += l.foulPts;
  a.defense += l.defense;
  a.distance += l.distance;
  a.points += pts;
}

/** Promedios para mostrar. */
export interface Summary {
  matches: number;
  winRate: number;
  avgPoints: number;
  avgFuel: number;
  /** FUEL anotado / FUEL tirado al HUB (0–1). */
  accuracy: number;
  avgCycles: number;
  /** FUEL por ciclo. */
  perCycle: number;
  climbRate: number;
  avgTower: number;
  avgFouls: number;
  best: number;
}

export function summarize(a: Agg): Summary {
  const n = Math.max(1, a.matches);
  return {
    matches: a.matches,
    winRate: (a.wins + a.ties / 2) / n,
    avgPoints: a.points / n,
    avgFuel: a.fuel / n,
    accuracy: a.shots ? Math.min(1, a.fuel / a.shots) : 0,
    avgCycles: a.cycles / n,
    perCycle: a.cycles ? a.fuel / a.cycles : 0,
    climbRate: a.climbs / n,
    avgTower: a.tower / n,
    avgFouls: a.foulPts / n,
    best: a.best,
  };
}

/** Elo: `score` 1 ganar, 0.5 empate, 0 perder. Los primeros 10 matches mueven más. */
export function eloUpdate(rating: number, opp: number, score: number, rated: number): number {
  const expected = 1 / (1 + 10 ** ((opp - rating) / 400));
  const k = rated < 10 ? 48 : 24;
  return Math.round(rating + k * (score - expected));
}

/** Rating del rival: promedio de los robots de la otra alianza. */
export function opponentRating(opponents: Array<{ human: boolean }>, difficulty: string): number {
  if (!opponents.length) return RATING_START;
  const ai = AI_RATING[difficulty] ?? AI_RATING.normal;
  return opponents.reduce((s, o) => s + (o.human ? RATING_START : ai), 0) / opponents.length;
}

export interface MatchInput {
  ts: number;
  mode: string;
  difficulty: string;
  score: Record<Alliance, number>;
  /** RP de la alianza del jugador. */
  rp: number;
  robots: RobotLine[];
  /** Índice en `robots` del robot del jugador (−1 = solo se registran los robots). */
  me: number;
}

const outcomeOf = (score: Record<Alliance, number>, a: Alliance): Outcome =>
  score.red === score.blue ? 'T' : score[a] > score[a === 'red' ? 'blue' : 'red'] ? 'W' : 'L';

function addNamed(map: Record<string, NamedAgg>, l: RobotLine, o: Outcome): void {
  const a = (map[l.specId] ??= { ...emptyAgg(), name: l.name, team: l.team });
  a.name = l.name;
  a.team = l.team;
  addLine(a, l, o);
}

/** Agrega un match terminado (modifica `st`); devuelve el registro del jugador, si hay. */
export function recordMatch(st: StatsStore, m: MatchInput): MatchRecord | null {
  for (const l of m.robots) addNamed(st.robots, l, outcomeOf(m.score, l.alliance));
  const me = m.robots[m.me];
  if (!me) return null;
  const outcome = outcomeOf(m.score, me.alliance);
  addLine(st.me, me, outcome);
  addNamed(st.mine, me, outcome);
  let delta = 0;
  if (RATED_MODES.includes(m.mode)) {
    const opp = opponentRating(
      m.robots.filter((r) => r.alliance !== me.alliance),
      m.difficulty,
    );
    const next = eloUpdate(st.rating, opp, outcome === 'W' ? 1 : outcome === 'T' ? 0.5 : 0, st.rated);
    delta = next - st.rating;
    st.rating = next;
    st.peak = Math.max(st.peak, next);
    st.rated++;
  }
  const rec: MatchRecord = {
    ts: m.ts,
    mode: m.mode,
    difficulty: m.difficulty,
    alliance: me.alliance,
    outcome,
    score: m.score[me.alliance],
    oppScore: m.score[me.alliance === 'red' ? 'blue' : 'red'],
    rp: m.rp,
    me,
    rating: st.rating,
    delta,
  };
  st.history.unshift(rec);
  if (st.history.length > HISTORY_MAX) st.history.length = HISTORY_MAX;
  return rec;
}

/** Robot favorito (más matches) del jugador. */
export function topRobot(st: StatsStore): NamedAgg | null {
  let best: NamedAgg | null = null;
  for (const a of Object.values(st.mine)) if (!best || a.matches > best.matches) best = a;
  return best;
}

/** Restaura lo guardado (o empieza de cero si está dañado o es de otra versión). */
export function reviveStore(raw: unknown): StatsStore {
  const o = raw as Partial<StatsStore> | null;
  if (!o || o.v !== 1 || typeof o.id !== 'string' || !o.me) return newStore();
  const base = newStore(o.id);
  return { ...base, ...o, me: { ...emptyAgg(), ...o.me }, mine: o.mine ?? {}, robots: o.robots ?? {}, history: Array.isArray(o.history) ? o.history : [] };
}

// ------------------------------------------------------------------ ranking global
/** Resumen público de un jugador. */
export interface BoardEntry {
  id: string;
  name: string;
  rating: number;
  peak: number;
  matches: number;
  wins: number;
  winRate: number;
  avgPoints: number;
  avgFuel: number;
  accuracy: number;
  avgCycles: number;
  climbRate: number;
  robot: string;
  team: number;
  ts: number;
}

export const BOARD_VERSION = 1;
/** Un jugador que no ha jugado en este tiempo ya no aparece. */
export const BOARD_STALE_MS = 120 * 86_400_000;

export function boardEntry(st: StatsStore, name: string, now = Date.now()): BoardEntry {
  const s = summarize(st.me);
  const top = topRobot(st);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    id: st.id,
    name: name.slice(0, 24),
    rating: st.rating,
    peak: st.peak,
    matches: st.me.matches,
    wins: st.me.wins,
    winRate: Math.round(s.winRate * 1000) / 1000,
    avgPoints: r1(s.avgPoints),
    avgFuel: r1(s.avgFuel),
    accuracy: Math.round(s.accuracy * 1000) / 1000,
    avgCycles: r1(s.avgCycles),
    climbRate: Math.round(s.climbRate * 1000) / 1000,
    robot: top?.name.slice(0, 32) ?? '',
    team: top?.team ?? 0,
    ts: now,
  };
}

const num = (v: unknown, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

/** Valida un resumen (viene de cualquiera que publique en el broker). */
export function parseBoardEntry(topicId: string, payload: string, now = Date.now()): BoardEntry | null {
  if (!payload || !/^[a-z0-9]{8,16}$/.test(topicId)) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!o || o.v !== BOARD_VERSION || o.id !== topicId) return null;
  const ts = Number(o.ts);
  if (!Number.isFinite(ts) || now - ts > BOARD_STALE_MS || ts - now > 86_400_000) return null;
  const name = String(o.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 24);
  const matches = Math.floor(num(o.matches, 0, 1e6));
  if (!name || matches < 1) return null;
  return {
    id: topicId,
    name,
    rating: Math.round(num(o.rating, 0, 4000)),
    peak: Math.round(num(o.peak, 0, 4000)),
    matches,
    wins: Math.floor(num(o.wins, 0, matches)),
    winRate: num(o.winRate, 0, 1),
    avgPoints: num(o.avgPoints, -500, 1000),
    avgFuel: num(o.avgFuel, 0, 1000),
    accuracy: num(o.accuracy, 0, 1),
    avgCycles: num(o.avgCycles, 0, 200),
    climbRate: num(o.climbRate, 0, 1),
    robot: String(o.robot ?? '').slice(0, 32),
    team: Math.floor(num(o.team, 0, 99999)),
    ts,
  };
}

export type BoardSort = 'rating' | 'avgPoints' | 'avgFuel' | 'accuracy' | 'avgCycles' | 'matches';

/** Ordena el ranking; la precisión solo compara a quien jugó al menos 3 matches. */
export function sortBoard(list: BoardEntry[], by: BoardSort): BoardEntry[] {
  const key = (e: BoardEntry) => (by === 'accuracy' && e.matches < 3 ? -1 : e[by]);
  return [...list].sort((a, b) => key(b) - key(a) || b.rating - a.rating || b.matches - a.matches || a.name.localeCompare(b.name));
}
