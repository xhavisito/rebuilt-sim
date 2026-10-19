/**
 * Ranking Points (Tabla 6-4 y 6-5). Win = 3, Tie = 1, y BONUS RP:
 * ENERGIZED / SUPERCHARGED por FUEL en HUB activo, TRAVERSAL por puntos de TOWER.
 */
import type { EventType } from './types';

export const RP_THRESHOLDS: Record<EventType, { energized: number; supercharged: number; traversal: number }> = {
  regional: { energized: 100, supercharged: 360, traversal: 50 },
  districtChamp: { energized: 240, supercharged: 360, traversal: 50 },
  champs: { energized: 360, supercharged: 500, traversal: 50 },
};

export interface RpInput {
  /** FUEL anotado en HUB activo (AUTO + TELEOP). */
  fuel: number;
  /** Puntos de TOWER del match (AUTO + TELEOP). */
  towerPoints: number;
  /** Puntos totales del match (incluye faltas del rival). */
  score: number;
  opponentScore: number;
}

export interface RpResult {
  win: number;
  energized: boolean;
  supercharged: boolean;
  traversal: boolean;
  total: number;
}

export function rankingPoints(r: RpInput, ev: EventType, disqualified = false): RpResult {
  const th = RP_THRESHOLDS[ev];
  const win = r.score > r.opponentScore ? 3 : r.score === r.opponentScore ? 1 : 0;
  const energized = r.fuel >= th.energized;
  const supercharged = r.fuel >= th.supercharged;
  const traversal = r.towerPoints >= th.traversal;
  const total = disqualified ? 0 : win + (energized ? 1 : 0) + (supercharged ? 1 : 0) + (traversal ? 1 : 0);
  return { win, energized, supercharged, traversal, total };
}
