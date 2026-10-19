/** Pruebas del torneo: calendario, ranking (Tabla 10-1), alianzas y Playoffs. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  advancePlayoffs,
  createTournament,
  generateSchedule,
  rankings,
  selectAlliances,
  simulateMatch,
  startPlayoffs,
  type TeamEntry,
} from '../src/core/tournament';

const pool = Array.from({ length: 12 }, (_, i) => ({ team: 100 + i, specId: 'balanced', name: `T${i}`, strength: (i + 1) / 12 }));

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
