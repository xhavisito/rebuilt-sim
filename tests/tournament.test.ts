/** Pruebas del torneo: calendario, ranking (Tabla 10-1), alianzas y Playoffs. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  advancePlayoffs,
  aiAccepts,
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

  it('alianzas serpentina y bracket hasta campeón (final al mejor de 3)', () => {
    const player: TeamEntry = { team: 9999, specId: 'x', name: 'P', strength: 0.5, isPlayer: true };
    const t = createTournament(player, pool, 12, 4, 'regional', new Rng(1), 1);
    const rng = new Rng(9);
    for (const m of t.quals) m.result = simulateMatch(t.teams, m, 'regional', rng);
    t.alliances = selectAlliances(t, rankings(t, new Rng(3)));
    expect(t.alliances.every((a) => a.length === 3)).toBe(true);
    expect(new Set(t.alliances.flat()).size).toBe(12);
    startPlayoffs(t);
    for (let k = 0; k < 10 && t.champion === null; k++) {
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
        const ok = guard === 0 ? false : aiAccepts(t, team, a, rng); // el primero rechaza
        respondInvite(t, team, a, ok);
        if (!t.selection!.log[t.selection!.log.length - 1].accepted) declines++;
        if (n === 18 && !ok) expect(availableTeams(t)).not.toContain(team);
      }
      finishSelection(t);
      expect(declines).toBeGreaterThanOrEqual(n === 18 ? 1 : 0);
      // sin equipos de sobra nadie rechaza
      if (n === 12) expect(declines).toBe(0);
      expect(t.alliances!.every((al) => al.length === 3)).toBe(true);
      expect(new Set(t.alliances!.flat()).size).toBe(12);
      if (n === 18) expect(t.selection!.declined.some((d) => t.alliances!.flat().includes(d))).toBe(false);
      expect(t.playoffs.length).toBe(2);
    });
});
