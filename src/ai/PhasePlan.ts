/**
 * Plan del match por fases (las tablas del dashboard de estrategia): para cada robot de tu
 * alianza, su posición inicial y rutina de AUTO, su tarea con el HUB activo, su tarea con el HUB
 * inactivo (y a quién marca) y su nivel de TOWER en END GAME. Arranca con la sugerencia del
 * estratega / drive coach y el jugador lo edita a su gusto. Sin Three.js ni Rapier.
 */
import { routineZones, type AutoRoutine } from '../auto/AutoRoutine';
import { driverStationCenter } from '../config/field';
import type { MatchPlan } from './Strategist';
import { plan, type RobotPlan, type ShiftPlan } from './Strategy';

export interface PhaseRow {
  team: number;
  station: 1 | 2 | 3;
  isPlayer: boolean;
  /** Z de salida en el marco azul (m); null = frente a su DRIVER STATION. */
  startZ: number | null;
  /** Rutina de AUTO (id). */
  auto: string;
  /**
   * Tareas por SHIFT: [0] = SHIFT activo 1 e inactivo 1 (SHIFT 1–2), [1] = SHIFT activo 2 e
   * inactivo 2 (SHIFT 3–4). Cada uno con a quién marca si defiende.
   */
  windows: [ShiftPlan, ShiftPlan];
  /** Nivel de TOWER en END GAME (0 = anota hasta el final). */
  climb: 0 | 1 | 2 | 3;
  /** Nivel máximo que alcanza su robot. */
  maxClimb: 0 | 1 | 2 | 3;
}

/** Z (marco azul) de la DRIVER STATION: la salida de fábrica. */
export const defaultStartZ = (station: 1 | 2 | 3): number => driverStationCenter('blue', station).z;

/** La sugerencia del estratega (drive coach) como filas editables. */
export function suggestedRows(p: MatchPlan, maxClimb: Array<0 | 1 | 2 | 3>): PhaseRow[] {
  return p.orders.map((o, i) => ({
    team: o.team,
    station: o.station,
    isPlayer: o.isPlayer,
    startZ: null,
    auto: o.auto,
    windows: [0, 1].map(
      (): ShiftPlan => ({
        // el alimentador alimenta todo el match; los demás anotan con el HUB activo
        active: o.role === 'feeder' ? 'feed' : 'score',
        // con el HUB apagado nadie espera: el defensor marca, el alimentador pasa todo, el resto acapara
        inactive: o.role === 'defender' ? 'defend' : o.role === 'feeder' ? 'feed' : 'stockpile',
        defendTeam: o.defendTeam,
      }),
    ) as [ShiftPlan, ShiftPlan],
    climb: o.climb,
    maxClimb: maxClimb[i] ?? 0,
  }));
}

/** Filas → planes de la estrategia (DS 1, 2, 3) que siguen la IA y el drive coach. */
export function rowsToPlans(rows: PhaseRow[]): RobotPlan[] {
  return [1, 2, 3].map((ds) => {
    const r = rows.find((x) => x.station === ds);
    if (!r) return plan();
    const w = r.windows;
    const role = w.every((x) => x.inactive === 'defend') ? 'defender' : w.every((x) => x.active === 'feed' && x.inactive === 'feed') ? 'feeder' : 'scorer';
    return plan({ role, climb: r.climb, auto: r.auto, startZ: r.startZ, windows: structuredClone(w), active: w[0].active, inactive: w[0].inactive, defendTeam: w[0].defendTeam });
  });
}

/** Filas guardadas con el formato anterior (una sola tarea activa / inactiva) → por SHIFT. */
export function normalizeRow(r: PhaseRow & { active?: ShiftPlan['active']; inactive?: ShiftPlan['inactive']; defendTeam?: number | null }): PhaseRow {
  if (r.windows) return r;
  const s: ShiftPlan = { active: r.active ?? 'score', inactive: r.inactive ?? 'stockpile', defendTeam: r.defendTeam ?? null };
  const { active: _a, inactive: _i, defendTeam: _d, ...rest } = r;
  void _a;
  void _i;
  void _d;
  return { ...rest, windows: [{ ...s }, { ...s }] };
}

/** Choques de AUTO: para cada DS, las DS con las que comparte zona (DEPOT, TOWER, mitades…). */
export function autoConflicts(rows: PhaseRow[], routines: AutoRoutine[]): Map<number, number[]> {
  const zones = rows.map((r) => {
    const rt = routines.find((x) => x.id === r.auto);
    return new Set(rt ? routineZones(rt) : []);
  });
  const out = new Map<number, number[]>();
  rows.forEach((r, i) => {
    const hits = rows.flatMap((o, j) => (j !== i && [...zones[i]].some((z) => zones[j].has(z)) ? [o.station] : []));
    if (hits.length) out.set(r.station, hits);
  });
  return out;
}

/** Puntos de TOWER del plan (L1 en AUTO = 15; END GAME 10/20/30). */
export function planTowerPoints(rows: PhaseRow[]): number {
  return rows.reduce((s, r) => s + (r.auto === 'climb-l1' ? 15 : 0) + [0, 10, 20, 30][r.climb], 0);
}
