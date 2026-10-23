/**
 * Ranking global con backend: el mismo proyecto gratuito de Supabase de la galería de robots
 * (docs/ranking.sql, docs/ranking.md). Cliente mínimo con fetch, sin SDK.
 *
 * - Cuenta sin correo: un id y un token secreto guardados en este navegador (el servidor solo
 *   guarda el hash). El "código de cuenta" lleva los dos para usarla en otro dispositivo.
 * - Cada match se manda con sus números; el servidor los valida, calcula el rating y acumula.
 *   Sin conexión se guardan en una cola y se mandan después (con la hora en que se jugaron).
 * - Sin Supabase configurado al compilar, el ranking usa el broker MQTT (net/leaderboard.ts).
 */
import { COMMUNITY, communityEnabled } from '../config/community';
import { loadJSON, saveJSON } from '../config/settings';
import type { BoardEntry, BoardSort, MatchInput } from '../core/stats';

export const rankingEnabled = communityEnabled;

export interface RankAccount {
  id: string;
  token: string;
  /** Nombre con el que está registrada (se renombra si cambia el del piloto). */
  name: string;
}

/** Lo que recibe `submit_match` (ver docs/ranking.sql). */
export interface MatchSubmission {
  played_at: string;
  mode: string;
  difficulty: string;
  score: number;
  opp_score: number;
  fuel: number;
  shots: number;
  cycles: number;
  tower: number;
  level: number;
  foul_pts: number;
  robot: string;
  team: number;
  opp_humans: number;
  opp_count: number;
}

interface RankState {
  account: RankAccount | null;
  queue: MatchSubmission[];
}

const KEY = 'rebuilt-sim.ranking.v1';
const QUEUE_MAX = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Errores de validación del servidor: ese match no va a entrar nunca (se descarta). */
const REJECTED = ['too-soon', 'old', 'mode', 'difficulty', 'score', 'fuel', 'cycles', 'tower', 'fouls', 'sum', 'opponents', 'team'];

const loadState = (): RankState => {
  const s = loadJSON<Partial<RankState>>(KEY, {});
  const a = s.account;
  return {
    account: a && UUID.test(String(a.id)) && typeof a.token === 'string' ? { id: a.id, token: a.token, name: String(a.name ?? '') } : null,
    queue: Array.isArray(s.queue) ? s.queue.slice(-QUEUE_MAX) : [],
  };
};
const saveState = (s: RankState): void => saveJSON(KEY, s);

export const rankAccount = (): RankAccount | null => loadState().account;
export const pendingMatches = (): number => loadState().queue.length;

