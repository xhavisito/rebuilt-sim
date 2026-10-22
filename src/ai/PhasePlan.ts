/**
 * Plan del match por fases (las tablas del dashboard de estrategia): para cada robot de tu
 * alianza, su posición inicial y rutina de AUTO, su tarea con el HUB activo, su tarea con el HUB
 * inactivo (y a quién marca) y su nivel de TOWER en END GAME. Arranca con la sugerencia del
 * estratega / drive coach y el jugador lo edita a su gusto. Sin Three.js ni Rapier.
 */
import { routineZones, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { driverStationCenter } from '../config/field';
import type { MatchPlan } from './Strategist';
import { plan, type ActiveTask, type InactiveTask, type PathPhase, type PhasePath, type Pt, type RobotPlan } from './Strategy';

export interface PhaseRow {
  team: number;
  station: 1 | 2 | 3;
  isPlayer: boolean;
  /** Z de salida en el marco azul (m); null = frente a su DRIVER STATION. */
  startZ: number | null;
  /** Rutina de AUTO (id). */
  auto: string;
  active: ActiveTask;
  inactive: InactiveTask;
  /** Rival que marca si defiende (número de equipo); null = el más peligroso. */
  defendTeam: number | null;
  /** Nivel de TOWER en END GAME (0 = anota hasta el final). */
  climb: 0 | 1 | 2 | 3;
  /** Nivel máximo que alcanza su robot. */
  maxClimb: 0 | 1 | 2 | 3;
  /** Ruta y punto de cada fase en el mapa (marco azul): SHIFT activo, inactivo y END GAME. */
  paths: Record<PathPhase, PhasePath>;
}

/** Z (marco azul) de la DRIVER STATION: la salida de fábrica. */
export const defaultStartZ = (station: 1 | 2 | 3): number => driverStationCenter('blue', station).z;

/** Carril (z, marco azul) de cada DRIVER STATION: el de su lado del campo. */
const laneZ = (station: 1 | 2 | 3): number => [-2.2, 0, 2.2][station - 1];
const HUB_X = F.HUB_CENTER_X_BLUE;

/** Punto de tiro sugerido: frente al HUB en su carril, dentro de la ALLIANCE ZONE. */
const shootPt = (st: 1 | 2 | 3): Pt => ({ x: HUB_X - 2.4, z: laneZ(st) * 0.75 });
/** Donde caen los pases: en la ALLIANCE ZONE, a un lado del HUB (como `passTarget`). */
const passPt = (st: 1 | 2 | 3): Pt => (st === 2 ? { x: -(F.HALF_L - 3.6), z: 1.6 } : { x: -(F.HALF_L - 2.4), z: laneZ(st) });
/** Recolección cerca: la NEUTRAL ZONE justo pasando el HUB, en su carril. */
const nearRoute = (st: 1 | 2 | 3): Pt[] => [
  { x: HUB_X + 1.6, z: laneZ(st) * 1.1 },
  { x: HUB_X + 3.2, z: laneZ(st) * 0.8 },
];
/** Recolección profunda: de la línea del HUB hasta casi la CENTER LINE, en su carril. */
const deepRoute = (st: 1 | 2 | 3): Pt[] => [
  { x: HUB_X + 1.8, z: laneZ(st) },
  { x: -1.4, z: laneZ(st) * 0.9 + (st === 2 ? 1.2 : 0) },
  { x: -0.7, z: laneZ(st) * 0.5 - (st === 2 ? 1.2 : 0) },
];

/** Rutas sugeridas de cada fase según sus tareas. */
export function suggestedPaths(st: 1 | 2 | 3, active: ActiveTask, inactive: InactiveTask): Record<PathPhase, PhasePath> {
  return {
    active: active === 'feed' ? { route: deepRoute(st), spot: passPt(st) } : { route: nearRoute(st), spot: shootPt(st) },
    // al defender no hay ruta: persigue al rival que marca
    inactive: inactive === 'defend' ? { route: [], spot: null } : { route: deepRoute(st), spot: passPt(st) },
    endgame: { route: nearRoute(st), spot: shootPt(st) },
  };
}

/** La sugerencia del estratega (drive coach) como filas editables. */
export function suggestedRows(p: MatchPlan, maxClimb: Array<0 | 1 | 2 | 3>): PhaseRow[] {
  return p.orders.map((o, i) => {
    // el alimentador alimenta todo el match; los demás anotan con el HUB activo
    const active: ActiveTask = o.role === 'feeder' ? 'feed' : 'score';
    // con el HUB apagado nadie espera: el defensor marca, el alimentador pasa todo, el resto acapara
    const inactive: InactiveTask = o.role === 'defender' ? 'defend' : o.role === 'feeder' ? 'feed' : 'stockpile';
    return {
      team: o.team,
      station: o.station,
      isPlayer: o.isPlayer,
      startZ: null,
      auto: o.auto,
      active,
      inactive,
      defendTeam: o.defendTeam,
      climb: o.climb,
      maxClimb: maxClimb[i] ?? 0,
      paths: suggestedPaths(o.station, active, inactive),
    };
  });
}

/**
 * Filas guardadas con formatos anteriores: sin rutas por fase (se sugieren) o con tareas por
 * SHIFT (`windows`: se usa la primera).
 */
export function normalizeRow(r: Partial<PhaseRow> & { windows?: Array<{ active: ActiveTask; inactive: InactiveTask; defendTeam: number | null }> }): PhaseRow {
  const w = r.windows?.[0];
  const { windows: _w, ...rest } = r;
  void _w;
  const row = { ...rest, active: r.active ?? w?.active ?? 'score', inactive: r.inactive ?? w?.inactive ?? 'stockpile', defendTeam: r.defendTeam ?? w?.defendTeam ?? null } as PhaseRow;
  return { ...row, paths: r.paths ?? suggestedPaths(row.station, row.active, row.inactive) };
}

/** Filas → planes de la estrategia (DS 1, 2, 3) que siguen la IA y el drive coach. */
export function rowsToPlans(rows: PhaseRow[]): RobotPlan[] {
  return [1, 2, 3].map((ds) => {
    const r = rows.find((x) => x.station === ds);
    if (!r) return plan();
    const role = r.inactive === 'defend' ? 'defender' : r.active === 'feed' && r.inactive === 'feed' ? 'feeder' : 'scorer';
    return plan({ role, climb: r.climb, auto: r.auto, startZ: r.startZ, defendTeam: r.defendTeam, active: r.active, inactive: r.inactive, phases: structuredClone(r.paths) });
  });
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
