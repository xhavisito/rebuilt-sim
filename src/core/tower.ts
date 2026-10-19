/**
 * Puntos de TOWER (§6.5.2, Tabla 6-4).
 * AUTO: solo LEVEL 1 = 15 pts, máximo 2 robots por alianza; se evalúa al llegar a 0:00.
 * TELEOP: un solo nivel por robot, L1/L2/L3 = 10/20/30; se evalúa 3 s después de 0:00 o
 * cuando todos los robots están en reposo. Un robot que trepó en AUTO puede volver a cobrar en TELEOP.
 */
import * as F from '../config/field';
import type { Alliance, TowerLevel } from './types';

export const TOWER_POINTS = {
  autoL1: 15,
  autoMaxRobots: 2,
  teleop: { 1: 10, 2: 20, 3: 30 } as Record<1 | 2 | 3, number>,
};

/** Estado físico de un robot para evaluar su nivel. */
export interface ClimbSnapshot {
  robot: number;
  alliance: Alliance;
  /** ¿Toca la alfombra o la TOWER BASE? */
  touchingFloorOrBase: boolean;
  /** Altura del borde inferior de las cubiertas de los BUMPERS (m). */
  bumperBottom: number;
  /** ¿Toca al menos un RUNG o UPRIGHT de SU TOWER? */
  touchingOwnRungOrUpright: boolean;
  /** ¿Toca algo además de TOWER WALL, estructura de soporte, FUEL u otro robot? */
  touchingIllegal: boolean;
  /** G414: lo carga por completo un compañero. */
  ineligible: boolean;
  /** G420: el árbitro le otorgó LEVEL 3. */
  g420Level3: boolean;
}

/** Nivel alcanzado según los criterios del §6.5.2. */
export function levelOf(s: ClimbSnapshot): TowerLevel {
  if (s.ineligible) return 0;
  if (s.g420Level3) return 3;
  if (!s.touchingOwnRungOrUpright || s.touchingIllegal) return 0;
  if (s.touchingFloorOrBase) return 0;
  const lowTop = F.RUNG_HEIGHTS.LOW + F.RUNG_OD / 2;
  const midTop = F.RUNG_HEIGHTS.MID + F.RUNG_OD / 2;
  if (s.bumperBottom > midTop) return 3;
  if (s.bumperBottom > lowTop) return 2;
  return 1;
}

export interface TowerResult {
  perRobot: Map<number, { level: TowerLevel; points: number }>;
  byAlliance: Record<Alliance, number>;
}

/** AUTO: L1 (o más alto) cuenta como L1 = 15; máximo 2 robots por alianza. */
export function scoreAutoTower(snaps: ClimbSnapshot[]): TowerResult {
  const perRobot = new Map<number, { level: TowerLevel; points: number }>();
  const byAlliance: Record<Alliance, number> = { red: 0, blue: 0 };
  const counted: Record<Alliance, number> = { red: 0, blue: 0 };
  for (const s of snaps) {
    const lvl = levelOf(s) >= 1 ? 1 : 0;
    let pts = 0;
    if (lvl === 1 && counted[s.alliance] < TOWER_POINTS.autoMaxRobots) {
      counted[s.alliance]++;
      pts = TOWER_POINTS.autoL1;
    }
    perRobot.set(s.robot, { level: lvl as TowerLevel, points: pts });
    byAlliance[s.alliance] += pts;
  }
  return { perRobot, byAlliance };
}

/** TELEOP: cada robot cobra un solo nivel (el que tiene al evaluarse). */
export function scoreTeleopTower(snaps: ClimbSnapshot[]): TowerResult {
  const perRobot = new Map<number, { level: TowerLevel; points: number }>();
  const byAlliance: Record<Alliance, number> = { red: 0, blue: 0 };
  for (const s of snaps) {
    const lvl = levelOf(s);
    const pts = lvl === 0 ? 0 : TOWER_POINTS.teleop[lvl];
    perRobot.set(s.robot, { level: lvl, points: pts });
    byAlliance[s.alliance] += pts;
  }
  return { perRobot, byAlliance };
}
