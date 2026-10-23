/**
 * Estadísticas guardadas del jugador (localStorage): al terminar cada match la App registra el
 * desempeño de todos los robots y el del jugador (slot 0; en línea, el robot propio).
 */
import { loadJSON, saveJSON } from '../config/settings';
import { FOUL_POINTS } from '../core/fouls';
import { recordMatch, reviveStore, type MatchInput, type MatchRecord, type RobotLine, type StatsStore } from '../core/stats';
import type { GameSession } from './GameSession';

const KEY = 'rebuilt-sim.stats.v1';

export const loadStats = (): StatsStore => reviveStore(loadJSON<unknown>(KEY, null));
export const saveStats = (st: StatsStore): void => saveJSON(KEY, st);

/** Lo que dejó el match en la sesión (null si no hubo match con reglas). */
export function matchInput(s: GameSession, now = Date.now()): MatchInput | null {
  const m = s.match;
  if (!m || s.cfg.training) return null;
  const robotsOf = (a: 'red' | 'blue') => s.robots.filter((r) => r.alliance === a).map((r) => r.index);
  const score = {
    red: m.allianceDisqualified('red', robotsOf) ? 0 : m.score('red'),
    blue: m.allianceDisqualified('blue', robotsOf) ? 0 : m.score('blue'),
  };
  const robots: RobotLine[] = s.robots.map((r, i) => {
    const st = r.stats;
    return {
      specId: r.spec.id,
      name: r.spec.name,
      team: r.spec.teamNumber,
      alliance: r.alliance,
      human: r.isPlayer || !!s.cfg.robots[i]?.human,
      fuel: st.fuelScored,
      shots: Math.max(0, st.fuelShot - st.passes),
      passes: st.passes,
      intaked: st.intaked,
      cycles: st.cycles ?? 0,
      tower: st.towerPts,
      level: r.towerResult.level,
      foulPts: m.fouls.filter((f) => f.robot === r.index).reduce((acc, f) => acc + FOUL_POINTS[f.severity], 0),
      defense: Math.round(st.defenseSec),
      distance: Math.round(st.distance),
    };
  });
  const me = s.playerRobot(0);
  const dq = !!me && m.disqualified.has(me.index);
  return {
    ts: now,
    mode: s.cfg.mode,
    difficulty: s.cfg.aiDifficulty ?? 'normal',
    score,
    rp: me ? m.rp(me.alliance, dq).total : 0,
    robots,
    me: me ? s.robots.indexOf(me) : -1,
  };
}

const recorded = new WeakSet<GameSession>();

/** Registra el match una sola vez por sesión; devuelve el registro del jugador. */
export function recordSession(s: GameSession): { rec: MatchRecord | null; store: StatsStore } | null {
  if (recorded.has(s)) return null;
  const input = matchInput(s);
  if (!input) return null;
  recorded.add(s);
  const store = loadStats();
  const rec = recordMatch(store, input);
  saveStats(store);
  return { rec, store };
}
