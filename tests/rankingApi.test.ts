import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchInput, RobotLine } from '../src/core/stats';

const URL_ = 'https://abc.supabase.co';
const ID = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';

async function api() {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', URL_);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  return import('../src/net/rankingApi');
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const line = (o: Partial<RobotLine>): RobotLine => ({
  specId: 'cad-1678', name: 'Limestone', team: 1678, alliance: 'blue', human: false, fuel: 30, shots: 40, passes: 2, intaked: 50,
  cycles: 5, tower: 25, level: 1, foulPts: 5, defense: 0, distance: 100, ...o,
});
const input = (mode = 'match'): MatchInput => ({
  ts: Date.UTC(2026, 9, 23, 12),
  mode,
  difficulty: 'hard',
  score: { red: 70, blue: 95 },
  rp: 3,
  robots: [line({ human: true }), line({ alliance: 'red', human: true }), line({ alliance: 'red' }), line({ alliance: 'red' })],
  me: 0,
});

describe('ranking con backend', () => {
  it('arma el envío del match desde el punto de vista del jugador', async () => {
    const { submission } = await api();
    const s = submission(input())!;
    expect(s).toMatchObject({ mode: 'match', difficulty: 'hard', score: 95, opp_score: 70, fuel: 30, shots: 40, tower: 25, level: 1, foul_pts: 5, opp_humans: 1, opp_count: 3, team: 1678 });
    expect(s.played_at).toBe('2026-10-23T12:00:00.000Z');
    expect(submission(input('practice'))).toBeNull();
  });

  it('código de cuenta ida y vuelta; rechaza basura', async () => {
    const { accountCode, parseAccountCode } = await api();
    const tk = 'ab'.repeat(24);
    const code = accountCode({ id: ID, token: tk, name: 'X' });
    expect(parseAccountCode(` ${code} `)).toEqual({ id: ID, token: tk });
    expect(parseAccountCode('RBSIM1-nope')).toBeNull();
    expect(parseAccountCode('hola')).toBeNull();
  });

  it('valida y acota las filas del ranking', async () => {
    const { boardRow } = await api();
    expect(boardRow({ id: ID, name: 'Xhavi', matches: 3, rating: 9999, accuracy: 3, wins: 10 })).toMatchObject({ rating: 4000, accuracy: 1, wins: 3 });
    expect(boardRow({ id: 'x', name: 'Xhavi', matches: 3 })).toBeNull();
    expect(boardRow({ id: ID, name: '', matches: 3 })).toBeNull();
  });

  it('crea la cuenta con el primer match, manda la cola y descarta lo que el servidor rechaza', async () => {
    const calls: Array<{ fn: string; body: Record<string, unknown> }> = [];
    let online = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!online) throw new TypeError('network');
      const fn = url.split('/').pop()!;
      const body = JSON.parse(String(init.body));
      calls.push({ fn, body });
      const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (fn === 'register_player') return ok(ID);
      if (fn === 'submit_match') {
        const m = body.m as { fuel: number };
        if (m.fuel > 600) return new Response(JSON.stringify({ message: 'fuel', code: 'P0001' }), { status: 400 });
        return ok({ rating: 1230, delta: 30, matches: 1 });
      }
      return ok(true);
    });
    const { submitMatch, submission, pendingMatches, rankAccount, flush } = await api();
    // sin conexión: queda en la cola
    await expect(submitMatch(submission(input()), 'Xhavi')).rejects.toThrow();
    expect(pendingMatches()).toBe(1);
    expect(rankAccount()).toBeNull();
    // un match imposible también espera en la cola, y al volver la conexión se descarta
    const bad = { ...submission(input())!, fuel: 9999 };
    await submitMatch(bad, 'Xhavi').catch(() => {});
    online = true;
    const r = await flush('Xhavi');
    expect(r).toEqual({ rating: 1230, delta: 30, matches: 1 });
    expect(pendingMatches()).toBe(0);
    expect(rankAccount()?.id).toBe(ID);
    expect(calls.map((c) => c.fn)).toEqual(['register_player', 'submit_match', 'submit_match']);
    // cada envío lleva el token de la cuenta recién creada
    expect(calls[1].body.token).toBe(rankAccount()!.token);
    // sin pendientes no se llama al servidor
    calls.length = 0;
    expect(await flush('Xhavi')).toBeNull();
    expect(calls.length).toBe(0);
  });
});
