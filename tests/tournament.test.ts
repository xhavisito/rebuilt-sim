/** Pruebas del torneo: calendario, ranking (Tabla 10-1), alianzas y Playoffs. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  advancePlayoffs,
  carriedYellows,
  recordCards,
  aiAccepts,
  allianceIndexOf,
  bracketState,
  DOUBLE_ELIM_8,
  migrateTournament,
  placements,
  playoffWinner,
  type TMatch,
  type Tournament,
  aiPick,
  availableTeams,
  beginSelection,
  CATEGORIES,
  categoryRankings,
  finishSelection,
  respondInvite,
  selectionTurn,
  createTournament,
  generateSchedule,
  rankings,
  selectAlliances,
  simulateMatch,
  startPlayoffs,
  type TeamEntry,
} from '../src/core/tournament';

const pool = Array.from({ length: 12 }, (_, i) => ({ team: 100 + i, specId: 'cad-1678', name: `T${i}`, strength: (i + 1) / 12 }));

describe('torneo', () => {
  it('calendario: cada equipo juega casi el mismo número de matches, 3 vs 3 sin repetir equipo', () => {
    const s = generateSchedule(12, 6, new Rng(5));
    const count = new Array(12).fill(0);
    for (const m of s) {
      expect(new Set([...m.red, ...m.blue]).size).toBe(6);
      for (const t of [...m.red, ...m.blue]) count[t]++;
    }
    expect(Math.max(...count) - Math.min(...count)).toBeLessThanOrEqual(1);
  });

  it('ranking por Ranking Score y desempates de la Tabla 10-1', () => {
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pool, 12, 4, 'regional', new Rng(1), 1);
    const rng = new Rng(2);
    for (const m of t.quals) m.result = simulateMatch(t.teams, m, 'regional', rng);
    const r = rankings(t, new Rng(3));
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1];
      const b = r[i];
      expect(a.rs > b.rs || (a.rs === b.rs && a.avgNoFoul >= b.avgNoFoul)).toBe(true);
    }
    // RS redondeado a 2 decimales
    for (const row of r) expect(Math.round(row.rs * 100) / 100).toBe(row.rs);
  });

  it('YELLOW CARDS: se acumulan en Qualifications y no pasan a los Playoffs', () => {
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pool, 12, 4, 'regional', new Rng(1), 1);
    const [q1] = t.quals;
    const team = q1.blue[1];
    recordCards(t, q1, [4]); // posición 4 = azul 2
    expect(t.yellows).toEqual([team]);
    const next = t.quals.find((m) => m !== q1 && [...m.red, ...m.blue].includes(team))!;
    expect(carriedYellows(t, next)).toEqual([[...next.red, ...next.blue].indexOf(team)]);
    // en Playoffs ni se cargan ni se anotan
    const po: TMatch = { ...next, kind: 'playoff' } as TMatch;
    expect(carriedYellows(t, po)).toEqual([]);
    recordCards(t, po, [0]);
    expect(t.yellows).toEqual([team]);
  });

  it('alianzas serpentina y bracket hasta campeón (final al mejor de 3)', () => {
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pool, 12, 4, 'regional', new Rng(1), 1);
    const rng = new Rng(9);
    for (const m of t.quals) m.result = simulateMatch(t.teams, m, 'regional', rng);
    t.alliances = selectAlliances(t, rankings(t, new Rng(3)));
    expect(t.alliances.every((a) => a.length === 3)).toBe(true);
    expect(new Set(t.alliances.flat()).size).toBe(12);
    startPlayoffs(t);
    for (let k = 0; k < 40 && t.champion === null; k++) {
      for (const m of t.playoffs) if (!m.result) m.result = simulateMatch(t.teams, m, 'regional', rng);
      advancePlayoffs(t);
    }
    expect(t.champion).not.toBeNull();
    const finals = t.playoffs.filter((m) => m.kind === 'final');
    expect(finals.length).toBeGreaterThanOrEqual(2);
    expect(finals.length).toBeLessThanOrEqual(3);
  });
});

describe('torneo: categorías y selección con aceptar / rechazar', () => {
  const mk = (n = 12) => {
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pool, n, 4, 'regional', new Rng(1), 1);
    t.teams.forEach((tm, i) => (tm.traits = { scoring: tm.strength, defense: i % 3 === 0 ? 0.9 : 0.3, passing: i % 4 === 0 ? 0.8 : 0.3, driving: 0.5 }));
    const rng = new Rng(4);
    for (const m of t.quals) m.result = simulateMatch(t.teams, m, 'regional', rng);
    return t;
  };

  it('ranking por categoría: promedio por match, de mayor a menor', () => {
    const t = mk();
    for (const c of CATEGORIES) {
      const rows = categoryRankings(t, c);
        expect(rows.length).toBe(12);
      for (let i = 1; i < rows.length; i++) expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value);
      expect(rows.every((r) => r.played > 0)).toBe(true);
    }
    // los buenos defensores encabezan la defensa
    const top = categoryRankings(t, 'defense').slice(0, 3).map((r) => t.teams[r.team].traits!.defense);
    expect(top.every((d) => d > 0.5)).toBe(true);
  });

  for (const n of [12, 18])
    it(`${n} equipos: el que rechaza ya no puede ser elegido (salvo que falten) y las alianzas se completan`, () => {
      const t = mk(n);
      beginSelection(t, rankings(t, new Rng(3)));
      const rng = new Rng(11);
      let declines = 0;
      for (let guard = 0; guard < 60; guard++) {
        const a = selectionTurn(t);
        if (a === null) break;
        const team = aiPick(t, a);
        const captain = t.selection!.alliances.some((al) => al[0] === team);
        // el primer equipo invitado (no capitán) rechaza
        const ok = !captain && !t.selection!.log.some((l) => !l.accepted) ? false : aiAccepts(t, team, a, rng);
        respondInvite(t, team, a, ok);
        if (!t.selection!.log[t.selection!.log.length - 1].accepted && !captain) declines++;
        if (n === 18 && !ok) expect(availableTeams(t)).not.toContain(team);
      }
      finishSelection(t);
      expect(declines).toBeGreaterThanOrEqual(n === 18 ? 1 : 0);
      // sin equipos de sobra nadie rechaza (salvo un capitán, que sigue con su alianza)
      if (n === 12) expect(declines).toBe(0);
      expect(t.alliances!.every((al) => al.length === 3)).toBe(true);
      expect(new Set(t.alliances!.flat()).size).toBe(12);
      if (n === 18) expect(t.selection!.declined.some((d) => t.alliances!.flat().slice(1).includes(d) && !t.alliances!.some((al) => al[0] === d))).toBe(false);
      expect(t.playoffs.length).toBe(2);
    });
});

describe('torneo: Playoffs de doble eliminación', () => {
  const big = (n: number, seed = 1) => {
    const pl = Array.from({ length: n }, (_, i) => ({ team: 1000 + i, specId: 'cad-1678', name: `T${i}`, strength: ((i * 37) % n) / n }));
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pl, n, 6, 'regional', new Rng(seed), seed);
    const rng = new Rng(seed + 1);
    for (const m of t.quals) m.result = simulateMatch(t.teams, m, 'regional', rng);
    return t;
  };
  const runSelection = (t: Tournament, rng: Rng) => {
    beginSelection(t, rankings(t, new Rng(3)));
    for (let guard = 0; guard < 200; guard++) {
      const a = selectionTurn(t);
      if (a === null) break;
      const team = aiPick(t, a);
      respondInvite(t, team, a, aiAccepts(t, team, a, rng));
    }
    finishSelection(t);
  };
  const playOut = (t: Tournament, rng: Rng) => {
    for (let k = 0; k < 100 && t.champion === null; k++) {
      const m = t.playoffs.find((x) => !x.result);
      if (m) m.result = simulateMatch(t.teams, m, 'regional', rng);
      advancePlayoffs(t);
    }
  };

  for (const n of [24, 32, 40])
    it(`${n} equipos: 8 alianzas de 3 sin repetir equipos`, () => {
      const t = big(n);
      runSelection(t, new Rng(5));
      expect(t.alliances!.length).toBe(8);
      expect(t.alliances!.every((a) => a.length === 3)).toBe(true);
      expect(new Set(t.alliances!.flat()).size).toBe(24);
      // primer round: 1v8, 4v5, 2v7, 3v6
      expect(t.playoffs.map((m) => [allianceIndexOf(t, m.red) + 1, allianceIndexOf(t, m.blue) + 1])).toEqual([
        [1, 8],
        [4, 5],
        [2, 7],
        [3, 6],
      ]);
    });

  for (const seed of [1, 2, 3, 4, 5, 6])
    it(`doble eliminación (semilla ${seed}): nadie queda fuera con una sola derrota y hay campeón`, () => {
      const t = big(32, seed);
      runSelection(t, new Rng(seed * 7));
      playOut(t, new Rng(seed * 13));
      expect(t.champion).not.toBeNull();
      const losses = new Map<number, number>();
      for (const m of t.playoffs.filter((x) => x.kind === 'playoff')) {
        const w = playoffWinner(m);
        if (!w) continue;
        const l = allianceIndexOf(t, m[w === 'red' ? 'blue' : 'red']);
        losses.set(l, (losses.get(l) ?? 0) + 1);
      }
      // 13 matches del bracket (más repeticiones por empate) y 2–3 de Final
      expect(new Set(t.playoffs.filter((x) => x.kind === 'playoff').map((m) => m.slot)).size).toBe(13);
      const finals = t.playoffs.filter((m) => m.kind === 'final');
      expect(finals.length).toBeGreaterThanOrEqual(2);
      const pl = placements(t);
      expect(pl.size).toBe(8);
      expect(pl.get(t.champion!)).toBe(1);
      // los eliminados en el bracket perdieron 2 veces; el que llega a la Final por la llave superior, ninguna
      for (const [a, place] of pl) if (place >= 3) expect(losses.get(a)).toBe(2);
      const st = bracketState(t);
      expect(losses.get(st.finalists.red!) ?? 0).toBe(0);
      expect(losses.get(st.finalists.blue!)).toBe(1);
      expect([...pl.values()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    });

  it('4 alianzas: 5 matches de doble eliminación y Final', () => {
    const t = big(12);
    runSelection(t, new Rng(2));
    playOut(t, new Rng(3));
    expect(t.champion).not.toBeNull();
    expect(new Set(t.playoffs.filter((x) => x.kind === 'playoff').map((m) => m.slot)).size).toBe(5);
    expect([...placements(t).values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it('un empate total se repite; un empate en puntos se desempata con la Tabla 10-1', () => {
    const t = big(24);
    t.alliances = selectAlliances(t, rankings(t, new Rng(3)));
    startPlayoffs(t);
    const res = (score: number, noFoul: number) => ({ score, noFoul, autoFuel: 10, tower: 10, rp: 0 });
    const m1 = t.playoffs[0];
    m1.result = { red: res(100, 90), blue: res(100, 90) };
    expect(playoffWinner(m1)).toBeNull();
    advancePlayoffs(t);
    const replay = t.playoffs.find((m) => m.id === 'M1-R1') as TMatch;
    expect(replay).toBeDefined();
    replay.result = { red: res(100, 80), blue: res(100, 95) };
    expect(playoffWinner(replay)).toBe('blue');
    for (const m of t.playoffs.filter((x) => ['M2', 'M3', 'M4'].includes(x.id))) m.result = { red: res(120, 120), blue: res(80, 80) };
    advancePlayoffs(t);
    // M5 = perdedores de M1 (alianza 1) y M2 (alianza 5)
    const m5 = t.playoffs.find((m) => m.id === 'M5')!;
    expect([allianceIndexOf(t, m5.red), allianceIndexOf(t, m5.blue)]).toEqual([0, 4]);
    const m7 = t.playoffs.find((m) => m.id === 'M7')!;
    expect([allianceIndexOf(t, m7.red), allianceIndexOf(t, m7.blue)]).toEqual([7, 3]);
  });

  it('un capitán puede invitar a otro capitán: las alianzas de abajo suben y entra el siguiente del ranking', () => {
    const t = big(24);
    const rk = rankings(t, new Rng(3));
    beginSelection(t, rk);
    expect(availableTeams(t)).toContain(rk[1].team);
    respondInvite(t, rk[1].team, 0, true);
    const s = t.selection!;
    expect(s.alliances[0]).toEqual([rk[0].team, rk[1].team]);
    expect(s.alliances[1][0]).toBe(rk[2].team);
    expect(s.alliances.length).toBe(8);
    expect(s.alliances[7][0]).toBe(rk[8].team);
    // un capitán que rechaza sigue siendo capitán, pero ya no se le puede invitar
    respondInvite(t, rk[3].team, 1, false);
    expect(s.alliances[2][0]).toBe(rk[3].team);
    expect(availableTeams(t)).not.toContain(rk[3].team);
    // en la ronda 2 ya no se puede invitar capitanes
    for (let g = 0; g < 100 && selectionTurn(t) !== null; g++) {
      const a = selectionTurn(t)!;
      if (s.turn >= 8) expect(availableTeams(t).some((i) => s.alliances.some((al) => al[0] === i))).toBe(false);
      respondInvite(t, aiPick(t, a), a, true);
    }
    finishSelection(t);
    expect(new Set(t.alliances!.flat()).size).toBe(24);
  });

  it('la ronda 3 cruza perdedores para no repetir enfrentamientos', () => {
    const m9 = DOUBLE_ELIM_8.slots.find((s) => s.n === 9)!;
    expect(m9.red).toEqual({ l: 7 });
    expect(m9.blue).toEqual({ w: 6 });
  });

  it('torneo guardado con semifinales: se rehace el bracket', () => {
    const t = big(12);
    t.alliances = selectAlliances(t, rankings(t, new Rng(3)));
    t.playoffs = [{ id: 'SF1', kind: 'semi' as TMatch['kind'], red: t.alliances[0], blue: t.alliances[3] }];
    migrateTournament(t);
    expect(t.playoffs.map((m) => m.id)).toEqual(['M1', 'M2']);
  });
});
