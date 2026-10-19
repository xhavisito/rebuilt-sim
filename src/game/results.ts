/** Datos de la pantalla de resultados (puros, a partir de la sesión terminada). */
import { FOUL_POINTS, type CardRecord, type FoulRecord } from '../core/fouls';
import type { RpResult } from '../core/rp';
import type { Alliance } from '../core/types';
import type { GameSession } from './GameSession';

export interface AllianceResult {
  autoFuel: number;
  teleopFuel: number;
  wastedFuel: number;
  towerAuto: number;
  towerTeleop: number;
  foulPoints: number;
  minorCommitted: number;
  majorCommitted: number;
  total: number;
  rp: RpResult;
  teams: Array<{ index: number; team: number; name: string; dq: boolean; isPlayer: boolean; level: number }>;
}

export interface MatchResults {
  winner: Alliance | 'tie';
  red: AllianceResult;
  blue: AllianceResult;
  fouls: FoulRecord[];
  cards: CardRecord[];
  history: Array<{ t: number; red: number; blue: number }>;
  mvp: { index: number; team: number; name: string; alliance: Alliance; fuel: number; tower: number; fouls: number; score: number } | null;
  playerAlliance: Alliance | null;
  eventType: string;
  teamOf: (robot: number) => number;
}

export function buildResults(s: GameSession): MatchResults | null {
  const m = s.match;
  if (!m) return null;
  const robotsOf = (a: Alliance) => s.robots.filter((r) => r.alliance === a);
  const playoffDq = (a: Alliance) => m.allianceDisqualified(a, (x) => robotsOf(x).map((r) => r.index));
  const per = (a: Alliance): AllianceResult => {
    const fouls = m.fouls.filter((f) => f.offender === a);
    const playerHere = robotsOf(a).some((r) => r.isPlayer);
    const playerDq = robotsOf(a).some((r) => r.isPlayer && m.disqualified.has(r.index));
    return {
      autoFuel: m.fuel[a].auto,
      teleopFuel: m.fuel[a].teleop,
      wastedFuel: m.fuel[a].wasted,
      towerAuto: m.tower[a].auto,
      towerTeleop: m.tower[a].teleop,
      foulPoints: m.foulPointsFor(a),
      minorCommitted: fouls.filter((f) => f.severity === 'MINOR').length,
      majorCommitted: fouls.filter((f) => f.severity === 'MAJOR').length,
      total: playoffDq(a) ? 0 : m.score(a),
      // RP del equipo del jugador (si está descalificado, 0 RP en Qualification)
      rp: m.rp(a, playerHere && playerDq),
      teams: robotsOf(a).map((r) => ({
        index: r.index,
        team: r.spec.teamNumber,
        name: r.spec.name,
        dq: m.disqualified.has(r.index),
        isPlayer: r.isPlayer,
        level: r.towerResult.level,
      })),
    };
  };
  const red = per('red');
  const blue = per('blue');
  // MVP: FUEL anotado + puntos de TOWER − puntos regalados en faltas
  let mvp: MatchResults['mvp'] = null;
  for (const r of s.robots) {
    const foulPts = m.fouls.filter((f) => f.robot === r.index).reduce((acc, f) => acc + FOUL_POINTS[f.severity], 0);
    const score = r.stats.fuelScored + r.stats.towerPts - foulPts;
    if (!mvp || score > mvp.score)
      mvp = { index: r.index, team: r.spec.teamNumber, name: r.spec.name, alliance: r.alliance, fuel: r.stats.fuelScored, tower: r.stats.towerPts, fouls: foulPts, score };
  }
  const winner = red.total === blue.total ? 'tie' : red.total > blue.total ? 'red' : 'blue';
  const history = [...m.history, { t: m.t, red: m.score('red'), blue: m.score('blue') }];
  return {
    winner,
    red,
    blue,
    fouls: m.fouls,
    cards: m.cards,
    history,
    mvp,
    playerAlliance: s.playerRobot(0)?.alliance ?? null,
    eventType: m.eventType,
    teamOf: (i) => s.robots[i]?.spec.teamNumber ?? 0,
  };
}
