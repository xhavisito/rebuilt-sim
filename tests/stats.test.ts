import { describe, expect, it } from 'vitest';
import {
  BOARD_VERSION,
  boardEntry,
  eloUpdate,
  HISTORY_MAX,
  newStore,
  opponentRating,
  parseBoardEntry,
  recordMatch,
  reviveStore,
  RATING_START,
  sortBoard,
  summarize,
  type MatchInput,
  type RobotLine,
} from '../src/core/stats';

const line = (o: Partial<RobotLine>): RobotLine => ({
  specId: 'cad-1678',
  name: '1678',
  team: 1678,
  alliance: 'blue',
  human: false,
  fuel: 0,
  shots: 0,
  passes: 0,
  intaked: 0,
  cycles: 0,
  tower: 0,
  level: 0,
  foulPts: 0,
  defense: 0,
  distance: 0,
  ...o,
});

const match = (blue: number, red: number, me: Partial<RobotLine> = {}, mode = 'match', difficulty = 'normal'): MatchInput => ({
  ts: 1000,
  mode,
  difficulty,
  score: { red, blue },
  rp: blue > red ? 3 : 0,
  robots: [line({ human: true, fuel: 40, shots: 50, cycles: 5, tower: 15, level: 1, foulPts: 5, ...me }), line({ specId: 'cad-254', name: '254', team: 254, alliance: 'red', fuel: 30, shots: 30 })],
  me: 0,
});

describe('estadísticas', () => {
  it('acumula al jugador, por robot y a todos los robots', () => {
    const st = newStore('abcdefgh1234');
    const rec = recordMatch(st, match(80, 60));
    expect(rec?.outcome).toBe('W');
    expect(st.me.matches).toBe(1);
    expect(st.me.points).toBe(40 + 15 - 5);
    expect(st.mine['cad-1678'].matches).toBe(1);
    expect(st.robots['cad-254'].matches).toBe(1);
    expect(st.robots['cad-254'].wins).toBe(0);
    const s = summarize(st.me);
    expect(s.accuracy).toBeCloseTo(0.8);
    expect(s.perCycle).toBe(8);
    expect(s.climbRate).toBe(1);
  });

  it('rating Elo: sube al ganar, baja al perder, empate contra igual no se mueve', () => {
    expect(eloUpdate(1200, 1200, 1, 20)).toBe(1212);
    expect(eloUpdate(1200, 1200, 0, 20)).toBe(1188);
    expect(eloUpdate(1200, 1200, 0.5, 20)).toBe(1200);
    // ganarle a alguien más fuerte vale más
    expect(eloUpdate(1200, 1550, 1, 20) - 1200).toBeGreaterThan(eloUpdate(1200, 950, 1, 20) - 1200);
    expect(opponentRating([{ human: true }, { human: false }], 'einstein')).toBe((RATING_START + 1550) / 2);
  });

  it('el rating solo cuenta en modos con reglas y el historial tiene tope', () => {
    const st = newStore('abcdefgh1234');
    recordMatch(st, match(10, 5, {}, 'practice'));
    expect(st.rating).toBe(RATING_START);
    for (let k = 0; k < HISTORY_MAX + 5; k++) recordMatch(st, match(10, 5));
    expect(st.history.length).toBe(HISTORY_MAX);
    expect(st.rating).toBeGreaterThan(RATING_START);
    expect(st.peak).toBe(st.rating);
  });

  it('sin robot del jugador solo registra los robots', () => {
    const st = newStore('abcdefgh1234');
    expect(recordMatch(st, { ...match(1, 2), me: -1 })).toBeNull();
    expect(st.me.matches).toBe(0);
    expect(Object.keys(st.robots).length).toBe(2);
  });

  it('reviveStore tolera datos dañados', () => {
    expect(reviveStore(null).v).toBe(1);
    expect(reviveStore({ v: 9 }).me.matches).toBe(0);
    const st = newStore('abcdefgh1234');
    recordMatch(st, match(80, 60));
    expect(reviveStore(JSON.parse(JSON.stringify(st))).me.matches).toBe(1);
  });
});

describe('ranking global', () => {
  const now = 1_800_000_000_000;
  const entry = () => {
    const st = newStore('abcdefgh1234');
    recordMatch(st, match(80, 60));
    return JSON.stringify({ v: BOARD_VERSION, ...boardEntry(st, 'Xhavi', now) });
  };

  it('acepta un resumen válido', () => {
    const e = parseBoardEntry('abcdefgh1234', entry(), now);
    expect(e?.name).toBe('Xhavi');
    expect(e?.matches).toBe(1);
    expect(e?.robot).toBe('1678');
  });

  it('rechaza id que no coincide, versión, viejos, vacíos y basura; acota los números', () => {
    expect(parseBoardEntry('otroid123456', entry(), now)).toBeNull();
    expect(parseBoardEntry('abcdefgh1234', entry().replace(`"v":${BOARD_VERSION}`, '"v":99'), now)).toBeNull();
    expect(parseBoardEntry('abcdefgh1234', entry(), now + 200 * 86_400_000)).toBeNull();
    expect(parseBoardEntry('abcdefgh1234', '', now)).toBeNull();
    expect(parseBoardEntry('abcdefgh1234', '{nope', now)).toBeNull();
    expect(parseBoardEntry('../x', entry(), now)).toBeNull();
    const big = JSON.parse(entry());
    big.rating = 1e9;
    big.accuracy = 7;
    big.wins = 50;
    big.name = '  <b>' + 'x'.repeat(60);
    const e = parseBoardEntry('abcdefgh1234', JSON.stringify(big), now)!;
    expect(e.rating).toBe(4000);
    expect(e.accuracy).toBe(1);
    expect(e.wins).toBe(1);
    expect(e.name.length).toBe(24);
  });

  it('ordena; la precisión necesita 3 matches', () => {
    const base = parseBoardEntry('abcdefgh1234', entry(), now)!;
    const a = { ...base, id: 'a', rating: 1300, accuracy: 1, matches: 1 };
    const b = { ...base, id: 'b', rating: 1250, accuracy: 0.7, matches: 5 };
    expect(sortBoard([b, a], 'rating').map((e) => e.id)).toEqual(['a', 'b']);
    expect(sortBoard([a, b], 'accuracy').map((e) => e.id)).toEqual(['b', 'a']);
  });
});