export class RankError extends Error {
  constructor(
    readonly reason: string,
    readonly status: number,
  ) {
    super(reason);
  }
}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const r = await fetch(`${COMMUNITY.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: COMMUNITY.key, Authorization: `Bearer ${COMMUNITY.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    let reason = text;
    try {
      reason = String(JSON.parse(text).message ?? text);
    } catch {
      /* texto plano */
    }
    throw new RankError(reason, r.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Lo que manda el jugador de un match terminado (null si no cuenta para el ranking). */
export function submission(m: MatchInput): MatchSubmission | null {
  const me = m.robots[m.me];
  if (!me || !['match', 'local', 'tournament', 'online'].includes(m.mode)) return null;
  const opps = m.robots.filter((r) => r.alliance !== me.alliance);
  const other = me.alliance === 'red' ? 'blue' : 'red';
  return {
    played_at: new Date(m.ts).toISOString(),
    mode: m.mode,
    difficulty: m.difficulty,
    score: Math.round(m.score[me.alliance]),
    opp_score: Math.round(m.score[other]),
    fuel: me.fuel,
    shots: me.shots,
    cycles: me.cycles,
    tower: me.tower,
    level: me.level,
    foul_pts: me.foulPts,
    robot: me.name.slice(0, 40),
    team: me.team,
    opp_humans: Math.min(3, opps.filter((r) => r.human).length),
    opp_count: Math.max(1, Math.min(3, opps.length)),
  };
}

function token(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** La cuenta de este navegador (la crea si no hay); renombra si cambió el nombre del piloto. */
export async function ensureAccount(name: string): Promise<RankAccount> {
  const st = loadState();
  const n = name.trim().slice(0, 24);
  if (!n) throw new RankError('name', 0);
  if (st.account) {
    if (st.account.name !== n && (await rpc<boolean>('rename_player', { pid: st.account.id, token: st.account.token, name: n }))) {
      st.account.name = n;
      saveState(st);
    }
    return st.account;
  }
  const tk = token();
  const id = await rpc<string>('register_player', { name: n, token: tk });
  if (!UUID.test(String(id))) throw new RankError('register', 0);
  const fresh = loadState();
  fresh.account = { id, token: tk, name: n };
  saveState(fresh);
  return fresh.account;
}

export interface SubmitResult {
  rating: number;
  delta: number;
  matches: number;
}

/** Pone el match en la cola y manda todo lo pendiente; devuelve el resultado del último enviado. */
export async function submitMatch(sub: MatchSubmission | null, name: string): Promise<SubmitResult | null> {
  if (!rankingEnabled() || !name.trim()) return null;
  if (sub) {
    const st = loadState();
    st.queue = [...st.queue, sub].slice(-QUEUE_MAX);
    saveState(st);
  }
  return flush(name);
}

let flushing: Promise<SubmitResult | null> | null = null;

/** Manda la cola en orden; se detiene al primer error de red (se reintenta la próxima vez). */
export function flush(name: string): Promise<SubmitResult | null> {
  // sin matches pendientes no se crea cuenta (solo con el primer match)
  if (!loadState().queue.length) return Promise.resolve(null);
  flushing ??= (async () => {
    let last: SubmitResult | null = null;
    try {
      const acc = await ensureAccount(name);
      for (;;) {
        const st = loadState();
        const next = st.queue[0];
        if (!next) break;
        try {
          last = await rpc<SubmitResult>('submit_match', { pid: acc.id, token: acc.token, m: next });
        } catch (e) {
          if (!(e instanceof RankError)) throw e;
          // cuenta inválida (base reiniciada o borrada): se crea otra la próxima vez
          if (e.reason === 'auth') {
            const s2 = loadState();
            s2.account = null;
            saveState(s2);
            throw e;
          }
          if (e.reason === 'banned' || !REJECTED.includes(e.reason)) throw e;
        }
        const s3 = loadState();
        s3.queue = s3.queue.slice(1);
        saveState(s3);
      }
    } finally {
      flushing = null;
    }
    return last;
  })();
  return flushing;
}

const SORT_PARAM: Record<BoardSort, string> = { rating: 'rating', avgPoints: 'points', avgFuel: 'fuel', accuracy: 'accuracy', avgCycles: 'cycles', matches: 'matches' };

const num = (v: unknown, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

/** Fila del ranking del servidor → entrada para la pantalla (acotada por si acaso). */
export function boardRow(o: Record<string, unknown>): BoardEntry | null {
  const id = String(o?.id ?? '');
  const name = String(o?.name ?? '').slice(0, 24);
  const matches = Math.floor(num(o?.matches, 0, 1e7));
  if (!UUID.test(id) || !name || matches < 1) return null;
  return {
    id,
    name,
    rating: Math.round(num(o.rating, 0, 4000)),
    peak: Math.round(num(o.peak, 0, 4000)),
    matches,
    wins: Math.floor(num(o.wins, 0, matches)),
    winRate: num(o.winRate, 0, 1),
    avgPoints: num(o.avgPoints, -600, 1500),
    avgFuel: num(o.avgFuel, 0, 600),
    accuracy: num(o.accuracy, 0, 1),
    avgCycles: num(o.avgCycles, 0, 80),
    climbRate: num(o.climbRate, 0, 1),
    robot: String(o.robot ?? '').slice(0, 40),
    team: Math.floor(num(o.team, 0, 99999)),
    ts: num(o.ts, 0, 1e14),
  };
}

export async function fetchBoard(sort: BoardSort, limit = 100): Promise<BoardEntry[]> {
  const rows = await rpc<Array<Record<string, unknown>>>('leaderboard', { sort: SORT_PARAM[sort], lim: limit });
  return (rows ?? []).map(boardRow).filter((e): e is BoardEntry => !!e);
}

export async function fetchRank(id: string): Promise<{ rank: number; total: number }> {
  const r = await rpc<{ rank: number; total: number }>('player_rank', { pid: id });
  return { rank: Math.max(1, Number(r?.rank) || 1), total: Math.max(0, Number(r?.total) || 0) };
}

/** Sale del ranking: borra la cuenta del servidor y la de este navegador. */
export async function deleteAccount(): Promise<void> {
  const st = loadState();
  if (st.account) await rpc<boolean>('delete_player', { pid: st.account.id, token: st.account.token });
  saveState({ account: null, queue: [] });
}

// ------------------------------------------------------------------ código de cuenta
const PREFIX = 'RBSIM1-';

export function accountCode(a: RankAccount): string {
  return PREFIX + btoa(`${a.id}.${a.token}`).replace(/=+$/, '');
}

export function parseAccountCode(code: string): { id: string; token: string } | null {
  const c = code.trim();
  if (!c.startsWith(PREFIX)) return null;
  try {
    const [id, tk] = atob(c.slice(PREFIX.length)).split('.');
    return UUID.test(id) && /^[0-9a-f]{32,128}$/.test(tk ?? '') ? { id, token: tk } : null;
  } catch {
    return null;
  }
}

/** Usa en este navegador una cuenta de otro dispositivo (se comprueba al renombrar). */
export async function useAccountCode(code: string, name: string): Promise<boolean> {
  const p = parseAccountCode(code);
  if (!p) return false;
  const n = name.trim().slice(0, 24) || 'Piloto';
  const ok = await rpc<boolean>('rename_player', { pid: p.id, token: p.token, name: n });
  if (!ok) return false;
  saveState({ account: { id: p.id, token: p.token, name: n }, queue: loadState().queue });
  return true;
}
